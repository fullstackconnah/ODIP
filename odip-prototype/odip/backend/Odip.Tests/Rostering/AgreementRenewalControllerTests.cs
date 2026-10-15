using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.RateLimiting;
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>POST .../{id}/renew over HTTP: who may call it, each outcome (200, 400, 403, 404, 409 twice, 429) and what the wire carries. The rules themselves are <see cref="AgreementRenewalServiceTests"/>.</summary>
public class AgreementRenewalControllerTests
{
    private static ServiceAgreementDraftsController Controller(Fixture f, Guid? tenantId = null, PlanQuoteConcurrencyLimiter? limiter = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId ?? TenantA);
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, Admin.UserId!.Value.ToString()), new Claim(ClaimTypes.Role, "Coordinator") };
        return new ServiceAgreementDraftsController(f.Db, tenant.Object, new ServiceAgreementDraftService(f.Db), saveLimiter: limiter, approval: f.Service, renewal: new AgreementRenewalService(f.Db))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } },
        };
    }

    private static JsonElement Wire(object? body)
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        return JsonDocument.Parse(JsonSerializer.Serialize(body, options)).RootElement;
    }


    /// <summary>v1, weekday mornings to 22 November 2026, approved; with a plan covering 2026-27 unless told otherwise.</summary>
    private static async Task<(Fixture F, ServiceAgreementDraft V1)> ApprovedV1Async(bool withPlan = true)
    {
        var f = await SetUpAsync();
        await CatalogueImportTestSupport.ImportAsync(f.Db, CatalogueFixtures.File2026_27);
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, end: new DateOnly(2026, 11, 22));
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None);
        if (withPlan)
        {
            f.Db.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, PlanStart = new DateOnly(2026, 7, 1), PlanEnd = new DateOnly(2027, 6, 30) });
            await f.Db.SaveChangesAsync();
        }
        return (f, v1);
    }

    [Fact]
    public void It_is_for_admins_coordinators_and_super_admins_rate_limited_size_capped_and_posted_to_renew()
    {
        var method = typeof(ServiceAgreementDraftsController).GetMethod(nameof(ServiceAgreementDraftsController.Renew))!;

        Assert.Equal("Admin,Coordinator,SuperAdmin", method.GetCustomAttribute<AuthorizeAttribute>()?.Roles);
        Assert.Equal("api", method.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
        Assert.NotNull(method.GetCustomAttribute<RequestSizeLimitAttribute>());
        Assert.Equal("{id:guid}/renew", method.GetCustomAttribute<HttpPostAttribute>()!.Template);
    }

    [Fact]
    public async Task A_renewal_is_a_200_with_the_new_revision_on_the_wire()
    {
        var (f, v1) = await ApprovedV1Async();
        await using var _ = f;

        var result = await Controller(f).Renew(f.ParticipantId, v1.Id, CancellationToken.None);

        var data = Wire(Assert.IsType<OkObjectResult>(result.Result).Value).GetProperty("data");
        Assert.Equal((2, "2026-11-23", "2027-01-03", "2026-07-01", "2027-06-30"),
            (data.GetProperty("version").GetInt32(), data.GetProperty("agreementStartDate").GetString(), data.GetProperty("agreementEndDate").GetString(),
             data.GetProperty("planStartDate").GetString(), data.GetProperty("planEndDate").GetString()));
    }

    [Fact]
    public async Task No_plan_for_the_first_day_is_a_409_plan_needed_with_the_words_and_nothing_saved()
    {
        var (f, v1) = await ApprovedV1Async(withPlan: false);
        await using var _ = f;

        var result = await Controller(f).Renew(f.ParticipantId, v1.Id, CancellationToken.None);

        var wire = Wire(Assert.IsType<ConflictObjectResult>(result.Result).Value);
        Assert.Equal(("plan-needed", "Record the new plan first: no plan of the participant's covers 2026-11-23, the day the renewal starts."),
            (wire.GetProperty("code").GetString(), wire.GetProperty("errors")[0].GetString()));
        Assert.Equal(1, await f.Db.ServiceAgreementDrafts.CountAsync());
    }

    [Fact]
    public async Task A_waiting_newer_revision_is_a_409_draft_version_conflict_naming_it()
    {
        var (f, v1) = await ApprovedV1Async();
        await using var _ = f;
        await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: new DateOnly(2026, 11, 2), end: new DateOnly(2026, 11, 22));

        var result = await Controller(f).Renew(f.ParticipantId, v1.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<DraftVersionConflictDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
        Assert.Equal((false, "draft-version-conflict", 2), (body.Success, body.Code, body.Data!.CurrentVersion));
    }


    [Fact]
    public async Task A_role_that_may_not_approve_is_a_403_another_organisations_revision_a_404_and_an_unapproved_one_a_400()
    {
        var (f, v1) = await ApprovedV1Async();
        await using var _ = f;
        var unapproved = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: new DateOnly(2026, 11, 2), end: new DateOnly(2026, 11, 22));

        var other = await Controller(f, tenantId: TenantB).Renew(f.ParticipantId, v1.Id, CancellationToken.None);
        var notApproved = await Controller(f).Renew(f.ParticipantId, unapproved.Id, CancellationToken.None);
        f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApproverRoles = "Admin" });
        await f.Db.SaveChangesAsync();
        var coordinator = await Controller(f).Renew(f.ParticipantId, v1.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(other.Result);
        Assert.Equal("Renew the agreement from its newest approved revision, v1.",
            Assert.Single(Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(Assert.IsType<BadRequestObjectResult>(notApproved.Result).Value).Errors!));
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(coordinator.Result).StatusCode);
        Assert.Equal(2, await f.Db.ServiceAgreementDrafts.CountAsync());
    }

    [Fact]
    public async Task While_the_organisations_save_permits_are_taken_it_is_a_429_and_nothing_is_saved()
    {
        var (f, v1) = await ApprovedV1Async();
        await using var _ = f;
        using var limiter = new PlanQuoteConcurrencyLimiter(permits: 1);
        using var held = limiter.TryEnter("save:tenant:" + TenantA.ToString("N"));

        var result = await Controller(f, limiter: limiter).Renew(f.ParticipantId, v1.Id, CancellationToken.None);

        var busy = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal((StatusCodes.Status429TooManyRequests, ServiceAgreementDraftsController.SaveBusyMessage),
            (busy.StatusCode, Assert.Single(Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(busy.Value).Errors!)));
        Assert.Equal(1, await f.Db.ServiceAgreementDrafts.CountAsync());
    }
}
