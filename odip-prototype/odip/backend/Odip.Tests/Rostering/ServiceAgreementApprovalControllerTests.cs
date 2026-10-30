using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// The approval over HTTP: who may call it, what each outcome is (200, 400, 403, 404, 409), and what the wire carries. The rules themselves are <see cref="ServiceAgreementApprovalServiceTests"/>.
/// </summary>
public class ServiceAgreementApprovalControllerTests
{
    private static ServiceAgreementDraftsController Controller(Fixture f, string role = "Admin", Guid? tenantId = null, bool withoutTenant = false, HttpContext? http = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(withoutTenant ? null : tenantId ?? TenantA);
        tenant.Setup(t => t.IsSuperAdmin).Returns(role == "SuperAdmin");
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, Admin.UserId!.Value.ToString()), new Claim("fullName", "Alex Admin"), new Claim(ClaimTypes.Role, role) };
        return new ServiceAgreementDraftsController(f.Db, tenant.Object, new ServiceAgreementDraftService(f.Db), approval: f.Service)
        {
            ControllerContext = new ControllerContext { HttpContext = http ?? new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } },
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
        Assert.IsType<ConflictObjectResult>((await Controller(f).Approve(f.ParticipantId, Guid.NewGuid(), new ApproveDraftDto(), CancellationToken.None)).Result);        // my participant has revisions: one that is not there may have been replaced by a save, which is a 409 draft-superseded (ServiceAgreementApprovalReplacedTests)
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
        Assert.Equal((new DateOnly(2026, 12, 6), (DateOnly?)new DateOnly(2026, 10, 12)), (approval.HorizonEnd, approval.FirstShiftDate));
        Assert.Equal((0, 0), (dto.OldShiftsRemaining!.Open, dto.OldShiftsRemaining.Assigned));
        Assert.Single(dto.Blocks);
        var json = JsonSerializer.Serialize(Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(Assert.IsType<OkObjectResult>(result.Result).Value), ApiOptions());
        Assert.Contains("\"approval\":{\"approvedAt\":\"2026-10-10T02:00:00Z\",\"approvedByName\":\"Alex Admin\",\"patternsCreated\":5,\"patternsEnded\":0,\"shiftsCreated\":40,\"horizonEnd\":\"2026-12-06\",\"firstShiftDate\":\"2026-10-12\"}", json);
        Assert.Contains("\"oldShiftsRemaining\":{\"open\":0,\"assigned\":0,\"removed\":0,\"carried\":0,\"shifts\":[]}", json);
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
        Assert.Equal((true, 5, 0, 40, new DateOnly(2026, 12, 6)), (preview.CanApprove, preview.PatternsToCreate, preview.PatternsToEnd, preview.ShiftsToCreate, preview.HorizonEnd));
        var json = JsonSerializer.Serialize(Assert.IsType<ApiResponse<DraftApprovalPreviewDto>>(Assert.IsType<OkObjectResult>(result.Result).Value), ApiOptions());
        Assert.Contains("\"canApprove\":true", json);
        Assert.Contains("\"patternsToCreate\":5", json);
        Assert.Contains("\"horizonEnd\":\"2026-12-06\"", json);
        Assert.Empty(await f.Db.ServiceAgreementDraftApprovals.ToListAsync());
    }

    [Fact]
    public async Task ThePreviewAndTheApproval_CarryNoTopUpField()   // Start rostering (2026-10-16): the daily top-up is gone, so nothing on the wire speaks of it
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var controller = Controller(f);
        var preview = Value(await controller.ApprovalPreview(f.ParticipantId, draft.Id, CancellationToken.None));
        var approved = Value(await controller.Approve(f.ParticipantId, draft.Id, new ApproveDraftDto(), CancellationToken.None));
        var listed = Value(await controller.List(f.ParticipantId, CancellationToken.None)).Single();

        Assert.Equal(40, preview.ShiftsToCreate);
        Assert.DoesNotContain("topUpEnabled", JsonSerializer.Serialize(new ApiResponse<DraftApprovalPreviewDto> { Success = true, Data = preview }, ApiOptions()));
        Assert.DoesNotContain("topUpEnabled", JsonSerializer.Serialize(approved, ApiOptions()));
        Assert.DoesNotContain("topUpEnabled", JsonSerializer.Serialize(listed, ApiOptions()));
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

    // ── Moving the participant to Active (ApprovalActivatesParticipant) ───────────

    private static readonly DateTime IntakeDone = new(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);

    private static async Task SettingAsync(Fixture f, bool on)
    {
        var row = await f.Db.PlanPricingSettings.SingleOrDefaultAsync(s => s.TenantId == TenantA);
        if (row is null) f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApprovalActivatesParticipant = on });
        else row.ApprovalActivatesParticipant = on;
        await f.Db.SaveChangesAsync();
    }

    /// <summary>The fixture's participant as onboarding left it: a draft, not active unless said, intake finished unless said.</summary>
    private static async Task OnboardingAsync(Fixture f, bool intake = true, bool active = false, DateTime? servicesStarted = null)
    {
        var p = await f.Db.Participants.SingleAsync(x => x.Id == f.ParticipantId);
        (p.IsDraft, p.IsActive, p.IntakeCompletedAt, p.ServicesStartedAt) = (true, active, intake ? IntakeDone : null, servicesStarted);
        await f.Db.SaveChangesAsync();
    }

    private static Task<Participant> StoredAsync(Fixture f) => f.Db.Participants.AsNoTracking().SingleAsync(x => x.Id == f.ParticipantId);
    private static Task<int> ShiftCountAsync(Fixture f) => f.Db.Shifts.CountAsync(s => s.ParticipantId == f.ParticipantId);
    private static async Task<ServiceAgreementDraftDto> ApproveAsync(Fixture f, ServiceAgreementDraft draft) =>
        Value(await Controller(f).Approve(f.ParticipantId, draft.Id, new ApproveDraftDto(), CancellationToken.None));

    [Fact]
    public async Task With_the_setting_off_approving_leaves_an_onboarding_participant_a_draft_and_says_Off()
    {
        await using var f = await SetUpAsync(active: false);
        await OnboardingAsync(f);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var dto = await ApproveAsync(f, draft);

        Assert.Equal(ActivationResults.Off, dto.Activation!.Result);
        Assert.True((await StoredAsync(f)).IsDraft);
        Assert.Equal(0, await ShiftCountAsync(f));
    }

    [Fact]
    public async Task With_the_setting_on_approving_moves_an_onboarding_participant_to_Active_and_fills_the_started_weeks()
    {
        await using var f = await SetUpAsync(active: false);
        await OnboardingAsync(f);
        await SettingAsync(f, on: true);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var result = await Controller(f).Approve(f.ParticipantId, draft.Id, new ApproveDraftDto(), CancellationToken.None);

        var dto = Value(result);
        Assert.Equal((ActivationResults.Activated, (string?)null), (dto.Activation!.Result, dto.Activation.Reason));
        var stored = await StoredAsync(f);
        Assert.True(!stored.IsDraft && stored.IsActive);
        var dates = await f.Db.Shifts.Where(s => s.ParticipantId == f.ParticipantId).Select(s => s.ServiceDate).ToListAsync();
        Assert.NotEmpty(dates);
        Assert.All(dates, d => Assert.InRange(d, new DateOnly(2026, 10, 5), HorizonEnd));
        Assert.True(await f.Db.ServiceAgreementDraftApprovals.AnyAsync(a => a.DraftId == draft.Id));
        var json = JsonSerializer.Serialize(Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(Assert.IsType<OkObjectResult>(result.Result).Value), ApiOptions());
        Assert.Contains("\"activation\":{\"result\":\"Activated\"", json);
    }

    [Fact]
    public async Task With_the_setting_on_and_intake_not_finished_the_approval_stands_and_the_answer_says_why()
    {
        await using var f = await SetUpAsync(active: false);
        await OnboardingAsync(f, intake: false);
        await SettingAsync(f, on: true);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var dto = await ApproveAsync(f, draft);

        Assert.Equal((ActivationResults.NotActivated, "intake not finished"), (dto.Activation!.Result, dto.Activation.Reason));
        Assert.True(await f.Db.ServiceAgreementDraftApprovals.AnyAsync(a => a.DraftId == draft.Id));
        Assert.True((await StoredAsync(f)).IsDraft);
    }

    [Fact]
    public async Task With_the_setting_on_under_Enforce_without_evidence_it_is_approved_and_not_activated_with_the_refusal_words()
    {
        await using var f = await SetUpAsync(active: false);
        await OnboardingAsync(f);
        await SettingAsync(f, on: true);
        (await f.Db.ProviderSettings.SingleAsync(s => s.TenantId == TenantA)).ParticipantReadinessMode = ParticipantReadinessMode.Enforce;
        await f.Db.SaveChangesAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var dto = await ApproveAsync(f, draft);

        Assert.Equal((ActivationResults.NotActivated, ParticipantReadiness.ActivationEvidenceRequired), (dto.Activation!.Result, dto.Activation.Reason));
        Assert.True(await f.Db.ServiceAgreementDraftApprovals.AnyAsync(a => a.DraftId == draft.Id));
        Assert.True((await StoredAsync(f)).IsDraft);
    }

    [Fact]
    public async Task Approving_again_with_the_setting_on_changes_nobody_and_carries_no_activation()
    {
        await using var f = await SetUpAsync(active: false);
        await OnboardingAsync(f);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await ApproveAsync(f, draft);
        await SettingAsync(f, on: true);

        var again = await ApproveAsync(f, draft);

        Assert.Null(again.Activation);
        Assert.True((await StoredAsync(f)).IsDraft);
    }

    [Fact]
    public async Task With_the_setting_on_an_archived_participant_stays_archived()
    {
        await using var f = await SetUpAsync(active: false);
        var p = await f.Db.Participants.SingleAsync(x => x.Id == f.ParticipantId);
        (p.IsDraft, p.IsActive, p.IntakeCompletedAt) = (false, false, IntakeDone);
        await f.Db.SaveChangesAsync();
        await SettingAsync(f, on: true);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var dto = await ApproveAsync(f, draft);

        Assert.Equal((ActivationResults.NotActivated, "archived"), (dto.Activation!.Result, dto.Activation.Reason));
        var stored = await StoredAsync(f);
        Assert.False(stored.IsActive || stored.IsDraft);
    }

    [Fact]
    public async Task With_the_setting_on_an_active_participant_is_AlreadyActive_and_no_participant_audit_row_is_written()
    {
        await using var f = await SetUpAsync(active: true, audited: true);
        await SettingAsync(f, on: true);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var before = (await StoredAsync(f)).UpdatedAt;

        var dto = await ApproveAsync(f, draft);

        Assert.Equal((ActivationResults.AlreadyActive, "already active"), (dto.Activation!.Result, dto.Activation.Reason));
        var stored = await StoredAsync(f);
        Assert.Equal((false, true, before), (stored.IsDraft, stored.IsActive, stored.UpdatedAt));
        var rows = await f.Db.AuditLogs.Where(a => a.EntityType == nameof(Participant) && a.EntityId == f.ParticipantId && a.Action == AuditAction.Updated).ToListAsync();
        Assert.DoesNotContain(rows, r => r.Changes.Contains("\"IsDraft\"") || r.Changes.Contains("\"IsActive\""));
    }

    [Fact]
    public async Task The_participant_audit_row_of_an_activation_carries_the_reason_Agreement_approved()
    {
        await using var seed = await SetUpAsync(active: false);
        await OnboardingAsync(seed);
        await SettingAsync(seed, on: true);
        var draft = await AddRevisionAsync(seed, 1, new[] { WeekdayBlock() });
        // One request's plumbing: the interceptor sees the same HttpContext the controller does, as in the app.
        var http = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Admin.UserId!.Value.ToString()), new Claim("fullName", "Alex Admin"), new Claim(ClaimTypes.Role, "Admin") }, "test")) };
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(http);
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(seed.DbName).AddInterceptors(new AuditInterceptor(accessor.Object)).Options;
        await using var f = new Fixture { DbName = seed.DbName, Db = new OdipDbContext(options, tenant.Object), ParticipantId = seed.ParticipantId };

        var dto = Value(await Controller(f, http: http).Approve(f.ParticipantId, draft.Id, new ApproveDraftDto(), CancellationToken.None));

        Assert.Equal(ActivationResults.Activated, dto.Activation!.Result);
        var row = Assert.Single(await f.Db.AuditLogs.Where(a => a.EntityType == nameof(Participant) && a.EntityId == f.ParticipantId && a.Action == AuditAction.Updated && a.Changes.Contains("\"IsDraft\"")).ToListAsync());
        var changes = JsonDocument.Parse(row.Changes).RootElement.EnumerateArray().ToDictionary(e => e.GetProperty("Field").GetString()!, e => (e.GetProperty("Old").GetString(), e.GetProperty("New").GetString()));
        Assert.Equal(("True", "False"), changes["IsDraft"]);
        Assert.Equal(((string?)null, "Agreement approved"), changes["Reason"]);
    }

    [Fact]
    public async Task A_draft_whose_services_started_is_finalised_and_no_shift_is_made_twice()
    {
        var started = new DateTime(2026, 10, 2, 0, 0, 0, DateTimeKind.Utc);
        await using var off = await SetUpAsync(active: true);
        await OnboardingAsync(off, active: true, servicesStarted: started);
        await using var on = await SetUpAsync(active: true);
        await OnboardingAsync(on, active: true, servicesStarted: started);
        await SettingAsync(on, on: true);

        await ApproveAsync(off, await AddRevisionAsync(off, 1, new[] { WeekdayBlock() }));
        var dto = await ApproveAsync(on, await AddRevisionAsync(on, 1, new[] { WeekdayBlock() }));

        Assert.Equal(ActivationResults.Activated, dto.Activation!.Result);
        Assert.False((await StoredAsync(on)).IsDraft);
        Assert.True(await ShiftCountAsync(off) > 0);
        Assert.Equal(await ShiftCountAsync(off), await ShiftCountAsync(on));
    }

    /// <summary>Throws a busy roster on the save that finalises the participant, as a held roster lock would on Postgres.</summary>
    private sealed class BusyOnFinalise : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<Participant>().Any(e => e.State == EntityState.Modified && e.Property(p => p.IsDraft).IsModified)) throw new RosterBusyException();
            return base.SavingChangesAsync(eventData, result, ct);
        }
    }

    [Fact]
    public async Task When_the_roster_is_busy_during_the_activation_the_approval_stands_and_the_answer_says_to_use_Make_active()
    {
        await using var seed = await SetUpAsync(active: false);
        await OnboardingAsync(seed);
        await SettingAsync(seed, on: true);
        var draft = await AddRevisionAsync(seed, 1, new[] { WeekdayBlock() });
        await using var f = new Fixture { DbName = seed.DbName, Db = NewDb(seed.DbName, false, new BusyOnFinalise()), ParticipantId = seed.ParticipantId };

        var dto = await ApproveAsync(f, draft);

        Assert.Equal((ActivationResults.NotActivated, ServiceAgreementApprovalService.ActivationBusyReason), (dto.Activation!.Result, dto.Activation.Reason));
        Assert.True(await f.Db.ServiceAgreementDraftApprovals.AnyAsync(a => a.DraftId == draft.Id));
        Assert.True((await StoredAsync(f)).IsDraft);
        Assert.Empty(f.Db.ChangeTracker.Entries());
    }

    [Fact]
    public void Activation_waits_three_seconds_for_the_roster_not_the_ten_of_Make_active() =>
        Assert.Equal((TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(10)), (ServiceAgreementApprovalService.ActivationLockWait, RosterGenerationLock.DefaultWait));
}
