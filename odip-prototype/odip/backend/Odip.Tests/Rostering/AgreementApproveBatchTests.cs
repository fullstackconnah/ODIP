using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.AgreementListTests;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Agreements page (PR A): POST service-agreements/approve-batch. Items run in series through the approval service, one answer each, in the order sent.</summary>
public class AgreementApproveBatchTests
{
    private static AgreementApproveBatchDto Batch(params (Guid ParticipantId, Guid DraftId)[] items) =>
        new() { Items = items.Select(i => new AgreementDraftRefDto { ParticipantId = i.ParticipantId, DraftId = i.DraftId }).ToList() };

    private static async Task<(int Status, List<AgreementApproveResultDto>? Data)> PostAsync(ServiceAgreementsController controller, AgreementApproveBatchDto dto)
    {
        var result = (await controller.ApproveBatch(dto, CancellationToken.None)).Result;
        return result switch
        {
            OkObjectResult ok => (200, ((ApiResponse<List<AgreementApproveResultDto>>)ok.Value!).Data),
            ObjectResult other => (other.StatusCode ?? 0, null),
            _ => (0, null),
        };
    }

    private static Task<int> ApprovalRowsAsync(Fixture f) => f.Db.ServiceAgreementDraftApprovals.CountAsync();

    [Fact]
    public async Task A_mixed_batch_answers_every_item_in_order_and_one_refusal_never_stops_the_rest()
    {
        await using var f = await SetUpAsync();
        var p1 = f.ParticipantId;
        var d1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: p1);
        var p2 = await ParticipantAsync(f, "Ben");
        var d2 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: p2);
        await MarkApprovedAsync(f.Db, d2);
        var p3 = await ParticipantAsync(f, "Cal");
        var d3 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: p3, shape: q => WithIssue(q, "weekdays", PlanFailureReason.NoItem, "Block 'weekdays': no item."));
        var p4 = await ParticipantAsync(f, "Dee");
        var d4 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: p4);
        await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, participantId: p4);
        var p5 = await ParticipantAsync(f, "Eve");
        var d5 = await RevisionAsync(f, p5, 1, Today.AddDays(-100), Today.AddDays(-3), approved: false);
        var pB = await ParticipantAsync(f, "Zed", TenantB);
        var dB = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, tenantId: TenantB, participantId: pB);
        var p6 = await ParticipantAsync(f, "Fay");
        var d6 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: p6);

        var (status, data) = await PostAsync(Controller(f.Db, f), Batch((p1, d1.Id), (p2, d2.Id), (p3, d3.Id), (p4, d4.Id), (p5, d5.Id), (pB, dB.Id), (p6, d6.Id)));

        Assert.Equal(200, status);
        Assert.Equal(new[] { "Approved", "AlreadyApproved", "NeedsReview", "Superseded", "Ended", "NotFound", "Approved" }, data!.Select(r => r.Outcome));
        Assert.Equal(new[] { d1.Id, d2.Id, d3.Id, d4.Id, d5.Id, dB.Id, d6.Id }, data!.Select(r => r.DraftId));
        Assert.Equal("Amy Ng", data[0].ParticipantName);
        Assert.Equal(ActivationResults.Off, data[0].Activation!.Result);                  // the setting is off by default
        Assert.Null(data[1].Activation);
        Assert.Contains("no item", Assert.Single(data[2].Reasons));
        Assert.Equal(3, await ApprovalRowsAsync(f));                              // d2 (already), d1 and d6; nothing for the refused, ended, superseded or other organisation's
        Assert.True(await f.Db.ServiceAgreementDraftApprovals.AnyAsync(a => a.DraftId == d1.Id));
        Assert.False(await f.Db.ServiceAgreementDraftApprovals.AnyAsync(a => a.DraftId == dB.Id));
    }

    [Fact]
    public void The_cap_is_pinned() => Assert.Equal(25, ServiceAgreementsController.MaxItems);

    [Fact]
    public async Task No_items_and_too_many_items_are_refused_with_400_and_write_nothing()
    {
        await using var f = await SetUpAsync();
        await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var many = Enumerable.Range(0, ServiceAgreementsController.MaxItems + 1).Select(_ => (f.ParticipantId, Guid.NewGuid())).ToArray();

        Assert.Equal(400, (await PostAsync(Controller(f.Db, f), Batch())).Status);
        Assert.Equal(400, (await PostAsync(Controller(f.Db, f), Batch(many))).Status);
        Assert.Equal(0, await ApprovalRowsAsync(f));

        var exactly = Enumerable.Range(0, ServiceAgreementsController.MaxItems).Select(_ => (f.ParticipantId, Guid.NewGuid())).ToArray();
        var (status, data) = await PostAsync(Controller(f.Db, f), Batch(exactly));
        Assert.Equal(200, status);
        Assert.Equal(ServiceAgreementsController.MaxItems, data!.Count);
    }

    [Fact]
    public async Task A_draft_sent_twice_is_answered_once()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var (_, data) = await PostAsync(Controller(f.Db, f), Batch((f.ParticipantId, draft.Id), (f.ParticipantId, draft.Id)));

        Assert.Equal("Approved", Assert.Single(data!).Outcome);
    }

    [Fact]
    public async Task A_role_the_organisation_excludes_gets_403_and_nothing_is_approved()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApproverRoles = "Admin" });
        await f.Db.SaveChangesAsync();

        var (status, _) = await PostAsync(Controller(f.Db, f, role: "Coordinator"), Batch((f.ParticipantId, draft.Id)));

        Assert.Equal(403, status);
        Assert.Equal(0, await ApprovalRowsAsync(f));
    }

    [Fact]
    public async Task A_hand_made_overlap_needs_review_and_is_never_acknowledged_by_the_batch()
    {
        await using var f = await SetUpAsync();
        f.Db.ShiftPatterns.Add(new ShiftPattern { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, DayOfWeek = DayOfWeek.Monday, StartTime = T(12), EndTime = T(15), EffectiveFrom = new DateOnly(2026, 1, 1), IsActive = true, Notes = "Hand-made" });
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var (_, data) = await PostAsync(Controller(f.Db, f), Batch((f.ParticipantId, draft.Id)));

        Assert.Equal("NeedsReview", Assert.Single(data!).Outcome);
        Assert.Contains("overlap", Assert.Single(data![0].Reasons), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, await ApprovalRowsAsync(f));
    }

    [Fact]
    public async Task An_approved_agreement_that_has_since_ended_is_already_approved_not_ended()
    {
        await using var f = await SetUpAsync();
        var draft = await RevisionAsync(f, f.ParticipantId, 1, Today.AddDays(-100), Today.AddDays(-3), approved: true);

        var (_, data) = await PostAsync(Controller(f.Db, f), Batch((f.ParticipantId, draft.Id)));

        Assert.Equal("AlreadyApproved", Assert.Single(data!).Outcome);
    }

    [Theory]
    [InlineData(ApprovalStatus.Approved, "Approved")]
    [InlineData(ApprovalStatus.AlreadyApproved, "AlreadyApproved")]
    [InlineData(ApprovalStatus.Superseded, "Superseded")]
    [InlineData(ApprovalStatus.Busy, "Busy")]
    [InlineData(ApprovalStatus.NotFound, "NotFound")]
    [InlineData(ApprovalStatus.NotAnApprover, "NotAnApprover")]
    public void Each_approval_status_maps_to_its_outcome(ApprovalStatus status, string expected) =>
        Assert.Equal(expected, ServiceAgreementsController.MapOutcome(new ApprovalOutcome(status)).Outcome);

    [Fact]
    public void A_refusal_for_an_ended_agreement_is_Ended_and_any_other_refusal_needs_review()
    {
        var ended = ServiceAgreementsController.MapOutcome(new ApprovalOutcome(ApprovalStatus.Refused, Errors: new[] { "It has ended." }, ReasonCodes: new[] { "AgreementEnded" }));
        var other = ServiceAgreementsController.MapOutcome(new ApprovalOutcome(ApprovalStatus.Refused, Errors: new[] { "No item." }, ReasonCodes: new[] { "NoItem" }));

        Assert.Equal("Ended", ended.Outcome);
        Assert.Equal(new[] { "It has ended." }, ended.Reasons);
        Assert.Equal("NeedsReview", other.Outcome);
        Assert.Equal(new[] { "No item." }, other.Reasons);
    }

    /// <summary>Throws on the first save that carries an approval, then lets later saves through.</summary>
    private sealed class ThrowOnce : SaveChangesInterceptor
    {
        private bool _thrown;
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (!_thrown && eventData.Context!.ChangeTracker.Entries<ServiceAgreementDraftApproval>().Any(e => e.State == EntityState.Added))
            {
                _thrown = true;
                throw new InvalidOperationException("The save failed.");
            }
            return base.SavingChangesAsync(eventData, result, ct);
        }
    }

    [Fact]
    public async Task An_item_that_throws_is_Failed_leaves_nothing_tracked_and_the_next_item_still_approves()
    {
        await using var f = await SetUpAsync();
        var p2 = await ParticipantAsync(f, "Ben");
        var d1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var d2 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: p2);
        await using var db = NewDb(f.DbName, false, new ThrowOnce());
        var approval = new ServiceAgreementApprovalService(db, new RosterPlacementGate(), new RosterShiftGenerator(), clock: f.Clock);

        var (_, data) = await PostAsync(Controller(db, f, approval: approval), Batch((f.ParticipantId, d1.Id), (p2, d2.Id)));

        Assert.Equal(new[] { "Failed", "Approved" }, data!.Select(r => r.Outcome));
        Assert.Equal(ServiceAgreementsController.FailedWords, Assert.Single(data![0].Reasons));
        Assert.Empty(db.ChangeTracker.Entries());
    }

    /// <summary>Moves the clock on after the first approval is saved, as a slow roster lock would.</summary>
    private sealed class AdvanceAfterApproval(Odip.Tests.Medications.FakeClock clock, TimeSpan by) : SaveChangesInterceptor
    {
        private bool _approving;

        // Entries are no longer Added once the save has finished, so note the approval on the way in.
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            _approving = eventData.Context!.ChangeTracker.Entries<ServiceAgreementDraftApproval>().Any(e => e.State == EntityState.Added);
            return base.SavingChangesAsync(eventData, result, ct);
        }

        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken ct = default)
        {
            if (_approving) { _approving = false; clock.Set(clock.GetUtcNow() + by); }
            return base.SavedChangesAsync(eventData, result, ct);
        }
    }

    [Fact]
    public async Task Once_the_time_budget_is_spent_the_remaining_items_are_answered_Busy_and_not_approved()
    {
        await using var f = await SetUpAsync();
        var p2 = await ParticipantAsync(f, "Ben");
        var p3 = await ParticipantAsync(f, "Cal");
        var d1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var d2 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: p2);
        var d3 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: p3);
        await using var db = NewDb(f.DbName, false, new AdvanceAfterApproval(f.Clock, AgreementBulkService.Budget + TimeSpan.FromSeconds(1)));
        var approval = new ServiceAgreementApprovalService(db, new RosterPlacementGate(), new RosterShiftGenerator(), clock: f.Clock);

        var (status, data) = await PostAsync(Controller(db, f, approval: approval), Batch((f.ParticipantId, d1.Id), (p2, d2.Id), (p3, d3.Id)));

        Assert.Equal(200, status);
        Assert.Equal(new[] { "Approved", "Busy", "Busy" }, data!.Select(r => r.Outcome));
        Assert.Equal(new[] { d1.Id, d2.Id, d3.Id }, data!.Select(r => r.DraftId));
        Assert.All(data!.Skip(1), r => Assert.Equal(new[] { "We ran out of time before reaching this one. Try it again." }, r.Reasons));
        Assert.DoesNotContain(data!, r => r.Reasons.Any(w => w.Contains("Another change")));
        Assert.Equal(new[] { d1.Id }, await f.Db.ServiceAgreementDraftApprovals.Select(a => a.DraftId).ToArrayAsync());
    }

    // ── Moving the participant to Active (ApprovalActivatesParticipant) ───────────

    private static async Task SettingOnAsync(Fixture f)
    {
        f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApprovalActivatesParticipant = true });
        await f.Db.SaveChangesAsync();
    }

    /// <summary>An onboarding draft, not active, with its intake finished unless said.</summary>
    private static async Task<Guid> OnboardingAsync(Fixture f, string firstName, bool intake = true)
    {
        var id = await ParticipantAsync(f, firstName, active: false, draftStage: true);
        if (intake)
        {
            (await f.Db.Participants.SingleAsync(p => p.Id == id)).IntakeCompletedAt = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);
            await f.Db.SaveChangesAsync();
        }
        return id;
    }

    private static Task<bool> IsDraftAsync(Fixture f, Guid id) => f.Db.Participants.AsNoTracking().Where(p => p.Id == id).Select(p => p.IsDraft).SingleAsync();

    [Fact]
    public async Task With_the_setting_on_one_item_moves_to_Active_and_the_other_says_why_and_both_stay_Approved()
    {
        await using var f = await SetUpAsync();
        await SettingOnAsync(f);
        var ready = await OnboardingAsync(f, "Ben");
        var notYet = await OnboardingAsync(f, "Cal", intake: false);
        var d1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: ready);
        var d2 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: notYet);
        await using var db = NewDb(f.DbName);
        var approval = new ServiceAgreementApprovalService(db, new RosterPlacementGate(), new RosterShiftGenerator(), clock: f.Clock);

        var (_, data) = await PostAsync(Controller(db, f, approval: approval), Batch((ready, d1.Id), (notYet, d2.Id)));

        Assert.Equal(new[] { "Approved", "Approved" }, data!.Select(r => r.Outcome));
        Assert.Equal(ActivationResults.Activated, data[0].Activation!.Result);
        Assert.Equal((ActivationResults.NotActivated, "intake not finished"), (data[1].Activation!.Result, data[1].Activation!.Reason));
        Assert.False(await IsDraftAsync(f, ready));
        Assert.True(await IsDraftAsync(f, notYet));
        Assert.Empty(db.ChangeTracker.Entries());
    }

    /// <summary>Throws on the first save that finalises a participant (the approval's own save never does), then lets later saves through.</summary>
    private sealed class ThrowOnFirstFinalise : SaveChangesInterceptor
    {
        private bool _thrown;
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (!_thrown && eventData.Context!.ChangeTracker.Entries<Participant>().Any(e => e.State == EntityState.Modified && e.Property(p => p.IsDraft).IsModified))
            {
                _thrown = true;
                throw new InvalidOperationException("The save failed.");
            }
            return base.SavingChangesAsync(eventData, result, ct);
        }
    }

    [Fact]
    public async Task An_activation_that_throws_leaves_its_item_Approved_and_the_next_item_still_moves()
    {
        await using var f = await SetUpAsync();
        await SettingOnAsync(f);
        var p1 = await OnboardingAsync(f, "Ben");
        var p2 = await OnboardingAsync(f, "Cal");
        var d1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: p1);
        var d2 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: p2);
        await using var db = NewDb(f.DbName, false, new ThrowOnFirstFinalise());
        var approval = new ServiceAgreementApprovalService(db, new RosterPlacementGate(), new RosterShiftGenerator(), clock: f.Clock);

        var (_, data) = await PostAsync(Controller(db, f, approval: approval), Batch((p1, d1.Id), (p2, d2.Id)));

        Assert.Equal(new[] { "Approved", "Approved" }, data!.Select(r => r.Outcome));
        Assert.Equal((ActivationResults.NotActivated, ServiceAgreementApprovalService.ActivationFailedReason), (data[0].Activation!.Result, data[0].Activation!.Reason));
        Assert.Equal(ActivationResults.Activated, data[1].Activation!.Result);
        Assert.True(await IsDraftAsync(f, p1));
        Assert.False(await IsDraftAsync(f, p2));
        Assert.Equal(2, await ApprovalRowsAsync(f));
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Fact]
    public async Task Once_the_time_budget_is_spent_an_approved_item_is_not_moved_and_says_to_use_Make_active()
    {
        await using var f = await SetUpAsync();
        await SettingOnAsync(f);
        var p1 = await OnboardingAsync(f, "Ben");
        var p2 = await OnboardingAsync(f, "Cal");
        var d1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: p1);
        var d2 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: p2);
        await using var db = NewDb(f.DbName, false, new AdvanceAfterApproval(f.Clock, AgreementBulkService.Budget + TimeSpan.FromSeconds(1)));
        var approval = new ServiceAgreementApprovalService(db, new RosterPlacementGate(), new RosterShiftGenerator(), clock: f.Clock);

        var (_, data) = await PostAsync(Controller(db, f, approval: approval), Batch((p1, d1.Id), (p2, d2.Id)));

        Assert.Equal(new[] { "Approved", "Busy" }, data!.Select(r => r.Outcome));
        Assert.Equal((ActivationResults.NotActivated, "the batch ran out of time; use Make active on their page"), (data[0].Activation!.Result, data[0].Activation!.Reason));
        Assert.Null(data[1].Activation);
        Assert.True(await IsDraftAsync(f, p1));
    }
}
