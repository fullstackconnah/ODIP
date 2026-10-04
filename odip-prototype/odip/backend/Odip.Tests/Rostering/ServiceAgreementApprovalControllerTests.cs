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
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// The approval over HTTP: who may call it, what each outcome is (200, 400, 403, 404, 409), and what the wire carries. The rules themselves are <see cref="ServiceAgreementApprovalServiceTests"/>.
/// </summary>
public class ServiceAgreementApprovalControllerTests
{
    private static ServiceAgreementDraftsController Controller(Fixture f, string role = "Admin", Guid? tenantId = null, bool withoutTenant = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(withoutTenant ? null : tenantId ?? TenantA);
        tenant.Setup(t => t.IsSuperAdmin).Returns(role == "SuperAdmin");
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, Admin.UserId!.Value.ToString()), new Claim("fullName", "Alex Admin"), new Claim(ClaimTypes.Role, role) };
        return new ServiceAgreementDraftsController(f.Db, tenant.Object, new ServiceAgreementDraftService(f.Db), configuration: f.Configuration, approval: f.Service)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } },
        };
    }

    private static JsonSerializerOptions ApiOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        return options;
    }

    private static T Value<T>(ActionResult<ApiResponse<T>> result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    // ── Who may call ──────────────────────────────────────────────────────────────

    [Fact]
    public void Approving_and_its_preview_are_for_admins_coordinators_and_super_admins_and_approving_is_rate_limited_and_size_capped()
    {
        var approve = typeof(ServiceAgreementDraftsController).GetMethod(nameof(ServiceAgreementDraftsController.Approve))!;
        var preview = typeof(ServiceAgreementDraftsController).GetMethod(nameof(ServiceAgreementDraftsController.ApprovalPreview))!;

        Assert.Equal("Admin,Coordinator,SuperAdmin", approve.GetCustomAttribute<AuthorizeAttribute>()?.Roles);
        Assert.Equal("Admin,Coordinator,SuperAdmin", preview.GetCustomAttribute<AuthorizeAttribute>()?.Roles);
        Assert.Equal("api", approve.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
        Assert.NotNull(approve.GetCustomAttribute<RequestSizeLimitAttribute>());
        Assert.NotNull(approve.GetCustomAttribute<HttpPostAttribute>());
        Assert.Equal("{id:guid}/approve", approve.GetCustomAttribute<HttpPostAttribute>()!.Template);
        Assert.Equal("{id:guid}/approval-preview", preview.GetCustomAttribute<HttpGetAttribute>()!.Template);
    }

    [Fact]
    public async Task A_role_the_organisation_does_not_let_approve_is_answered_403_with_words_and_nothing_is_written()
    {
        await using var f = await SetUpAsync();
        f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApproverRoles = "Admin" });
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var controller = Controller(f, role: "Coordinator");

        var approve = await controller.Approve(f.ParticipantId, draft.Id, new ApproveDraftDto(), CancellationToken.None);
        var preview = await controller.ApprovalPreview(f.ParticipantId, draft.Id, CancellationToken.None);

        var forbiddenApprove = Assert.IsType<ObjectResult>(approve.Result);
        var forbiddenPreview = Assert.IsType<ObjectResult>(preview.Result);
        Assert.Equal((StatusCodes.Status403Forbidden, StatusCodes.Status403Forbidden), (forbiddenApprove.StatusCode, forbiddenPreview.StatusCode));
        Assert.Contains("cannot approve", Assert.Single(Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(forbiddenApprove.Value).Errors!));
        Assert.Contains("cannot approve", Assert.Single(Assert.IsType<ApiResponse<DraftApprovalPreviewDto>>(forbiddenPreview.Value).Errors!));
        Assert.Empty(await f.Db.ServiceAgreementDraftApprovals.ToListAsync());
        Assert.Empty(await f.Db.ShiftPatterns.ToListAsync());
    }

    [Fact]
    public async Task Without_an_organisation_in_view_neither_call_is_answered_it_is_a_400_like_saving()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var controller = Controller(f, role: "SuperAdmin", withoutTenant: true);

        var approve = await controller.Approve(f.ParticipantId, draft.Id, new ApproveDraftDto(), CancellationToken.None);
        var preview = await controller.ApprovalPreview(f.ParticipantId, draft.Id, CancellationToken.None);

        Assert.Equal("A tenant context is required.", Assert.Single(Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(Assert.IsType<BadRequestObjectResult>(approve.Result).Value).Errors!));
        Assert.Equal("A tenant context is required.", Assert.Single(Assert.IsType<ApiResponse<DraftApprovalPreviewDto>>(Assert.IsType<BadRequestObjectResult>(preview.Result).Value).Errors!));
        Assert.Empty(await f.Db.ServiceAgreementDraftApprovals.ToListAsync());
    }

    [Fact]
    public async Task Another_organisations_revision_is_a_404_not_a_403_nothing_says_it_exists()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var other = Controller(f, tenantId: TenantB);

        Assert.IsType<NotFoundObjectResult>((await other.Approve(f.ParticipantId, draft.Id, new ApproveDraftDto(), CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await other.ApprovalPreview(f.ParticipantId, draft.Id, CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await Controller(f).Approve(f.ParticipantId, Guid.NewGuid(), new ApproveDraftDto(), CancellationToken.None)).Result);
        Assert.Empty(await f.Db.ServiceAgreementDraftApprovals.ToListAsync());
    }

    // ── What each outcome is ──────────────────────────────────────────────────────

    [Fact]
    public async Task Approving_answers_200_with_the_revision_its_approval_and_the_old_shifts_that_remain_and_the_wire_says_it_the_screens_way()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var result = await Controller(f).Approve(f.ParticipantId, draft.Id, new ApproveDraftDto(), CancellationToken.None);

        var dto = Value(result);
        Assert.Equal((draft.Id, 1, "UnapprovedDraft"), (dto.Id, dto.Version, dto.Status));            // approval is not the template's status
        var approval = dto.Approval!;
        Assert.Equal(("Alex Admin", 5, 0, 40), (approval.ApprovedByName, approval.PatternsCreated, approval.PatternsEnded, approval.ShiftsCreated));
        Assert.Equal((new DateOnly(2026, 12, 5), (DateOnly?)new DateOnly(2026, 10, 12)), (approval.HorizonEnd, approval.FirstShiftDate));
        Assert.Equal((0, 0), (dto.OldShiftsRemaining!.Open, dto.OldShiftsRemaining.Assigned));
        Assert.Single(dto.Blocks);
        var json = JsonSerializer.Serialize(Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(Assert.IsType<OkObjectResult>(result.Result).Value), ApiOptions());
        Assert.Contains("\"approval\":{\"approvedAt\":\"2026-10-10T02:00:00Z\",\"approvedByName\":\"Alex Admin\",\"patternsCreated\":5,\"patternsEnded\":0,\"shiftsCreated\":40,\"horizonEnd\":\"2026-12-05\",\"firstShiftDate\":\"2026-10-12\",\"topUpEnabled\":true}", json);
        Assert.Contains("\"oldShiftsRemaining\":{\"open\":0,\"assigned\":0}", json);
    }

    [Fact]
    public async Task Approving_again_is_a_200_with_the_existing_approval_unchanged_whoever_asks()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var first = Value(await Controller(f).Approve(f.ParticipantId, draft.Id, new ApproveDraftDto(), CancellationToken.None)).Approval!;
        f.Clock.Set(f.Clock.GetUtcNow().AddDays(1));

        var again = Value(await Controller(f, role: "Coordinator").Approve(f.ParticipantId, draft.Id, null, CancellationToken.None)).Approval!;

        Assert.Equal((first.ApprovedAt, first.ApprovedByName, first.PatternsCreated, first.ShiftsCreated), (again.ApprovedAt, again.ApprovedByName, again.PatternsCreated, again.ShiftsCreated));
        Assert.Equal(1, await f.Db.ServiceAgreementDraftApprovals.CountAsync());
        Assert.Equal(5, await f.Db.ShiftPatterns.CountAsync());
    }

    [Fact]
    public async Task Everything_that_stops_approval_is_a_400_with_the_reasons_in_errors_the_list_saving_uses()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, Array.Empty<Domain.Billing.Pricing.PlanBlock>(), handTyped: true);

        var result = await Controller(f).Approve(f.ParticipantId, draft.Id, new ApproveDraftDto(), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.False(body.Success);
        Assert.Contains("Rebuild it from blocks to approve it", Assert.Single(body.Errors!));
    }

    [Fact]
    public async Task An_older_revision_is_a_409_with_a_code_and_the_newest_version()
    {
        await using var f = await SetUpAsync();
        var older = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await AddRevisionAsync(f, 2, new[] { WeekdayBlock() });

        var result = await Controller(f).Approve(f.ParticipantId, older.Id, new ApproveDraftDto(), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<DraftVersionConflictDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
        Assert.Equal(("draft-superseded", 2), (body.Code, body.Data!.CurrentVersion));
        Assert.StartsWith("A newer revision of this agreement draft exists.", Assert.Single(body.Errors!));
    }

    [Fact]
    public async Task Overlapping_hand_made_patterns_are_a_400_until_the_request_acknowledges_them_and_then_a_200()
    {
        await using var f = await SetUpAsync();
        f.Db.ShiftPatterns.Add(new ShiftPattern { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = new DateOnly(2026, 1, 1), IsActive = true });
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var controller = Controller(f);

        var without = await controller.Approve(f.ParticipantId, draft.Id, new ApproveDraftDto(), CancellationToken.None);
        var preview = Value(await controller.ApprovalPreview(f.ParticipantId, draft.Id, CancellationToken.None));
        var with = await controller.Approve(f.ParticipantId, draft.Id, new ApproveDraftDto { AcknowledgeOverlaps = true }, CancellationToken.None);

        Assert.Contains("overlap", Assert.Single(Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(Assert.IsType<BadRequestObjectResult>(without.Result).Value).Errors!));
        Assert.Single(preview.OverlappingPatterns);
        Assert.Equal(5, Value(with).Approval!.PatternsCreated);
    }

    // ── The preview ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_preview_is_a_200_with_the_counts_and_writes_nothing()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var result = await Controller(f).ApprovalPreview(f.ParticipantId, draft.Id, CancellationToken.None);

        var preview = Value(result);
        Assert.Equal((true, 5, 0, 40, new DateOnly(2026, 12, 5)), (preview.CanApprove, preview.PatternsToCreate, preview.PatternsToEnd, preview.ShiftsToCreate, preview.HorizonEnd));
        var json = JsonSerializer.Serialize(Assert.IsType<ApiResponse<DraftApprovalPreviewDto>>(Assert.IsType<OkObjectResult>(result.Result).Value), ApiOptions());
        Assert.Contains("\"canApprove\":true", json);
        Assert.Contains("\"patternsToCreate\":5", json);
        Assert.Contains("\"horizonEnd\":\"2026-12-05\"", json);
        Assert.Empty(await f.Db.ServiceAgreementDraftApprovals.ToListAsync());
    }

    [Fact]
    public async Task The_preview_the_approval_and_the_list_say_whether_the_daily_top_up_is_on_so_the_screen_promises_only_what_will_happen()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        Assert.True(Value(await Controller(f).ApprovalPreview(f.ParticipantId, draft.Id, CancellationToken.None)).TopUpEnabled);        // on unless the setting says otherwise

        f.SwitchTopUpOff();                                                                                                           // RosterTopUp:Enabled=false: the approval still makes its shifts, the job does not run
        var controller = Controller(f);
        var preview = Value(await controller.ApprovalPreview(f.ParticipantId, draft.Id, CancellationToken.None));
        var approved = Value(await controller.Approve(f.ParticipantId, draft.Id, new ApproveDraftDto(), CancellationToken.None));
        var listed = Value(await controller.List(f.ParticipantId, CancellationToken.None)).Single();

        Assert.False(preview.TopUpEnabled);
        Assert.Equal(40, preview.ShiftsToCreate);
        Assert.False(approved.Approval!.TopUpEnabled);
        Assert.False(listed.Approval!.TopUpEnabled);
        Assert.Contains("\"topUpEnabled\":false", JsonSerializer.Serialize(new ApiResponse<DraftApprovalPreviewDto> { Success = true, Data = preview }, ApiOptions()));        // and it is on the wire
    }

    // ── The list says which revisions were approved ───────────────────────────────

    [Fact]
    public async Task The_list_carries_the_approval_of_the_newest_revision_and_of_an_older_one_in_its_summary()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var controller = Controller(f);
        await controller.Approve(f.ParticipantId, v1.Id, new ApproveDraftDto(), CancellationToken.None);
        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() });

        var beforeV2 = Value(await controller.List(f.ParticipantId, CancellationToken.None));
        await controller.Approve(f.ParticipantId, v2.Id, new ApproveDraftDto(), CancellationToken.None);
        var afterV2 = Value(await controller.List(f.ParticipantId, CancellationToken.None));

        Assert.Equal(new[] { 2, 1 }, beforeV2.Select(d => d.Version));
        Assert.Null(beforeV2[0].Approval);                                         // the newest, not approved yet
        Assert.Equal(("Alex Admin", 5), (beforeV2[1].Approval!.ApprovedByName, beforeV2[1].Approval!.PatternsCreated));
        Assert.True(beforeV2[1].IsSummary);
        Assert.Equal(("Alex Admin", 5, 5), (afterV2[0].Approval!.ApprovedByName, afterV2[0].Approval!.PatternsCreated, afterV2[0].Approval!.PatternsEnded));       // v2 ended v1's five patterns
        var one = Value(await controller.Get(f.ParticipantId, v1.Id, CancellationToken.None));
        Assert.Equal("Alex Admin", one.Approval!.ApprovedByName);
    }
}
