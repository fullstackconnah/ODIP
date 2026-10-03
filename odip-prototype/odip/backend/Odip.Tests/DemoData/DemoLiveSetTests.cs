using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// The live set (plan 2.1): three shifts a day that follow the provider's clock. These tests read the state the plan's tables describe "as of
/// 10:30 AEST" straight off the database after a production-order tick at that clock, and check what the app itself would say of it: the shift
/// package's finish checklist, the medication slot service's due/overdue, the handover service's read state and the participant alert rules,
/// each with the test's own fixed clock.
/// </summary>
public class DemoLiveSetTests
{
    private const string SydneyZone = "Australia/Sydney";

    private static ShiftPackageService Package(OdipDbContext db, TimeProvider clock) => new(db, new MedicationSlotService(db, clock));

    private static Task<List<PortalFinishBlockerDto>> Blockers(OdipDbContext db, TimeProvider clock, LiveDay day) =>
        Package(db, clock).GetFinishBlockersAsync(day.Shift, day.Completion, canRecordDoses: true, CancellationToken.None);

    // ── the three shifts exist, for today and yesterday, and are in the states the clock says ──

    [Fact]
    public async Task Today_ThreeLiveShiftsExist_ForTodayAndYesterday_InTheStatesTheClockSays()
    {
        var env = await TickAsync(Friday1030);

        foreach (var story in LiveSetCatalog.Stories)
        {
            var yesterday = await RequireDayAsync(env, story, Friday.AddDays(-1));
            var today = await RequireDayAsync(env, story, Friday);
            Assert.Equal(ShiftStatus.PendingReview, yesterday.Shift.Status);
            Assert.NotNull(yesterday.Completion!.SubmittedAt);
            Assert.Equal(story == LiveSetCatalog.Evening ? ShiftStatus.Published : ShiftStatus.InProgress, today.Shift.Status);
            Assert.Contains(LiveSetCatalog.Stories.Single(s => s == story).Workers, key => DemoFixture.StaffId(key) == today.Worker.Id);
            Assert.Equal(DemoFixture.ParticipantId(story.Participant), today.Shift.ParticipantId);
            Assert.Equal(story.Start, today.Shift.StartTime);
            Assert.Equal(story.End, today.Shift.EndTime);
            Assert.Equal(SupportRatio.OneToOne, today.Shift.Ratio);
            Assert.Null(today.Shift.ShiftPatternId);
        }
    }

