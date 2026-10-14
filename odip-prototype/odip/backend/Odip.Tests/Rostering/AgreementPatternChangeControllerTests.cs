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
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>POST .../{id}/pattern-change over HTTP: who may call it, each outcome (200, 400, 404, 409) and what the wire carries. The rules themselves are <see cref="AgreementPatternChangeServiceTests"/>.</summary>
public class AgreementPatternChangeControllerTests
{
    private static ServiceAgreementDraftsController Controller(Fixture f, Guid? tenantId = null, bool withoutTenant = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(withoutTenant ? null : tenantId ?? TenantA);
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, Admin.UserId!.Value.ToString()), new Claim(ClaimTypes.Role, "Coordinator") };
        return new ServiceAgreementDraftsController(f.Db, tenant.Object, new ServiceAgreementDraftService(f.Db), approval: f.Service, patternChange: new AgreementPatternChangeService(f.Db, clock: f.Clock))
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

    private static async Task<(Fixture F, ServiceAgreementDraft V1, ShiftPattern Monday)> ApprovedAsync()
    {
        var f = await SetUpAsync();
        await CatalogueImportTestSupport.ImportAsync(f.Db, CatalogueFixtures.File2026_27);
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, end: new DateOnly(2026, 11, 22));
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None);
        return (f, v1, await f.Db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.SourceDraftId == v1.Id && p.DayOfWeek == DayOfWeek.Monday));
    }

    private static AgreementPatternChangeDto LongerMonday(ShiftPattern p, bool preview = false) => new()
    {
        PatternId = p.Id, DayOfWeek = p.DayOfWeek, StartTime = p.StartTime, EndTime = T(14), EndsNextDay = false, Ratio = p.Ratio, NightType = p.NightType,
        FromDate = new DateOnly(2026, 10, 19), Preview = preview,
    };


    [Fact]
    public void It_is_for_admins_coordinators_and_super_admins_rate_limited_size_capped_and_posted_to_pattern_change()
    {
        var method = typeof(ServiceAgreementDraftsController).GetMethod(nameof(ServiceAgreementDraftsController.PatternChange))!;

        Assert.Equal("Admin,Coordinator,SuperAdmin", method.GetCustomAttribute<AuthorizeAttribute>()?.Roles);
        Assert.Equal("api", method.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
        Assert.NotNull(method.GetCustomAttribute<RequestSizeLimitAttribute>());
        Assert.Equal("{id:guid}/pattern-change", method.GetCustomAttribute<HttpPostAttribute>()!.Template);
    }

    [Fact]
    public async Task A_preview_and_a_save_are_200s_and_the_wire_says_them_the_screens_way()
    {
        var (f, v1, monday) = await ApprovedAsync();
        await using var _ = f;

        var preview = await Controller(f).PatternChange(f.ParticipantId, v1.Id, LongerMonday(monday, preview: true), CancellationToken.None);
        var saved = await Controller(f).PatternChange(f.ParticipantId, v1.Id, LongerMonday(monday), CancellationToken.None);

        var data = Wire(Assert.IsType<OkObjectResult>(preview.Result).Value).GetProperty("data");
        Assert.False(data.TryGetProperty("draftId", out var _));                                                          // a preview saved nothing
        Assert.Equal((2, "2026-10-19", "2026-11-22", 7358.00m, 7725.90m, 367.90m, false),
            (data.GetProperty("version").GetInt32(), data.GetProperty("agreementStartDate").GetString(), data.GetProperty("agreementEndDate").GetString(),
             data.GetProperty("oldTotal").GetDecimal(), data.GetProperty("newTotal").GetDecimal(), data.GetProperty("difference").GetDecimal(), data.GetProperty("needsReview").GetBoolean()));
        var savedData = Wire(Assert.IsType<OkObjectResult>(saved.Result).Value).GetProperty("data");
        var v2 = await f.Db.ServiceAgreementDrafts.AsNoTracking().SingleAsync(d => d.Version == 2);
        Assert.Equal(v2.Id, savedData.GetProperty("draftId").GetGuid());
    }

    [Fact]
    public async Task A_newer_revision_is_a_409_draft_version_conflict_with_the_newest_version_as_a_save_answers()
    {
        var (f, v1, monday) = await ApprovedAsync();
        await using var _ = f;
        await AddRevisionAsync(f, 2, new[] { WeekdayBlock(change: b => b with { End = T(12) }) });

        var result = await Controller(f).PatternChange(f.ParticipantId, v1.Id, LongerMonday(monday), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<DraftVersionConflictDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
        Assert.Equal((false, "draft-version-conflict", 2), (body.Success, body.Code, body.Data!.CurrentVersion));
    }

    [Fact]
    public async Task Another_organisation_gets_a_404_a_refusal_is_a_400_with_its_reasons_no_organisation_in_view_is_a_400_and_nothing_is_saved()
    {
        var (f, v1, monday) = await ApprovedAsync();
        await using var _ = f;

        var other = await Controller(f, tenantId: TenantB).PatternChange(f.ParticipantId, v1.Id, LongerMonday(monday), CancellationToken.None);
        var refused = await Controller(f).PatternChange(f.ParticipantId, v1.Id, LongerMonday(monday) with { FromDate = new DateOnly(2026, 12, 1) }, CancellationToken.None);
        var noTenant = await Controller(f, withoutTenant: true).PatternChange(f.ParticipantId, v1.Id, LongerMonday(monday), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(other.Result);
        Assert.Equal("A change cannot start after the agreement ends (2026-11-22).", Assert.Single(Assert.IsType<ApiResponse<PatternChangeResultDto>>(Assert.IsType<BadRequestObjectResult>(refused.Result).Value).Errors!));
        Assert.Equal("A tenant context is required.", Assert.Single(Assert.IsType<ApiResponse<PatternChangeResultDto>>(Assert.IsType<BadRequestObjectResult>(noTenant.Result).Value).Errors!));
        Assert.Equal(1, await f.Db.ServiceAgreementDrafts.CountAsync());
    }
}
