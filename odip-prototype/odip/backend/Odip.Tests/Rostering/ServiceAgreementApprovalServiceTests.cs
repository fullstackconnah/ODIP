using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Services;
using Odip.Application.DTOs;
using Odip.Domain.Billing;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Plan builder phase D: "Mark approved". Approving the newest revision of an agreement draft records who approved it and makes the weekly roster patterns of its blocks, ends the patterns of
/// the revision before it, and generates the next eight weeks of open shifts. Every refusal, every count and every date rule is here, on a fixed clock: the provider's today is Saturday 10 October
/// 2026 (13:00 in Sydney), the day a clock on the UTC date would also say, except where a test is about exactly that.
/// </summary>
public class ServiceAgreementApprovalServiceTests
{
    private static async Task<ApprovalOutcome> ApproveAsync(Fixture f, ServiceAgreementDraft draft, ApprovalCaller? caller = null, bool acknowledge = false) =>
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, acknowledge, caller ?? Admin, CancellationToken.None);

    private static async Task<ApprovalOutcome> PreviewAsync(Fixture f, ServiceAgreementDraft draft, ApprovalCaller? caller = null) =>
        await f.Service.PreviewAsync(TenantA, f.ParticipantId, draft.Id, caller ?? Admin, CancellationToken.None);

    // ── The preview changes nothing ───────────────────────────────────────────────

    [Fact]
    public async Task The_preview_of_a_clean_plan_says_what_approval_would_do_and_does_none_of_it()
    {
        await using var f = await SetUpAsync(audited: true);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var rowsBefore = (await f.Db.ShiftPatterns.CountAsync(), await f.Db.Shifts.CountAsync(), await f.Db.ServiceAgreementDraftApprovals.CountAsync(), await f.Db.AuditLogs.CountAsync());

        var outcome = await PreviewAsync(f, draft);

        Assert.Equal(ApprovalStatus.Previewed, outcome.Status);
        var preview = outcome.Preview!;
        Assert.Equal((true, false, 0, 5, 0, 40), (preview.CanApprove, preview.AlreadyApproved, preview.Reasons.Count, preview.PatternsToCreate, preview.PatternsToEnd, preview.ShiftsToCreate));
        Assert.Equal(HorizonEnd, preview.HorizonEnd);                                  // today + 56 days
        Assert.Empty(preview.OverlappingPatterns);
        Assert.Equal((0, 0, null, null), (preview.OldShiftsRemaining.Open, preview.OldShiftsRemaining.Assigned, preview.OldShiftsRemaining.FirstDate, preview.OldShiftsRemaining.FromVersion));
        Assert.Null(preview.ShiftsNote);
        Assert.Equal(rowsBefore, (await f.Db.ShiftPatterns.CountAsync(), await f.Db.Shifts.CountAsync(), await f.Db.ServiceAgreementDraftApprovals.CountAsync(), await f.Db.AuditLogs.CountAsync()));
    }

    [Fact]
    public async Task The_preview_gives_the_same_reasons_approval_would_refuse_for()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, shape: q => WithIssue(q, "weekdays", PlanFailureReason.NoItem, "Block 'weekdays': no item."));

        var preview = (await PreviewAsync(f, draft)).Preview!;
        var refused = await ApproveAsync(f, draft);

        Assert.False(preview.CanApprove);
        Assert.Equal(ApprovalStatus.Refused, refused.Status);
        Assert.Equal(preview.Reasons.Select(r => r.Message), refused.Errors);
    }

    // ── Approving ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Approving_a_clean_plan_records_who_and_when_makes_the_patterns_and_forty_open_shifts_and_nothing_else()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, requirements: new DraftBlockRequirementsDto { WorkerGender = "Female", Driver = true, Skills = new List<string> { "FirstAid" } });

        var outcome = await ApproveAsync(f, draft);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        var approval = await f.Db.ServiceAgreementDraftApprovals.SingleAsync();
        Assert.Equal(approval.Id, outcome.Approval!.Id);
        Assert.Equal((draft.Id, f.ParticipantId, 1, TenantA), (approval.DraftId, approval.ParticipantId, approval.DraftVersion, approval.TenantId));
        Assert.Equal((Admin.UserId, "Alex Admin", new DateTime(2026, 10, 10, 2, 0, 0, DateTimeKind.Utc)), (approval.ApprovedByUserId, approval.ApprovedByName, approval.ApprovedAt));
        Assert.Equal((5, 0, 40, (DateOnly?)new DateOnly(2026, 10, 12), (DateOnly?)HorizonEnd), (approval.PatternsCreated, approval.PatternsEnded, approval.ShiftsCreated, approval.FirstShiftDate, approval.HorizonEnd));

        var patterns = await f.Db.ShiftPatterns.OrderBy(p => p.DayOfWeek).ToListAsync();
        Assert.Equal(5, patterns.Count);
        Assert.All(patterns, p =>
        {
            Assert.Equal((draft.Id, "weekdays", 1, f.ParticipantId, TenantA), (p.SourceDraftId, p.SourceBlockKey, p.WorkerSlot, p.ParticipantId, p.TenantId));
            Assert.Equal((Start, (DateOnly?)draft.AgreementEndDate, true, (Guid?)null), (p.EffectiveFrom, p.EffectiveTo, p.IsActive, p.DefaultUserId));
        });

        var shifts = await f.Db.Shifts.ToListAsync();
        Assert.Equal(40, shifts.Count);
        Assert.All(shifts, s =>
        {
            Assert.Equal((ShiftStatus.Draft, (Guid?)null, f.ParticipantId, TenantA), (s.Status, s.UserId, s.ParticipantId, s.TenantId));
            Assert.Equal("""{"workerGender":"Female","driver":true,"skills":["FirstAid"]}""", s.RequirementsJson);
            Assert.InRange(s.ServiceDate, Start, HorizonEnd);
            Assert.Contains(s.ServiceDate.DayOfWeek, ApprovalTestSupport.Weekdays);
        });
        Assert.Equal(shifts.Count, shifts.Select(s => (s.ShiftPatternId, s.ServiceDate)).Distinct().Count());     // each pattern has each day once
        Assert.Equal(draft.Id, (await f.Db.ServiceAgreementDrafts.SingleAsync()).Id);                             // the revision itself is not touched
    }

    [Fact]
    public async Task Approving_the_same_revision_again_answers_with_the_existing_approval_and_writes_nothing_not_even_an_audit_row()
    {
        await using var f = await SetUpAsync(audited: true);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var first = await ApproveAsync(f, draft);
        var before = (await f.Db.ShiftPatterns.CountAsync(), await f.Db.Shifts.CountAsync(), await f.Db.ServiceAgreementDraftApprovals.CountAsync(), await f.Db.AuditLogs.CountAsync());
        f.Clock.Set(f.Clock.GetUtcNow().AddHours(5));

        var again = await ApproveAsync(f, draft, Coordinator);

        Assert.Equal(ApprovalStatus.AlreadyApproved, again.Status);
        Assert.Equal((first.Approval!.Id, first.Approval.ApprovedAt, first.Approval.ApprovedByName), (again.Approval!.Id, again.Approval.ApprovedAt, again.Approval.ApprovedByName));
        Assert.Equal(before, (await f.Db.ShiftPatterns.CountAsync(), await f.Db.Shifts.CountAsync(), await f.Db.ServiceAgreementDraftApprovals.CountAsync(), await f.Db.AuditLogs.CountAsync()));
    }

    [Fact]
    public async Task Approval_is_audited_one_row_for_the_approval_one_for_each_pattern_and_one_for_each_shift_by_the_person_who_approved()
    {
        await using var f = await SetUpAsync(audited: true);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        await ApproveAsync(f, draft);

        var logs = await f.Db.AuditLogs.ToListAsync();
        Assert.Equal(1, logs.Count(l => l.EntityType == "ServiceAgreementDraftApproval" && l.Action == AuditAction.Created));
        Assert.Equal(5, logs.Count(l => l.EntityType == "ShiftPattern" && l.Action == AuditAction.Created));
        Assert.Equal(40, logs.Count(l => l.EntityType == "Shift" && l.Action == AuditAction.Created));
        Assert.All(logs.Where(l => l.EntityType is "ServiceAgreementDraftApproval" or "ShiftPattern"), l => Assert.Equal(("Alex Admin", Admin.UserId), (l.ChangedByName, l.ChangedById)));
    }

    // ── What stops it ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_revision_typed_by_hand_has_no_blocks_to_make_patterns_from_and_is_told_to_rebuild_it()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, Array.Empty<PlanBlock>(), handTyped: true);

        var outcome = await ApproveAsync(f, draft);

        Assert.Equal(ApprovalStatus.Refused, outcome.Status);
        Assert.Contains("Rebuild it from blocks to approve it", Assert.Single(outcome.Errors!));
        Assert.Equal("HandTyped", (await PreviewAsync(f, draft)).Preview!.Reasons.Single().Code);
        await AssertNothingWrittenAsync(f);
    }

    [Fact]
    public async Task A_gap_in_the_catalogue_a_review_flag_an_overlap_or_a_travel_problem_each_stops_approval_whatever_else_is_right()
    {
        foreach (var (reason, message) in new[]
        {
            (PlanFailureReason.CatalogueNotFound, "Block 'weekdays': no catalogue prices for part of the period."),
            (PlanFailureReason.NoItem, "Block 'weekdays': no item for the night."),
            (PlanFailureReason.BlocksOverlap, "Blocks 'weekdays' and 'other' are on at the same time."),
            (PlanFailureReason.TravelNotClaimable, "Block 'weekdays': this item does not allow provider travel."),
            (PlanFailureReason.SleepoverNotQualifying, "Block 'weekdays': the worker may sleep, but this is not a sleepover."),
            (PlanFailureReason.ZoneNotEligible, "Block 'weekdays': no price for the zone."),
        })
        {
            await using var f = await SetUpAsync();
            var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, shape: q => WithIssue(q, "weekdays", reason, message, count: 4));

            var outcome = await ApproveAsync(f, draft);

            Assert.Equal(ApprovalStatus.Refused, outcome.Status);
            var shown = (await PreviewAsync(f, draft)).Preview!.Reasons.Single();
            Assert.Equal((reason.ToString(), "weekdays", 4, message), (shown.Code, shown.BlockId, shown.Count, shown.Message));
            Assert.Equal(new DateOnly(2026, 10, 13), shown.FirstDate);
            await AssertNothingWrittenAsync(f);
        }
    }

    [Fact]
    public async Task A_public_holiday_nobody_has_decided_stops_approval_until_each_one_is_charged_or_skipped_the_real_review_revision()
    {
        await using var f = await SetUpAsync();
        // Monday 5 October 2026 is Labour Day in NSW and the block's decision is Review (the default): the engine prices it at the holiday item and flags it for a person to decide.
        var undecided = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 18), holidays: new[] { NswLabourDay });

        var outcome = await ApproveAsync(f, undecided);

        Assert.Equal(ApprovalStatus.Refused, outcome.Status);
        var reason = Assert.Single((await PreviewAsync(f, undecided)).Preview!.Reasons);
        Assert.Equal(("HolidayUndecided", "weekdays"), (reason.Code, reason.BlockId));
        Assert.Contains("Labour Day", reason.Message);
        Assert.Contains("Charge or Skip", reason.Message);
        await AssertNothingWrittenAsync(f);
    }

    [Theory]
    [InlineData(HolidayDecision.Charge)]
    [InlineData(HolidayDecision.Skip)]
    public async Task A_public_holiday_that_is_charged_or_skipped_does_not_stop_approval(HolidayDecision decision)
    {
        await using var f = await SetUpAsync();
        var block = WeekdayBlock(change: b => b with { OnPublicHoliday = decision });
        var draft = await AddRevisionAsync(f, 1, new[] { block }, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 18), holidays: new[] { NswLabourDay });

        var outcome = await ApproveAsync(f, draft);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
    }

    [Fact]
    public async Task The_real_no_item_revision_a_community_block_over_a_weekday_night_stops_approval()
    {
        await using var f = await SetUpAsync();
        var late = Block("late", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(22), T(2));
        var draft = await AddRevisionAsync(f, 1, new[] { late });

        var outcome = await ApproveAsync(f, draft);

        Assert.Equal(ApprovalStatus.Refused, outcome.Status);
        var reason = (await PreviewAsync(f, draft)).Preview!.Reasons.Single();
        Assert.Equal(("NoItem", "late"), (reason.Code, reason.BlockId));
    }

    [Fact]
    public async Task A_line_flagged_for_review_with_no_issue_still_stops_approval_and_names_its_block()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, shape: q => q with { Totals = q.Totals with { ReviewLines = 2 } });
        foreach (var line in draft.Lines) line.Flags |= (int)PlannedLineFlags.Review;
        await f.Db.SaveChangesAsync();

        var reasons = (await PreviewAsync(f, draft)).Preview!.Reasons;

        var reason = Assert.Single(reasons);
        Assert.Equal(("ReviewFlag", "weekdays"), (reason.Code, reason.BlockId));
    }

    [Fact]
    public async Task Provisional_rates_and_unconfirmed_registration_groups_are_notices_and_never_stop_approval()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, shape: q => q with
        {
            Notices = new[] { new PlanNotice("registration-groups-not-confirmed", "The registration groups the provider holds have not been confirmed.", 1) },
            Totals = q.Totals with { ProvisionalLines = 8 },
        });

        var outcome = await ApproveAsync(f, draft);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
    }

    [Fact]
    public async Task Being_over_the_participants_budget_does_not_stop_approval_the_budget_feature_warns_about_that_separately()
    {
        await using var f = await SetUpAsync();
        f.Db.FundingSources.Add(new FundingSource { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, RouteType = FundingRouteType.PlanManaged, BudgetCategory = "Core", Budget = 100m, PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30) });
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await f.Db.SaveChangesAsync();
        Assert.True(draft.Lines.Sum(l => l.Total ?? 0m) > 100m);

        var outcome = await ApproveAsync(f, draft);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
    }

    [Fact]
    public async Task A_block_that_can_no_longer_be_read_stops_approval_it_is_never_made_into_a_pattern_as_an_empty_block()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        draft.Blocks.Single().BlockJson = """{"id":"weekdays","supportType":"ARenamedMember","days":["Monday"]}""";
        await f.Db.SaveChangesAsync();

        var outcome = await ApproveAsync(f, draft);

        Assert.Equal(ApprovalStatus.Refused, outcome.Status);
        Assert.Equal("BlockUnreadable", (await PreviewAsync(f, draft)).Preview!.Reasons.Single().Code);
        await AssertNothingWrittenAsync(f);
    }

    [Fact]
    public async Task Only_the_newest_revision_can_be_approved_and_an_older_one_is_told_a_newer_one_exists()
    {
        await using var f = await SetUpAsync();
        var older = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await AddRevisionAsync(f, 2, new[] { WeekdayBlock() });

        var outcome = await ApproveAsync(f, older);

        Assert.Equal(ApprovalStatus.Superseded, outcome.Status);
        Assert.Equal(2, outcome.NewestVersion);
        Assert.StartsWith("A newer revision of this agreement draft exists.", Assert.Single(outcome.Errors!));
        var preview = (await PreviewAsync(f, older)).Preview!;
        Assert.Equal(("Superseded", false), (preview.Reasons.Single().Code, preview.CanApprove));
        await AssertNothingWrittenAsync(f);
    }

    [Fact]
    public async Task An_agreement_that_ended_before_the_providers_today_has_nothing_left_to_roster()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, new DateOnly(2026, 8, 3), new DateOnly(2026, 10, 9));      // ended yesterday

        var outcome = await ApproveAsync(f, draft);

        Assert.Equal(ApprovalStatus.Refused, outcome.Status);
        Assert.Contains("ended on 2026-10-09", Assert.Single(outcome.Errors!));
        Assert.Equal("AgreementEnded", (await PreviewAsync(f, draft)).Preview!.Reasons.Single().Code);
    }

    [Fact]
    public async Task An_agreement_ending_today_can_still_be_approved_and_the_providers_today_is_not_the_UTC_date()
    {
        // 14:00 UTC on Friday 2 October is 01:00 on Saturday 3 October in Sydney (AEDT): the UTC date is a day behind. An agreement that ended on the 2nd is over, and one that ends on the 3rd is not.
        await using var friday = await SetUpAsync();
        await using var saturday = await SetUpAsync();
        friday.Clock.Set(new DateTimeOffset(2026, 10, 2, 14, 0, 0, TimeSpan.Zero));
        saturday.Clock.Set(new DateTimeOffset(2026, 10, 2, 14, 0, 0, TimeSpan.Zero));
        var endedFriday = await AddRevisionAsync(friday, 1, new[] { WeekdayBlock() }, new DateOnly(2026, 8, 3), new DateOnly(2026, 10, 2));
        var endsSaturday = await AddRevisionAsync(saturday, 1, new[] { WeekdayBlock() }, new DateOnly(2026, 8, 3), new DateOnly(2026, 10, 3));

        Assert.Equal("AgreementEnded", (await PreviewAsync(friday, endedFriday)).Preview!.Reasons.Single().Code);
        var open = await PreviewAsync(saturday, endsSaturday);
        Assert.Equal((ApprovalStatus.Previewed, true), (open.Status, open.Preview!.CanApprove));
    }

    [Fact]
    public async Task A_delivery_state_in_another_time_zone_than_the_providers_is_refused_naming_both_zones()
    {
        await using var f = await SetUpAsync(state: "NSW");
        var queensland = Block("qld", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Location = new PlanLocation { State = "QLD" } });
        var draft = await AddRevisionAsync(f, 1, new[] { queensland }, state: "QLD");

        var outcome = await ApproveAsync(f, draft);

        Assert.Equal(ApprovalStatus.Refused, outcome.Status);
        var message = Assert.Single(outcome.Errors!);
        Assert.Contains("Australia/Brisbane", message);
        Assert.Contains("Australia/Sydney", message);
        Assert.Equal("TimeZoneMismatch", (await PreviewAsync(f, draft)).Preview!.Reasons.Single().Code);
    }

    [Theory]
    [InlineData("VIC", "NSW")]       // Sydney and Melbourne share a zone: the common case passes
    [InlineData("ACT", "TAS")]
    [InlineData("QLD", "QLD")]
    public async Task States_that_share_a_time_zone_with_the_provider_are_allowed(string delivery, string provider)
    {
        await using var f = await SetUpAsync(state: provider);
        var block = Block("b", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Location = new PlanLocation { State = delivery } });
        var draft = await AddRevisionAsync(f, 1, new[] { block }, state: delivery);

        Assert.True((await PreviewAsync(f, draft)).Preview!.CanApprove);
    }

    [Fact]
    public async Task More_than_a_hundred_patterns_are_refused_with_the_count_and_exactly_a_hundred_is_allowed()
    {
        await using var tooMany = await SetUpAsync();
        await using var justRight = await SetUpAsync();
        var every = Enum.GetValues<DayOfWeek>();
        var big = Block("big", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(9), T(10), b => b with { Days = every, Workers = 2 });            // 14 patterns each
        var seven = Enumerable.Range(1, 7).Select(i => big with { Id = $"big{i}", Start = T(8 + i), End = T(9 + i) }).ToList();                     // 98 patterns, one block after another
        var one = Block("one", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(20), T(21), b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Tuesday } });
        var two = one with { Id = "two", Start = T(22), End = T(23) };
        var over = await AddRevisionAsync(tooMany, 1, seven.Append(one).Append(two).ToList());                       // 98 + 2 + 2 = 102
        var exact = await AddRevisionAsync(justRight, 1, seven.Append(one).ToList());                                // 98 + 2 = 100

        var refusedPreview = (await PreviewAsync(tooMany, over)).Preview!;
        Assert.Equal(("TooManyPatterns", false), (refusedPreview.Reasons.Single().Code, refusedPreview.CanApprove));
        Assert.Contains("102", refusedPreview.Reasons.Single().Message);
        Assert.Contains("100", refusedPreview.Reasons.Single().Message);
        var allowed = (await PreviewAsync(justRight, exact)).Preview!;
        Assert.Equal((100, true), (allowed.PatternsToCreate, allowed.CanApprove));
    }

    // ── Who may approve ───────────────────────────────────────────────────────────

    [Fact]
    public async Task By_default_an_admin_and_a_coordinator_may_approve_and_so_may_a_super_admin_acting_for_an_organisation()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        Assert.Equal(ApprovalStatus.Previewed, (await PreviewAsync(f, draft, Admin)).Status);
        Assert.Equal(ApprovalStatus.Previewed, (await PreviewAsync(f, draft, Coordinator)).Status);
        Assert.Equal(ApprovalStatus.Approved, (await ApproveAsync(f, draft, SuperAdmin)).Status);
    }

    [Fact]
    public async Task When_the_organisation_takes_the_coordinator_off_the_approver_list_a_coordinator_cannot_preview_or_approve()
    {
        await using var f = await SetUpAsync();
        f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApproverRoles = "Admin" });
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var preview = await PreviewAsync(f, draft, Coordinator);
        var approve = await ApproveAsync(f, draft, Coordinator);

        Assert.Equal((ApprovalStatus.NotAnApprover, ApprovalStatus.NotAnApprover), (preview.Status, approve.Status));
        Assert.Equal(ApprovalStatus.Approved, (await ApproveAsync(f, draft, Admin)).Status);
        Assert.Equal(1, await f.Db.ServiceAgreementDraftApprovals.CountAsync());
    }

    [Fact]
    public async Task A_super_admin_may_approve_even_when_the_organisation_lists_neither_role_and_a_support_worker_never_may()
    {
        await using var f = await SetUpAsync();
        f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApproverRoles = "Admin" });
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        Assert.Equal(ApprovalStatus.NotAnApprover, (await ApproveAsync(f, draft, new ApprovalCaller(Guid.NewGuid(), "Sam Worker", new[] { "SupportWorker" }))).Status);
        Assert.Equal(ApprovalStatus.Approved, (await ApproveAsync(f, draft, SuperAdmin)).Status);
    }

    [Fact]
    public async Task A_revision_of_another_organisation_or_another_participant_is_not_found()
    {
        await using var f = await SetUpAsync();
        var otherParticipant = Guid.NewGuid();
        f.Db.Participants.Add(new Participant { Id = otherParticipant, TenantId = TenantB, FirstName = "Other", LastName = "Person", IsActive = true });
        await f.Db.SaveChangesAsync();
        var theirs = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, tenantId: TenantB, participantId: otherParticipant);
        var mine = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        Assert.Equal(ApprovalStatus.Superseded, (await ApproveAsync(f, theirs)).Status);                                                              // another tenant's draft id under my participant, who has revisions: it cannot be told from one a save replaced (ServiceAgreementApprovalReplacedTests)
        Assert.Equal(ApprovalStatus.NotFound, (await f.Service.ApproveAsync(TenantA, otherParticipant, theirs.Id, false, Admin, CancellationToken.None)).Status);   // another tenant's participant
        Assert.Equal(ApprovalStatus.NotFound, (await f.Service.ApproveAsync(TenantB, f.ParticipantId, mine.Id, false, Admin, CancellationToken.None)).Status);       // my participant, asked as another tenant
        Assert.Equal(ApprovalStatus.Superseded, (await f.Service.PreviewAsync(TenantA, f.ParticipantId, Guid.NewGuid(), Admin, CancellationToken.None)).Status);   // my participant has revisions: a revision that is not there may have been replaced by a save (ServiceAgreementApprovalReplacedTests)
        Assert.Empty(await f.Db.ServiceAgreementDraftApprovals.ToListAsync());
    }

    // ── Ending the revision before ────────────────────────────────────────────────

    [Fact]
    public async Task Approving_the_next_revision_ends_the_old_patterns_the_day_before_it_starts_and_touches_no_shift_assigned_or_open()
    {
        await using var f = await SetUpAsync(audited: true);
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await ApproveAsync(f, v1);
        var staff = Guid.NewGuid();
        f.Db.Users.Add(new User { Id = staff, TenantId = TenantA, FirstName = "Ben", LastName = "Turner", Username = "ben", Email = "ben@example.com", Role = UserRole.SupportWorker, IsActive = true });
        var assigned = await f.Db.Shifts.Where(s => s.ServiceDate >= new DateOnly(2026, 11, 2)).OrderBy(s => s.ServiceDate).Take(2).ToListAsync();      // Monday 2 and Tuesday 3 November
        foreach (var shift in assigned) shift.UserId = staff;
        await f.Db.SaveChangesAsync();
        var shiftsBefore = (await f.Db.Shifts.AsNoTracking().ToListAsync()).ToDictionary(s => s.Id, s => (s.ShiftPatternId, s.ServiceDate, s.UserId, s.Status, s.StartTime, s.EndTime));
        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: new DateOnly(2026, 11, 2), end: new DateOnly(2027, 2, 28));       // starts on Monday 2 November

        var outcome = await ApproveAsync(f, v2);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        Assert.Equal(5, outcome.Approval!.PatternsEnded);
        var old = await f.Db.ShiftPatterns.Where(p => p.SourceDraftId == v1.Id).ToListAsync();
        Assert.All(old, p => Assert.Equal((new DateOnly(2026, 11, 1), true), (p.EffectiveTo!.Value, p.IsActive)));              // the day before v2 starts; still active, ending
        Assert.All(await f.Db.ShiftPatterns.Where(p => p.SourceDraftId == v2.Id).ToListAsync(), p => Assert.Equal((new DateOnly(2026, 11, 2), true), (p.EffectiveFrom, p.IsActive)));
        // every shift of v1 is as it was: not changed, cancelled or deleted, assigned or not
        var shiftsAfter = (await f.Db.Shifts.AsNoTracking().Where(s => shiftsBefore.Keys.Contains(s.Id)).ToListAsync()).ToDictionary(s => s.Id, s => (s.ShiftPatternId, s.ServiceDate, s.UserId, s.Status, s.StartTime, s.EndTime));
        Assert.Equal(shiftsBefore, shiftsAfter);
        Assert.Equal(2, shiftsAfter.Values.Count(s => s.UserId == staff));
        // each old pattern is one Updated audit row (the first approval only created patterns), by the person who approved
        var updates = (await f.Db.AuditLogs.ToListAsync()).Where(l => l.EntityType == "ShiftPattern" && l.Action == AuditAction.Updated).ToList();
        Assert.Equal(5, updates.Count);
        Assert.All(updates, l => Assert.Equal("Alex Admin", l.ChangedByName));
    }

    [Fact]
    public async Task The_result_counts_the_old_versions_shifts_on_or_after_the_new_start_open_and_assigned_separately_and_says_which_day_they_begin()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await ApproveAsync(f, v1);                                                       // 40 shifts, 12 Oct to 4 Dec
        var staff = Guid.NewGuid();
        f.Db.Users.Add(new User { Id = staff, TenantId = TenantA, FirstName = "Ben", LastName = "Turner", Username = "ben", Email = "ben@example.com", Role = UserRole.SupportWorker, IsActive = true });
        var onOrAfter = await f.Db.Shifts.Where(s => s.ServiceDate >= new DateOnly(2026, 11, 2)).OrderBy(s => s.ServiceDate).ThenBy(s => s.Id).ToListAsync();
        for (var i = 0; i < 3; i++) onOrAfter[i].UserId = staff;                         // three assigned
        onOrAfter[3].Status = ShiftStatus.Cancelled;                                     // a cancelled one is not a shift that stands
        await f.Db.SaveChangesAsync();
        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: new DateOnly(2026, 11, 2), end: new DateOnly(2027, 2, 28));
        var expectedOpen = onOrAfter.Count - 3 - 1;

        var preview = (await PreviewAsync(f, v2)).Preview!;
        var outcome = await ApproveAsync(f, v2);

        foreach (var counted in new[] { preview.OldShiftsRemaining, outcome.OldShifts! })
            Assert.Equal((expectedOpen, 3, (DateOnly?)new DateOnly(2026, 11, 2), (int?)1), (counted.Open, counted.Assigned, counted.FirstDate, counted.FromVersion));
        Assert.Equal((5, 1, new DateOnly(2026, 11, 1)), (preview.PatternsToEnd, preview.EndsFromVersion, preview.EndsOn));
    }

    [Fact]
    public async Task A_new_revision_that_starts_before_the_old_pattern_did_leaves_it_ending_before_it_starts_and_switched_off()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, start: new DateOnly(2026, 10, 19), end: new DateOnly(2026, 12, 20));
        await ApproveAsync(f, v1);
        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: new DateOnly(2026, 10, 19), end: new DateOnly(2026, 12, 20));     // starts the same day: its day-before is before v1's first day

        await ApproveAsync(f, v2);

        var old = await f.Db.ShiftPatterns.Where(p => p.SourceDraftId == v1.Id).ToListAsync();
        Assert.All(old, p => Assert.Equal((new DateOnly(2026, 10, 18), false), (p.EffectiveTo!.Value, p.IsActive)));
    }

    [Fact]
    public async Task Patterns_nobody_approved_are_never_ended_a_hand_made_one_and_an_earlier_one_that_already_ends_before_the_new_start()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 10, 11));    // its patterns already end the day before v2 starts
        await ApproveAsync(f, v1);
        var handMade = new ShiftPattern { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, DayOfWeek = DayOfWeek.Saturday, StartTime = T(9), EndTime = T(12), EffectiveFrom = new DateOnly(2026, 1, 1), IsActive = true };
        f.Db.ShiftPatterns.Add(handMade);
        await f.Db.SaveChangesAsync();
        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() });
        var earlierBefore = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == v1.Id).ToListAsync();

        var outcome = await ApproveAsync(f, v2);

        Assert.Equal(0, outcome.Approval!.PatternsEnded);
        Assert.Null((await f.Db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.Id == handMade.Id)).EffectiveTo);
        var earlierAfter = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == v1.Id).ToListAsync();
        Assert.Equal(earlierBefore.Select(p => (p.Id, p.EffectiveTo, p.IsActive)).OrderBy(p => p.Id), earlierAfter.Select(p => (p.Id, p.EffectiveTo, p.IsActive)).OrderBy(p => p.Id));
    }

    // ── A participant who is not active yet ───────────────────────────────────────

    [Fact]
    public async Task A_participant_who_is_not_active_yet_gets_the_patterns_and_no_shifts_and_is_told_when_shifts_will_come()
    {
        await using var f = await SetUpAsync(active: false, firstName: "Jordan");
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var preview = (await PreviewAsync(f, draft)).Preview!;
        var outcome = await ApproveAsync(f, draft);

        Assert.Equal((true, 5, 0, "Unfilled shifts are created once Jordan is active."), (preview.CanApprove, preview.PatternsToCreate, preview.ShiftsToCreate, preview.ShiftsNote));
        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        Assert.Equal((5, 0, (DateOnly?)null, (DateOnly?)null), (outcome.Approval!.PatternsCreated, outcome.Approval.ShiftsCreated, outcome.Approval.FirstShiftDate, outcome.Approval.HorizonEnd));
        Assert.Equal(5, await f.Db.ShiftPatterns.CountAsync());
        Assert.Empty(await f.Db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task With_the_daily_top_up_switched_off_the_note_for_a_participant_who_is_not_active_promises_nothing_and_says_what_to_do_and_the_preview_says_the_top_up_is_off()
    {
        await using var f = await SetUpAsync(active: false, firstName: "Jordan");
        f.SwitchTopUpOff();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var preview = (await PreviewAsync(f, draft)).Preview!;

        Assert.False(preview.TopUpEnabled);
        Assert.Equal("No shifts are made now, because Jordan is not active yet. The daily top-up is off, so make them with Generate on their shift patterns once they are.", preview.ShiftsNote);
        Assert.DoesNotContain("created once", preview.ShiftsNote);                              // nothing creates them once the participant is active: the job that would is off
    }

    [Fact]
    public async Task The_preview_says_the_top_up_is_on_by_default()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        Assert.True((await PreviewAsync(f, draft)).Preview!.TopUpEnabled);
    }

    // ── The dates ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Generation_runs_from_the_providers_today_when_the_agreement_started_in_the_past_but_the_patterns_keep_the_agreements_dates()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 12, 20));

        var outcome = await ApproveAsync(f, draft);

        Assert.All(await f.Db.ShiftPatterns.ToListAsync(), p => Assert.Equal(new DateOnly(2026, 9, 1), p.EffectiveFrom));
        Assert.Equal(new DateOnly(2026, 10, 12), (await f.Db.Shifts.MinAsync(s => s.ServiceDate)));          // today is Saturday 10th: the first weekday is Monday the 12th, never a past day
        Assert.Equal((new DateOnly(2026, 10, 12), HorizonEnd), (outcome.Approval!.FirstShiftDate, outcome.Approval.HorizonEnd));
    }

    [Fact]
    public async Task The_horizon_is_held_to_the_end_of_the_agreement()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, end: new DateOnly(2026, 11, 1));

        var preview = (await PreviewAsync(f, draft)).Preview!;
        var outcome = await ApproveAsync(f, draft);

        Assert.Equal(new DateOnly(2026, 11, 1), preview.HorizonEnd);
        Assert.Equal(new DateOnly(2026, 11, 1), outcome.Approval!.HorizonEnd);
        Assert.Equal(new DateOnly(2026, 10, 30), await f.Db.Shifts.MaxAsync(s => s.ServiceDate));            // the last weekday on or before the 1st
    }

    [Fact]
    public async Task An_agreement_that_starts_beyond_the_horizon_gets_its_patterns_and_no_shifts_yet()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, start: new DateOnly(2027, 1, 4), end: new DateOnly(2027, 3, 28));

        var outcome = await ApproveAsync(f, draft);

        Assert.Equal((5, 0), (outcome.Approval!.PatternsCreated, outcome.Approval.ShiftsCreated));
        Assert.Empty(await f.Db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task A_public_holiday_the_plan_skips_gets_no_shift()
    {
        await using var f = await SetUpAsync();
        var block = WeekdayBlock(change: b => b with { OnPublicHoliday = HolidayDecision.Skip });
        var draft = await AddRevisionAsync(f, 1, new[] { block }, new DateOnly(2026, 9, 28), new DateOnly(2026, 12, 20), holidays: new[] { NswLabourDay });
        await f.Db.SaveChangesAsync();
        f.Clock.Set(new DateTimeOffset(2026, 10, 2, 2, 0, 0, TimeSpan.Zero));                      // today is Friday 2 October: the window takes in Labour Day, Monday 5 October

        var preview = (await PreviewAsync(f, draft)).Preview!;
        var outcome = await ApproveAsync(f, draft);

        Assert.Empty(await f.Db.Shifts.Where(s => s.ServiceDate == new DateOnly(2026, 10, 5)).ToListAsync());
        Assert.NotEmpty(await f.Db.Shifts.Where(s => s.ServiceDate == new DateOnly(2026, 10, 6)).ToListAsync());
        Assert.Equal(outcome.Approval!.ShiftsCreated, preview.ShiftsToCreate);
    }

    // ── Hand-made patterns that overlap ───────────────────────────────────────────

    private static ShiftPattern HandMade(Fixture f, DayOfWeek day, int startHour, int endHour, Action<ShiftPattern>? change = null)
    {
        var pattern = new ShiftPattern { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, DayOfWeek = day, StartTime = T(startHour), EndTime = T(endHour), EffectiveFrom = new DateOnly(2026, 1, 1), IsActive = true, Notes = "Hand-made" };
        change?.Invoke(pattern);
        f.Db.ShiftPatterns.Add(pattern);
        return pattern;
    }

    [Fact]
    public async Task A_hand_made_pattern_that_overlaps_is_listed_and_approval_needs_it_acknowledged_and_never_changes_it()
    {
        await using var f = await SetUpAsync();
        var overlapping = HandMade(f, DayOfWeek.Monday, 12, 15);                                                  // 12-15 overlaps 9-13 on Mondays
        HandMade(f, DayOfWeek.Monday, 13, 15);                                                                    // touching at 13:00 is not an overlap
        HandMade(f, DayOfWeek.Saturday, 9, 13);                                                                   // another weekday
        HandMade(f, DayOfWeek.Tuesday, 9, 13, p => p.IsActive = false);                                           // switched off
        HandMade(f, DayOfWeek.Wednesday, 9, 13, p => { p.EffectiveFrom = new DateOnly(2025, 1, 1); p.EffectiveTo = new DateOnly(2026, 6, 30); });   // ended before the agreement
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var before = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == null).ToListAsync();

        var preview = (await PreviewAsync(f, draft)).Preview!;
        var refused = await ApproveAsync(f, draft);
        await AssertNothingWrittenAsync(f, expectedPatterns: 5);
        var approved = await ApproveAsync(f, draft, acknowledge: true);

        var listed = Assert.Single(preview.OverlappingPatterns);
        Assert.Equal((overlapping.Id, DayOfWeek.Monday, T(12), T(15), "Hand-made"), (listed.Id, listed.DayOfWeek, listed.StartTime, listed.EndTime, listed.Notes));
        Assert.True(preview.CanApprove);                                                                          // an overlap is not a refusal: it needs the box ticked
        Assert.Equal(ApprovalStatus.Refused, refused.Status);
        Assert.Contains("overlap", Assert.Single(refused.Errors!), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(ApprovalStatus.Approved, approved.Status);
        var after = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == null).ToListAsync();
        Assert.Equal(before.Select(p => (p.Id, p.EffectiveFrom, p.EffectiveTo, p.IsActive, p.StartTime, p.EndTime)).OrderBy(p => p.Id), after.Select(p => (p.Id, p.EffectiveFrom, p.EffectiveTo, p.IsActive, p.StartTime, p.EndTime)).OrderBy(p => p.Id));
    }

    [Fact]
    public async Task An_overlap_across_midnight_is_found_on_the_day_the_pattern_starts()
    {
        await using var f = await SetUpAsync();
        HandMade(f, DayOfWeek.Friday, 20, 6, p => p.EndsNextDay = true);                                          // Friday 20:00 to Saturday 06:00
        var draft = await AddRevisionAsync(f, 1, new[] { Block("late", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(2)) });

        var preview = (await PreviewAsync(f, draft)).Preview!;

        Assert.Single(preview.OverlappingPatterns);
    }

    [Fact]
    public async Task A_night_that_runs_into_the_next_day_meets_a_pattern_that_starts_that_day_and_one_that_only_touches_it_does_not()
    {
        await using var f = await SetUpAsync();
        var clashing = HandMade(f, DayOfWeek.Friday, 20, 6, p => p.EndsNextDay = true);                           // Friday 20:00 to Saturday 06:00
        var touching = HandMade(f, DayOfWeek.Friday, 20, 2, p => p.EndsNextDay = true);                           // Friday 20:00 to Saturday 02:00: ends as the new block starts
        var draft = await AddRevisionAsync(f, 1, new[] { Block("early", PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(2), T(4)) });      // Saturday 02:00 to 04:00

        var preview = (await PreviewAsync(f, draft)).Preview!;

        Assert.Equal(new[] { clashing.Id }, preview.OverlappingPatterns.Select(p => p.Id));
        Assert.DoesNotContain(touching.Id, preview.OverlappingPatterns.Select(p => p.Id));
    }

    [Fact]
    public async Task A_window_that_runs_past_saturday_night_meets_a_sunday_morning_pattern()
    {
        await using var f = await SetUpAsync();
        var saturdayNight = HandMade(f, DayOfWeek.Saturday, 22, 2, p => p.EndsNextDay = true);                    // Saturday 22:00 to Sunday 02:00
        var draft = await AddRevisionAsync(f, 1, new[] { Block("early", PlanSupportType.PersonalCare, DayOfWeek.Sunday, T(1), T(3)) });        // Sunday 01:00 to 03:00

        var preview = (await PreviewAsync(f, draft)).Preview!;

        Assert.Equal(new[] { saturdayNight.Id }, preview.OverlappingPatterns.Select(p => p.Id));
    }

    [Fact]
    public async Task The_last_night_of_a_pattern_that_runs_on_past_midnight_meets_a_pattern_that_begins_that_next_day_and_nothing_a_week_later()
    {
        // Friday 20:00 to Saturday 06:00, last on Friday 30 October: its last night runs into Saturday 31 October.
        async Task<(Fixture F, ShiftPattern Night, ServiceAgreementDraft Draft)> Setup(DateOnly start)
        {
            var f = await SetUpAsync();
            var night = HandMade(f, DayOfWeek.Friday, 20, 6, p => { p.EndsNextDay = true; p.EffectiveTo = new DateOnly(2026, 10, 30); });
            var draft = await AddRevisionAsync(f, 1, new[] { Block("early", PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(2), T(4)) }, start: start, end: new DateOnly(2026, 12, 20));
            return (f, night, draft);
        }

        var (meeting, night, begins) = await Setup(new DateOnly(2026, 10, 31));                // begins the day that last night runs into
        var (clear, _, later) = await Setup(new DateOnly(2026, 11, 7));                        // a week later
        await using var _1 = meeting;
        await using var _2 = clear;

        var meets = (await PreviewAsync(meeting, begins)).Preview!;
        var misses = (await PreviewAsync(clear, later)).Preview!;

        Assert.Equal(new[] { night.Id }, meets.OverlappingPatterns.Select(p => p.Id));
        Assert.Empty(misses.OverlappingPatterns);
    }

    // ── How far shifts were made ──────────────────────────────────────────────────

    [Fact]
    public async Task Approval_records_how_far_shifts_were_made_on_each_new_pattern_and_leaves_it_empty_when_none_were()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await using var notActive = await SetUpAsync(active: false);
        var onboarding = await AddRevisionAsync(notActive, 1, new[] { WeekdayBlock() });
        await using var later = await SetUpAsync();
        var beyond = await AddRevisionAsync(later, 1, new[] { WeekdayBlock() }, start: new DateOnly(2027, 1, 4), end: new DateOnly(2027, 3, 28));

        await ApproveAsync(f, draft);
        await ApproveAsync(notActive, onboarding);
        await ApproveAsync(later, beyond);

        Assert.All(await f.Db.ShiftPatterns.AsNoTracking().ToListAsync(), p => Assert.Equal(HorizonEnd, p.GeneratedThrough));      // today + 56 days, inside the agreement
        Assert.All(await notActive.Db.ShiftPatterns.AsNoTracking().ToListAsync(), p => Assert.Null(p.GeneratedThrough));           // nothing was made: the top-up starts from today
        Assert.All(await later.Db.ShiftPatterns.AsNoTracking().ToListAsync(), p => Assert.Null(p.GeneratedThrough));               // the agreement starts beyond the horizon
    }

    [Fact]
    public async Task Moving_how_far_shifts_were_made_is_not_an_audited_change()
    {
        await using var f = await SetUpAsync(audited: true);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await ApproveAsync(f, draft);
        var pattern = await f.Db.ShiftPatterns.FirstAsync();
        var auditRows = await f.Db.AuditLogs.CountAsync();

        pattern.GeneratedThrough = HorizonEnd.AddDays(7);
        await f.Db.SaveChangesAsync();

        Assert.Equal(auditRows, await f.Db.AuditLogs.CountAsync());
        pattern.EffectiveTo = new DateOnly(2026, 12, 1);                                                          // a real change still is
        await f.Db.SaveChangesAsync();
        Assert.Equal(auditRows + 1, await f.Db.AuditLogs.CountAsync());
    }

    // ── Which old shifts are counted ──────────────────────────────────────────────

    [Fact]
    public async Task Old_shifts_nobody_can_tidy_are_not_counted_one_under_way_one_handed_in_one_finished_or_a_day_already_past()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, start: new DateOnly(2026, 10, 1), end: new DateOnly(2026, 12, 20));
        await ApproveAsync(f, v1);                                                                                // 40 shifts, 12 October to 4 December
        var pattern = await f.Db.ShiftPatterns.FirstAsync(p => p.SourceDraftId == v1.Id);
        // a shift of v1 on a day that is already past (Thursday 8 October) and four on later days in each status
        f.Db.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, ShiftPatternId = pattern.Id, ServiceDate = new DateOnly(2026, 10, 8), StartTime = T(9), EndTime = T(13), Status = ShiftStatus.Draft });
        var later = await f.Db.Shifts.Where(s => s.ServiceDate >= new DateOnly(2026, 11, 2)).OrderBy(s => s.ServiceDate).ThenBy(s => s.Id).Take(3).ToListAsync();
        later[0].Status = ShiftStatus.InProgress; later[1].Status = ShiftStatus.PendingReview; later[2].Status = ShiftStatus.Completed;
        await f.Db.SaveChangesAsync();
        var published = await f.Db.Shifts.Where(s => s.ServiceDate >= new DateOnly(2026, 11, 2) && s.Status == ShiftStatus.Draft).OrderBy(s => s.ServiceDate).ThenBy(s => s.Id).Take(2).ToListAsync();
        published[0].Status = ShiftStatus.Published; published[1].UserId = Guid.NewGuid();                         // one published, one assigned
        await f.Db.SaveChangesAsync();
        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: new DateOnly(2026, 10, 1), end: new DateOnly(2026, 12, 20));      // starts in the past

        var counted = (await PreviewAsync(f, v2)).Preview!.OldShiftsRemaining;

        // 12 October to 4 December is 40 shifts and the one on the 8th; none of those on or after 12 October is cancelled; three are not tidy-able, and the 8th is past
        Assert.Equal((40 - 3 - 1, 1), (counted.Open, counted.Assigned));
        Assert.Equal(new DateOnly(2026, 10, 12), counted.FirstDate);                                              // from today on, not from the day v2 starts
    }

    // ── The provider's own zone ───────────────────────────────────────────────────

    [Fact]
    public async Task The_providers_zone_is_the_approving_organisations_own_never_another_organisations_settings_row()
    {
        await using var f = await SetUpAsync();
        // This organisation has no settings row (Sydney is the default); another one, in Perth, does. The context is a SuperAdmin's, so only the explicit organisation filter keeps that row out.
        f.Db.ProviderSettings.RemoveRange(await f.Db.ProviderSettings.ToListAsync());
        f.Db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantB, State = "WA" });
        await f.Db.SaveChangesAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, start: new DateOnly(2026, 10, 1), end: new DateOnly(2026, 12, 20));
        f.Clock.Set(new DateTimeOffset(2026, 10, 9, 14, 0, 0, TimeSpan.Zero));                                    // Saturday 01:00 in Sydney, still Friday 22:00 in Perth

        var preview = (await PreviewAsync(f, draft)).Preview!;
        var outcome = await ApproveAsync(f, draft);

        Assert.True(preview.CanApprove);                                                                          // Perth's zone would refuse a New South Wales agreement
        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        Assert.Equal(new DateOnly(2026, 10, 12), outcome.Approval!.FirstShiftDate);                               // Sydney's today is Saturday the 10th; Perth's Friday the 9th would give a shift that day
    }

    // ── Concurrency ───────────────────────────────────────────────────────────────

    private sealed class ApprovalRaceInterceptor(Func<Task> winnerApproves) : SaveChangesInterceptor
    {
        private bool _fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            var approving = eventData.Context!.ChangeTracker.Entries<ServiceAgreementDraftApproval>().Any(entry => entry.State == EntityState.Added);
            if (_fired || !approving) return result;
            _fired = true;
            await winnerApproves();
            throw new DbUpdateException("duplicate key value violates unique constraint", new Npgsql.PostgresException(
                messageText: "duplicate key value violates unique constraint", severity: "ERROR", invariantSeverity: "ERROR",
                sqlState: Npgsql.PostgresErrorCodes.UniqueViolation, tableName: "ServiceAgreementDraftApprovals", constraintName: "IX_ServiceAgreementDraftApprovals_DraftId"));
        }
    }

    [Fact]
    public async Task Two_approvals_racing_make_one_approval_and_the_loser_is_answered_with_the_winners()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var winner = new ApprovalRaceInterceptor(async () =>
        {
            await using var other = NewDb(f.DbName);
            await new ServiceAgreementApprovalService(other, new RosterPlacementGate(), new RosterShiftGenerator(), clock: f.Clock).ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, Coordinator, CancellationToken.None);
        });
        await using var loserDb = NewDb(f.DbName, false, winner);

        var loser = await new ServiceAgreementApprovalService(loserDb, new RosterPlacementGate(), new RosterShiftGenerator(), clock: f.Clock).ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, Admin, CancellationToken.None);

        Assert.Equal(ApprovalStatus.AlreadyApproved, loser.Status);
        Assert.Equal("Casey Coordinator", loser.Approval!.ApprovedByName);                                         // the winner's
        Assert.Equal(1, await f.Db.ServiceAgreementDraftApprovals.CountAsync());
        Assert.Equal(5, await f.Db.ShiftPatterns.CountAsync());
        Assert.Equal(40, await f.Db.Shifts.CountAsync());
    }

    private static async Task AssertNothingWrittenAsync(Fixture f, int expectedPatterns = 0)
    {
        Assert.Empty(await f.Db.ServiceAgreementDraftApprovals.ToListAsync());
        Assert.Equal(expectedPatterns, await f.Db.ShiftPatterns.CountAsync());
        Assert.Empty(await f.Db.Shifts.ToListAsync());
    }
}