    [Fact]
    public async Task L1_SophiesMorning_StartedAtSixFiftyEight_WithTheScriptedDosesBreakNoteAndTick_AndNothingElse()
    {
        var env = await TickAsync(Friday1030);
        var day = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        var completion = day.Completion!;

        // James-type start: the rostered 07:00 less two minutes, an instant on the provider's clock.
        Assert.Equal(At(Friday, 6, 58), Local(completion.ActualStart));
        Assert.Equal(-2, completion.VarianceMinutesStart);
        Assert.Equal(SydneyZone, completion.TimeZoneId);
        Assert.Equal(day.Worker.Id, completion.SubmittedByUserId);
        Assert.Null(completion.ActualEnd);
        Assert.Null(completion.SubmittedAt);

        var levetiracetam = day.Slot(MedicationCatalog.Levetiracetam, 8, 0)!;
        Assert.Equal(MedicationAdministrationStatus.Administered, levetiracetam.Status);
        Assert.Equal(At(Friday, 8, 4), Local(levetiracetam.AdministeredAt));
        Assert.Equal(SydneyZone, levetiracetam.AdministeredAtTimeZone);
        Assert.Equal(day.Worker.Id, levetiracetam.RecordedByUserId);

        var omeprazole = day.Slot(MedicationCatalog.IdOf("sophie-omeprazole"), 10, 0)!;
        Assert.Equal(MedicationAdministrationStatus.Refused, omeprazole.Status);
        Assert.Null(omeprazole.AdministeredAt);
        Assert.Contains("declined", omeprazole.Reason);

        var prn = day.Doses.Single(d => d.ParticipantMedicationId == MedicationCatalog.Paracetamol);
        Assert.Null(prn.ScheduledAt);
        Assert.Equal(At(Friday, 10, 20), Local(prn.AdministeredAt));
        Assert.False(string.IsNullOrWhiteSpace(prn.PrnReason));
        Assert.Null(prn.PrnOutcome);                                    // "Record outcome" is the viewer's to do

        // The 12:00 Clobazam is the dose that is due soon and is never scripted while the shift runs.
        Assert.Null(day.Slot(MedicationCatalog.IdOf("sophie-clobazam"), 12, 0));
        Assert.Equal(3, day.Doses.Count);                                // the two scheduled doses and the as-needed one, nothing else

        var brk = Assert.Single(day.Breaks);
        Assert.Equal(At(Friday, 9, 30), Local(brk.StartedAt));
        Assert.Equal(At(Friday, 9, 45), Local(brk.EndedAt));

        // Two notes: the slip the incident story files from at 09:41 (the first day only; the scanner flags it Falls and Injury), and the day's own at 10:05.
        Assert.Equal(2, day.Notes.Count);
        var slip = day.Notes[0];
        Assert.Equal(At(Friday, 9, 41), Local(slip.CreatedAt));
        Assert.Equal(ShiftNoteFlagCategory.Falls | ShiftNoteFlagCategory.Injury, slip.FlaggedCategories);
        var note = day.Notes[1];
        Assert.Equal(At(Friday, 10, 5), Local(note.CreatedAt));
        Assert.Equal(day.Worker.Id, note.AuthorUserId);
        Assert.Equal(ShiftNoteFlagCategory.None, note.FlaggedCategories);

        var tick = Assert.Single(day.Ticks);
        Assert.Equal("Morning routine", tick.RoutineTitle);
        Assert.Equal(At(Friday, 7, 0), tick.ScheduledAt);
        Assert.Equal(At(Friday, 7, 40), Local(tick.CheckedAt));
        Assert.DoesNotContain(day.Ticks, t => t.ParticipantRoutineId == Guid.Parse("74000000-0000-0000-0000-000000000001"));   // the critical epilepsy window stays pending

        var ack = Assert.Single(day.Acks);
        Assert.Equal(At(Friday, 7, 12), Local(ack.AcknowledgedAt));
        Assert.Equal(day.Worker.Id, ack.UserId);
    }

    [Fact]
    public async Task L2_HarrisonsInsulinShift_StartedTwelveMinutesLate_WithAPendingWitness_ARunningBreak_AndNoNoteYet()
    {
        var env = await TickAsync(Friday1030);
        var day = await RequireDayAsync(env, LiveSetCatalog.Insulin, Friday);
        var yesterday = await RequireDayAsync(env, LiveSetCatalog.Insulin, Friday.AddDays(-1));

        Assert.Equal(At(Friday, 8, 12), Local(day.Completion!.ActualStart));
        Assert.Equal(12, day.Completion.VarianceMinutesStart);

        var insulin = day.Slot(MedicationCatalog.InsulinGlargine, 8, 0)!;
        Assert.Equal(MedicationAdministrationStatus.Administered, insulin.Status);
        Assert.Equal(At(Friday, 8, 16), Local(insulin.AdministeredAt));
        Assert.Equal(WitnessStatus.Pending, insulin.WitnessStatus);
        Assert.NotNull(insulin.WitnessUserId);
        Assert.NotEqual(day.Worker.Id, insulin.WitnessUserId);                       // a colleague, not the person who gave it
        Assert.Equal(insulin.CreatedAt, insulin.WitnessRequestedAt);
        Assert.Null(insulin.WitnessRespondedAt);

        await using var db = env.AdminDb();
        var task = await db.BookingTasks.SingleAsync(t => t.SourceKey == $"med-witness:{insulin.Id}");
        Assert.Equal(TaskType.MedicationWitness, task.TaskType);
        Assert.Equal(TaskItemStatus.NotStarted, task.Status);
        Assert.Equal(Friday.AddDays(1), task.DueDate);                                  // the provider day after
        Assert.Equal("/portal/witness-approvals", task.LinkTo);
        Assert.Equal(insulin.Id, task.MedicationAdministrationId);

        var running = Assert.Single(day.Breaks);
        Assert.Equal(At(Friday, 10, 15), Local(running.StartedAt));
        Assert.Null(running.EndedAt);
        Assert.Empty(day.Notes);                                                       // "Add a shift note" is still on Finish's list

        // The handover Marcus-type read at 08:20, from yesterday's shift of the same story.
        var ack = Assert.Single(day.Acks);
        Assert.Equal(At(Friday, 8, 20), Local(ack.AcknowledgedAt));
        Assert.Equal(yesterday.Completion!.Id, ack.SourceCompletionId);

        // Yesterday's request was answered at 08:30 this morning, and its task closed as the portal closes it.
        var old = yesterday.Slot(MedicationCatalog.InsulinGlargine, 8, 0)!;
        Assert.Equal(WitnessStatus.Approved, old.WitnessStatus);
        Assert.Equal(At(Friday, 8, 30), Local(old.WitnessRespondedAt));
        var oldTask = await db.BookingTasks.SingleAsync(t => t.SourceKey == $"med-witness:{old.Id}");
        Assert.Equal(TaskItemStatus.Completed, oldTask.Status);
        Assert.Equal(Friday, oldTask.CompletedDate);
        Assert.Equal(At(Friday, 8, 30), Local(oldTask.AutoCompletedAt));
    }

