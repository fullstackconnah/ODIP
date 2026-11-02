using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;
using static Odip.Infrastructure.Services.ServiceAgreementApprovalService;

namespace Odip.Tests.Rostering;

/// <summary>
/// Populate roster (S11, PLAN-B 2b): approval makes the patterns and no shifts; Populate adds a revision's open shifts to ONE started week at a time, as often as asked, and never starts a week.
/// The fixture starts nine weeks (Mondays 2026-10-05 to 2026-11-30); the weekday block is five shifts a week, so 40 over the eight weeks from Monday 12 October.
/// </summary>
public class AgreementPopulateTests
{
    private static readonly DateOnly Week1 = new(2026, 10, 12), Week2 = new(2026, 10, 19);

    private static async Task<ServiceAgreementDraft> ApprovedAsync(Fixture f, int version = 1)
    {
        var draft = await AddRevisionAsync(f, version, new[] { WeekdayBlock() }, requirements: new DraftBlockRequirementsDto { WorkerGender = "Female", Driver = true, Skills = new List<string> { "FirstAid" } });
        Assert.Equal(ApprovalStatus.Approved, (await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, Admin, default)).Status);
        return draft;
    }

    private static Task<PopulateOutcome> PopulateAsync(Fixture f, Guid draftId, DateOnly? week) => f.Service.PopulateAsync(TenantA, f.ParticipantId, draftId, week, default);

    [Fact]
    public async Task Approve_creates_patterns_but_no_shifts_so_the_roster_is_empty_until_populated()
    {
        await using var f = await SetUpAsync();

        var draft = await ApprovedAsync(f);

        Assert.Equal(5, await f.Db.ShiftPatterns.CountAsync(p => p.SourceDraftId == draft.Id));
        Assert.Empty(await f.Db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task Populate_twice_creates_no_duplicates()
    {
        await using var f = await SetUpAsync();
        var draft = await ApprovedAsync(f);

        var first = await PopulateAllAsync(f.Service, f.ParticipantId, draft.Id);
        var second = await PopulateAllAsync(f.Service, f.ParticipantId, draft.Id);

        Assert.Equal((40, 0), (first.Created, first.AlreadyThere));
        Assert.Equal((0, 40), (second.Created, second.AlreadyThere));                                 // the second call adds nothing and says what was there
        var shifts = await f.Db.Shifts.AsNoTracking().ToListAsync();
        Assert.Equal(40, shifts.Select(s => (s.ShiftPatternId, s.ServiceDate)).Distinct().Count());   // each pattern and day once
    }

    [Fact]
    public async Task Populate_makes_the_shifts_the_pattern_describes()
    {
        await using var f = await SetUpAsync();
        var draft = await ApprovedAsync(f);

        await PopulateAllAsync(f.Service, f.ParticipantId, draft.Id);

        var shifts = await f.Db.Shifts.AsNoTracking().ToListAsync();
        Assert.All(shifts, s => Assert.Equal((ShiftStatus.Draft, (Guid?)null), (s.Status, s.UserId)));
        Assert.All(shifts, s => Assert.Equal("{\"workerGender\":\"Female\",\"driver\":true,\"skills\":[\"FirstAid\"]}", s.RequirementsJson));
        Assert.Equal(new DateOnly(2026, 10, 12), shifts.Min(s => s.ServiceDate));
        Assert.Equal(new DateOnly(2026, 12, 4), shifts.Max(s => s.ServiceDate));
    }

    [Fact]
    public async Task Populate_single_week_touches_only_that_week()
    {
        await using var f = await SetUpAsync();
        var draft = await ApprovedAsync(f);

        var result = (await PopulateAsync(f, draft.Id, Week2.AddDays(2))).Result!;                    // any day of the week names it

        Assert.Equal((5, 0), (result.Created, result.AlreadyThere));
        Assert.Equal(Week2, Assert.Single(result.Weeks).WeekStart);
        Assert.Equal(Enumerable.Range(0, 5).Select(i => Week2.AddDays(i)), await f.Db.Shifts.Select(s => s.ServiceDate).OrderBy(d => d).ToListAsync());
    }

    [Fact]
    public async Task Populate_refuses_unstarted_week_and_leaves_it_unstarted()
    {
        await using var f = await SetUpAsync(weeksStarted: false);
        var draft = await ApprovedAsync(f);

        var outcome = await PopulateAsync(f, draft.Id, Week1);

        Assert.Equal((PopulateStatus.BadWeek, WeekNotStartedMessage), (outcome.Status, outcome.Error));
        Assert.Empty(await StartedWeeks.MondaysAsync(f.Db, TenantA, Week1, Week1.AddDays(6), default));       // populating did not start it
        Assert.Empty(await f.Db.Shifts.ToListAsync());
        // Start still works: it adds every participant's shifts, this one's included.
        var start = new RosterWeekStarter(new RosterShiftGenerator(), new RosterAvailability(f.Db, new StaffUnavailabilityQuery(f.Db)));
        var started = await start.StartAsync(f.Db, TenantA, Week1, null, DateTime.UtcNow, default);
        Assert.Equal(5, Assert.IsType<StartedWeek>(started).Made.Count);
    }

    [Fact]
    public async Task Populate_with_no_started_week_has_nothing_to_preview_and_makes_nothing()
    {
        await using var f = await SetUpAsync(weeksStarted: false);
        var draft = await ApprovedAsync(f);

        var preview = (await f.Service.PopulatePreviewAsync(TenantA, f.ParticipantId, draft.Id, default))!;
        var all = await PopulateAsync(f, draft.Id, null);

        Assert.Empty(preview.Weeks);
        Assert.Null(preview.Note);
        Assert.Equal(0, all.Result!.Created);
        Assert.Empty(await f.Db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task Populate_does_not_recreate_cancelled_shift()
    {
        await using var f = await SetUpAsync();
        var draft = await ApprovedAsync(f);
        await PopulateAsync(f, draft.Id, Week1);
        var monday = await f.Db.Shifts.SingleAsync(s => s.ServiceDate == Week1);
        monday.Status = ShiftStatus.Cancelled;
        await f.Db.SaveChangesAsync();

        var again = (await PopulateAsync(f, draft.Id, Week1)).Result!;

        Assert.Equal((0, 5), (again.Created, again.AlreadyThere));                                    // the cancelled one counts as there
        Assert.Equal(ShiftStatus.Cancelled, (await f.Db.Shifts.AsNoTracking().SingleAsync(s => s.ServiceDate == Week1)).Status);
        Assert.Equal(5, await f.Db.Shifts.CountAsync());
    }

    [Fact]
    public async Task The_preview_counts_each_started_week_and_changes_nothing()
    {
        await using var f = await SetUpAsync();
        var draft = await ApprovedAsync(f);
        await PopulateAsync(f, draft.Id, Week1);

        var preview = (await f.Service.PopulatePreviewAsync(TenantA, f.ParticipantId, draft.Id, default))!;

        Assert.Equal(8, preview.Weeks.Count);
        Assert.Equal((Week1, 0, 5), (preview.Weeks[0].WeekStart, preview.Weeks[0].ToAdd, preview.Weeks[0].AlreadyThere));
        Assert.Equal((Week2, 5, 0), (preview.Weeks[1].WeekStart, preview.Weeks[1].ToAdd, preview.Weeks[1].AlreadyThere));
        Assert.Equal(5, await f.Db.Shifts.CountAsync());
    }

    [Fact]
    public async Task Populate_is_refused_for_an_unapproved_revision()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var outcome = await PopulateAsync(f, draft.Id, Week1);

        Assert.Equal((PopulateStatus.Refused, NotApprovedMessage), (outcome.Status, outcome.Error));
        Assert.Equal(NotApprovedMessage, (await f.Service.PopulatePreviewAsync(TenantA, f.ParticipantId, draft.Id, default))!.Note);
        Assert.Empty(await f.Db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task Populate_is_refused_for_a_revision_a_newer_one_has_replaced()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);
        await AddRevisionAsync(f, 2, new[] { WeekdayBlock() });
        var v2 = await f.Db.ServiceAgreementDrafts.SingleAsync(d => d.Version == 2);
        await MarkApprovedAsync(f.Db, v2);

        var outcome = await PopulateAsync(f, v1.Id, Week1);

        Assert.Equal((PopulateStatus.Refused, NewerApprovedMessage), (outcome.Status, outcome.Error));
        Assert.Empty(await f.Db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task Populate_is_refused_while_the_participant_is_not_active()
    {
        await using var f = await SetUpAsync(active: false);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await MarkApprovedAsync(f.Db, draft);

        var outcome = await PopulateAsync(f, draft.Id, Week1);

        Assert.Equal(PopulateStatus.Refused, outcome.Status);
        Assert.StartsWith("No shifts are made now, because Amy is not active yet.", outcome.Error);   // the gate's reason, in the ShiftsNote wording
        Assert.Empty(await f.Db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task Populate_is_refused_when_the_agreement_ended_before_today()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, start: new DateOnly(2026, 8, 3), end: new DateOnly(2026, 9, 30));
        await MarkApprovedAsync(f.Db, draft);

        var outcome = await PopulateAsync(f, draft.Id, null);

        Assert.Equal(PopulateStatus.Refused, outcome.Status);
        Assert.Contains("ended on 2026-09-30", outcome.Error);
        Assert.Empty(await f.Db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task Populate_for_another_organisations_revision_is_not_found()
    {
        await using var f = await SetUpAsync();
        var draft = await ApprovedAsync(f);

        var outcome = await f.Service.PopulateAsync(TenantB, f.ParticipantId, draft.Id, Week1, default);

        Assert.Equal(PopulateStatus.NotFound, outcome.Status);
        Assert.Null(await f.Service.PopulatePreviewAsync(TenantB, f.ParticipantId, draft.Id, default));
        Assert.Empty(await f.Db.Shifts.ToListAsync());
    }

    [Fact]
    public async Task Approve_still_removes_old_unfilled_and_carries_unchanged()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);
        await PopulateAllAsync(f.Service, f.ParticipantId, v1.Id);
        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock(change: b => b with { End = T(14) }) }, start: new DateOnly(2026, 11, 2), end: new DateOnly(2026, 12, 20));

        var outcome = await f.Service.ApproveAsync(TenantA, f.ParticipantId, v2.Id, false, Admin, default);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        Assert.Equal((0, 25, 0), (outcome.Approval!.ShiftsCreated, outcome.OldShifts!.Removed, outcome.OldShifts.Assigned));       // v1's unfilled shifts from 2 November go; approval adds none
        Assert.Equal(15, await f.Db.Shifts.CountAsync());                                              // the three weeks before the new revision starts stay
        Assert.Equal(5, await f.Db.ShiftPatterns.CountAsync(p => p.SourceDraftId == v2.Id));
    }

    [Fact]
    public async Task The_approval_preview_says_shifts_are_made_on_approval_only_when_activation_makes_them()
    {
        await using var f = await SetUpAsync();
        var activeDraft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        Assert.False((await f.Service.PreviewAsync(TenantA, f.ParticipantId, activeDraft.Id, Admin, default)).Preview!.ShiftsOnApproval);   // an active participant: approving makes the patterns only

        await using var g = await SetUpAsync(active: false);
        g.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApprovalActivatesParticipant = true });
        (await g.Db.Participants.SingleAsync(p => p.Id == g.ParticipantId)).IntakeCompletedAt = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);
        await g.Db.SaveChangesAsync();
        var onboarding = await AddRevisionAsync(g, 1, new[] { WeekdayBlock() });
        Assert.True((await g.Service.PreviewAsync(TenantA, g.ParticipantId, onboarding.Id, Admin, default)).Preview!.ShiftsOnApproval);       // activation will fill the started weeks
    }
}