    [Fact]
    public async Task L3_CharlottesEvening_IsPublished_WithYesterdaysHandoverUnread()
    {
        var env = await TickAsync(Friday1030);
        var today = await RequireDayAsync(env, LiveSetCatalog.Evening, Friday);
        var yesterday = await RequireDayAsync(env, LiveSetCatalog.Evening, Friday.AddDays(-1));

        Assert.Equal(ShiftStatus.Published, today.Shift.Status);
        Assert.Null(today.Completion);
        Assert.Empty(today.Acks);

        await using var db = env.AdminDb();
        var view = await new ShiftHandoverService(db, env.Clock).GetAsync(today.Shift, today.Worker.Id, CancellationToken.None);
        var handover = view.Latest!;
        Assert.Equal(yesterday.Completion!.Id, handover.CompletionId);
        Assert.Equal(LiveSetCatalog.EveningHandover(Friday.AddDays(-1)), handover.Text);
        Assert.True(handover.RequiresAcknowledgement);
        Assert.False(handover.IsRead);
        Assert.Null(handover.ReadAt);

        // The two shifts that have started have read theirs.
        foreach (var story in new[] { LiveSetCatalog.Morning, LiveSetCatalog.Insulin })
        {
            var started = await RequireDayAsync(env, story, Friday);
            var read = (await new ShiftHandoverService(db, env.Clock).GetAsync(started.Shift, started.Worker.Id, CancellationToken.None)).Latest!;
            Assert.True(read.IsRead, story.Key);
        }
    }

    // ── what the app says of that state ──

    [Fact]
    public async Task AtHalfPastTen_TheFinishChecklist_HasOnlyTheRunningBreak_OnTheInsulinShift()
    {
        var env = await TickAsync(Friday1030);
        await using var db = env.AdminDb();

        var morning = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        var insulin = await RequireDayAsync(env, LiveSetCatalog.Insulin, Friday);

        Assert.Empty(await Blockers(db, env.Clock, morning));
        var blockers = await Blockers(db, env.Clock, insulin);
        Assert.Equal(new[] { ShiftFinishBlockerCodes.BreakRunning }, blockers.Select(b => b.Code));
    }

    [Fact]
    public async Task TheDoseThatIsDue_BlocksFinishFromTwelve_AndIsOverdueFromOneOhOne()
    {
        var env = await TickAsync(Friday1030);
        var morning = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);

        // Twelve o'clock exactly: due, so Finish is blocked on it and it is not yet overdue (overdue is MORE than 60 minutes past).
        var noon = new FakeClock(new DateTimeOffset(2026, 10, 2, 2, 0, 0, TimeSpan.Zero));
        await using (var db = env.AdminDb())
        {
            var blocker = Assert.Single(await Blockers(db, noon, morning));
            Assert.Equal(ShiftFinishBlockerCodes.DoseOutcomeMissing, blocker.Code);
            Assert.Equal("Clobazam", blocker.MedicationName);
            Assert.Equal(At(Friday, 12, 0), blocker.ScheduledAt);
        }
        await AssertClobazamStateAsync(env, morning, new DateTimeOffset(2026, 10, 2, 1, 59, 0, TimeSpan.Zero), PortalDoseState.Due, blocked: false);
        await AssertClobazamStateAsync(env, morning, new DateTimeOffset(2026, 10, 2, 2, 0, 0, TimeSpan.Zero), PortalDoseState.Due, blocked: true);
        await AssertClobazamStateAsync(env, morning, new DateTimeOffset(2026, 10, 2, 3, 0, 0, TimeSpan.Zero), PortalDoseState.Due, blocked: true);      // 13:00 exactly
        await AssertClobazamStateAsync(env, morning, new DateTimeOffset(2026, 10, 2, 3, 1, 0, TimeSpan.Zero), PortalDoseState.Overdue, blocked: true);   // 13:01
    }

    private static async Task AssertClobazamStateAsync(DemoTestEnv env, LiveDay day, DateTimeOffset utc, PortalDoseState expected, bool blocked)
    {
        var clock = new FakeClock(utc);
        await using var db = env.AdminDb();
        var provider = await ProviderTimeZoneResolver.ResolveAsync(db, CancellationToken.None);
        var doses = await Package(db, clock).GetDosesAsync(day.Shift, provider, includePrn: false, CancellationToken.None);
        var slot = doses.Slots.Single(s => s.MedicationName == "Clobazam" && s.ScheduledAt == At(Friday, 12, 0));
        var local = ProviderLocalTime.UtcToLocal(utc.UtcDateTime, provider.Zone);
        Assert.Equal(expected, slot.State);
        Assert.Equal(expected == PortalDoseState.Overdue, slot.IsOverdue);
        var blocks = (await Blockers(db, clock, day)).Any(b => b.Code == ShiftFinishBlockerCodes.DoseOutcomeMissing);
        Assert.True(blocked == blocks, $"at {local:HH:mm} the Clobazam dose {(blocked ? "should" : "should not")} block Finish");
    }

    [Fact]
    public async Task TheWitnessGap_IsOnHarrisonsAlerts_AtHalfPastTen()
    {
        var env = await TickAsync(Friday1030);
        await using var db = env.AdminDb();

        var alerts = (await new ParticipantAlertsService(db, env.Clock).GetAlertsAsync(DemoFixture.ParticipantId("harrison"))).Single().Alerts;

        Assert.Contains(alerts, a => a.Type == "high-risk-medication-witness-gap");
    }

    [Fact]
    public async Task ThePendingWitnessRequest_IsInTheWitnessesPortalQueue_UntilNextMorning()
    {
        var env = await TickAsync(Friday1030);
        var insulin = await RequireDayAsync(env, LiveSetCatalog.Insulin, Friday);

        // Pending now, and still pending in the evening of the same day.
        var evening = await RunAsync(env, new DateTimeOffset(2026, 10, 2, 11, 30, 0, TimeSpan.Zero));      // 21:30 AEST
        Assert.DoesNotContain(evening.RowsChanged.Keys, key => key.EndsWith("witness requests answered", StringComparison.Ordinal));
        Assert.Equal(WitnessStatus.Pending, (await RequireDayAsync(env, LiveSetCatalog.Insulin, Friday)).Slot(MedicationCatalog.InsulinGlargine, 8, 0)!.WitnessStatus);

        // 08:29 next morning: not yet. 08:32 (a tick two minutes past the scripted 08:30): answered.
        await RunAsync(env, new DateTimeOffset(2026, 10, 2, 22, 29, 0, TimeSpan.Zero));                    // Sat 08:29 AEST
        Assert.Equal(WitnessStatus.Pending, (await RequireDayAsync(env, LiveSetCatalog.Insulin, Friday)).Slot(MedicationCatalog.InsulinGlargine, 8, 0)!.WitnessStatus);
        await RunAsync(env, new DateTimeOffset(2026, 10, 2, 22, 32, 0, TimeSpan.Zero));                    // Sat 08:32 AEST
        var answered = (await RequireDayAsync(env, LiveSetCatalog.Insulin, Friday)).Slot(MedicationCatalog.InsulinGlargine, 8, 0)!;
        Assert.Equal(WitnessStatus.Approved, answered.WitnessStatus);
        Assert.Equal(At(Friday.AddDays(1), 8, 30), Local(answered.WitnessRespondedAt));
        Assert.Equal(insulin.Slot(MedicationCatalog.InsulinGlargine, 8, 0)!.WitnessUserId, answered.WitnessUserId);
    }
}
