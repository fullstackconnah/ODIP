using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Medications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// What the live set does with a day over time (plan 2.1, 5.2): it finishes each shift the way the worker's Finish would have required, approves
/// the old ones, builds the same rows however the ticks fall, catches up after a gap, leaves alone a shift somebody else changed, and casts only
/// people the roster board has nothing to say about.
/// </summary>
public class DemoLiveSetLifecycleTests
{
    private static readonly DateTimeOffset FridayEvening = new(2026, 10, 2, 12, 55, 0, TimeSpan.Zero);          // Fri 22:55 AEST

    // ── the end of the shift ──

    [Fact]
    public async Task AtTheEndOfTheDay_EveryLiveShift_IsFinishedTheWayFinishWouldHaveRequired()
    {
        var env = await TickAsync(FridayEvening);
        var now = env.Clock.GetUtcNow().UtcDateTime;
        await using var db = env.AdminDb();
        var checklist = new ShiftPackageService(db, new MedicationSlotService(db, env.Clock));

        foreach (var date in new[] { Friday.AddDays(-1), Friday })
            foreach (var story in LiveSetCatalog.Stories)
            {
                var day = await RequireDayAsync(env, story, date);
                var where = $"{story.Key} {date:yyyy-MM-dd}";
                var completion = day.Completion!;
                var (_, rosteredEnd) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(day.Shift, completion.TimeZoneId);

                Assert.Equal(ShiftStatus.PendingReview, day.Shift.Status);
                Assert.NotNull(completion.ActualEnd);
                Assert.NotNull(completion.SubmittedAt);
                Assert.Equal(ShiftVarianceCalculator.VarianceMinutes(completion.ActualEnd!.Value, rosteredEnd), completion.VarianceMinutesEnd);
                var (low, high) = story == LiveSetCatalog.Morning ? (12, 20) : (-6, 10);          // Sophie's morning runs over, waiting on the lunchtime dose
                Assert.InRange(completion.VarianceMinutesEnd, low, high);
                Assert.InRange((completion.SubmittedAt!.Value - completion.ActualEnd.Value).TotalMinutes, 2, 9);
                Assert.True(completion.SubmittedAt <= now, $"{where}: submitted in the future");

                // The handover: text, and never both text and "nothing to hand over".
                Assert.Equal(LiveSetCatalog.HandoverOf(story, date), completion.HandoverText);
                Assert.False(completion.NothingToHandOver, where);
                Assert.Equal(day.Notes.Count == 0, completion.NothingToNoteConfirmed);

                // No break is left running, and each ended inside the shift.
                Assert.All(day.Breaks, b =>
                {
                    Assert.NotNull(b.EndedAt);
                    Assert.True(b.EndedAt > b.StartedAt, $"{where}: a break ended before it began");
                    Assert.True(b.EndedAt <= completion.SubmittedAt, $"{where}: a break ended after the shift was submitted");
                });

                // The checklist the app enforces at Finish has nothing left on it.
                Assert.Empty(await checklist.GetFinishBlockersAsync(day.Shift, completion, canRecordDoses: true, CancellationToken.None));
            }
    }

    [Fact]
    public async Task TheLunchtimeDoseNobodyRecorded_IsWrittenAtTheEndOfSophiesShift_AsGivenALittleLate_AndThePrnOutcomeToo()
    {
        var env = await TickAsync(FridayEvening);
        var day = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);

        var clobazam = day.Slot(MedicationCatalog.IdOf("sophie-clobazam"), 12, 0)!;
        Assert.Equal(MedicationAdministrationStatus.Administered, clobazam.Status);
        var given = Local(clobazam.AdministeredAt)!.Value;
        Assert.InRange((given - At(Friday, 12, 0)).TotalMinutes, 8, 40);
        Assert.True(Local(clobazam.CreatedAt) > given, "recorded after it was given");
        Assert.True(Local(clobazam.CreatedAt) > At(Friday, 13, 1), "recorded after it had gone overdue, which is why the shift ran over");
        Assert.True(clobazam.CreatedAt <= day.Completion!.SubmittedAt, "recorded before the shift was submitted");
        Assert.Equal(day.Worker.Id, clobazam.RecordedByUserId);

        var prn = day.Doses.Single(d => d.ParticipantMedicationId == MedicationCatalog.Paracetamol);
        Assert.False(string.IsNullOrWhiteSpace(prn.PrnOutcome));
        Assert.True(prn.PrnOutcomeAt > prn.AdministeredAt && prn.PrnOutcomeAt <= day.Completion.SubmittedAt);
    }

    // ── approval, by provider days ──

    [Fact]
    public async Task AShiftThatIsThreeProviderDaysOld_IsApprovedBySarah_AndNewerOnesWaitForReview()
    {
        var env = await TickAsync(FridayEvening);
        Assert.All(await ShiftsOfAsync(env, Friday), s => Assert.Equal(ShiftStatus.PendingReview, s.Status));

        // Monday 5 Oct 10:30 AEDT (the clocks went forward on Sunday): Friday is three provider days back.
        await RunAsync(env, new DateTimeOffset(2026, 10, 4, 23, 30, 0, TimeSpan.Zero));

        var sarah = DemoFixture.StaffId("sarah");
        await using var db = env.AdminDb();
        foreach (var shift in await ShiftsOfAsync(env, Friday))
        {
            var completion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shift.Id && c.IsActive);
            Assert.Equal(ShiftStatus.Completed, shift.Status);
            Assert.Equal(ReviewOutcome.Approved, completion.ReviewOutcome);
            Assert.Equal(sarah, completion.ReviewedByUserId);
            Assert.True(completion.ReviewedAt >= completion.SubmittedAt && completion.ReviewedAt <= env.Clock.GetUtcNow().UtcDateTime);
        }
        // Sunday's shifts finished this morning's tick, only a day old.
        Assert.All(await ShiftsOfAsync(env, Friday.AddDays(2)), s => Assert.Equal(ShiftStatus.PendingReview, s.Status));
    }

    [Theory]
    [InlineData(12, 59, false)]      // Sun 4 Oct 23:59 AEDT (UTC+11): still Sunday, so Friday is only two provider days back
    [InlineData(13, 0, true)]        // Mon 5 Oct 00:00 AEDT: three
    public async Task TheApprovalDay_TurnsOverAtTheProvidersMidnight_NotAtUtcMidnight(int hourUtc, int minuteUtc, bool approved)
    {
        var env = await TickAsync(FridayEvening);

        await RunAsync(env, new DateTimeOffset(2026, 10, 4, hourUtc, minuteUtc, 0, TimeSpan.Zero));

        var expected = approved ? ShiftStatus.Completed : ShiftStatus.PendingReview;
        Assert.All(await ShiftsOfAsync(env, Friday), s => Assert.Equal(expected, s.Status));
    }

    private static async Task<List<Shift>> ShiftsOfAsync(DemoTestEnv env, DateOnly date)
    {
        await using var db = env.AdminDb();
        var ids = LiveSetCatalog.Stories.Select(s => LiveSetCatalog.ShiftId(s, date)).ToList();
        return await db.Shifts.Where(s => ids.Contains(s.Id)).ToListAsync();
    }

    // ── the same rows, however the ticks fall ──

    [Fact]
    public async Task TicksEveryFifteenMinutesThroughTheDay_BuildTheSameRowsAsOneTickAtTheEnd()
    {
        var incremental = new DemoTestEnv(new DateTimeOffset(2026, 10, 1, 20, 0, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(incremental);
        await incremental.SetProviderStateAsync("NSW");
        for (var utc = new DateTimeOffset(2026, 10, 1, 20, 0, 0, TimeSpan.Zero); utc <= FridayEvening; utc = utc.AddMinutes(15))
            await RunAsync(incremental, utc);
        var oneGo = await TickAsync(FridayEvening);

        // Compare the rows themselves (ids are name-based, so a row is found by its key), leaving out audit history: its count depends on how many saves the same rows took.
        var dates = new[] { Friday.AddDays(-1), Friday };
        var expected = LiveRows(oneGo, dates);
        Assert.True(expected.Count >= 40, $"only {expected.Count} live rows");
        Assert.Equal(expected, LiveRows(incremental, dates));
    }

    /// <summary>Every row the live set writes for these days, as one line each: the live shifts and their completions, and every break, note, tick, acknowledgement and dose.</summary>
    private static List<string> LiveRows(DemoTestEnv env, DateOnly[] dates)
    {
        using var db = env.AdminDb();
        var snapshot = DemoSnapshot.Take(db);
        var shiftIds = LiveSetCatalog.ShiftIds(dates).ToList();
        var own = shiftIds.Select(id => DemoSnapshot.KeyOf(typeof(Shift), id))
            .Concat(shiftIds.Select(id => DemoSnapshot.KeyOf(typeof(ShiftCompletion), DemoIds.For("shift-completion", id)))).ToHashSet();
        var types = new[]
        {
            nameof(ShiftBreak), nameof(ShiftNote), nameof(ShiftRoutineCheck), nameof(HandoverAcknowledgement), nameof(MedicationAdministration),
        };
        return snapshot.Keys.Where(k => own.Contains(k) || types.Contains(DemoSnapshot.TypeOf(k))).OrderBy(k => k, StringComparer.Ordinal)
            .Select(k => k + "=" + string.Join(";", snapshot.Row(k)!.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => kv.Key + ":" + kv.Value))).ToList();
    }

    [Fact]
    public async Task ASecondTick_AtTheSameClock_ChangesNothing()
    {
        var env = await TickAsync(Friday1030);
        DemoSnapshot before;
        await using (var db = env.AdminDb()) before = DemoSnapshot.Take(db);

        var again = await RunAsync(env, Friday1030);

        DemoSnapshot after;
        await using (var db = env.AdminDb()) after = DemoSnapshot.Take(db);
        Assert.Empty(before.Diff(after));
        Assert.Equal(0, again.RowsAdded.Values.Sum() + again.RowsChanged.Values.Sum());
    }

    [Fact]
    public async Task AHostThatWasOffForThreeDays_CatchesUpTheShiftsItOwes_AndLeavesNothingPublishedOrInProgressAfterItEnded()
    {
        var env = await TickAsync(Friday1030);
        await using (var db = env.AdminDb())
            Assert.Contains(await db.Shifts.ToListAsync(), s => s.Status is ShiftStatus.InProgress or ShiftStatus.Published && s.ServiceDate == Friday && s.ShiftPatternId == null);

        // Monday 10:30 AEDT.
        await RunAsync(env, new DateTimeOffset(2026, 10, 4, 23, 30, 0, TimeSpan.Zero));

        foreach (var story in LiveSetCatalog.Stories)
        {
            var friday = await RequireDayAsync(env, story, Friday);
            Assert.Equal(ShiftStatus.Completed, friday.Shift.Status);              // finished, and by now three days old
            Assert.NotNull(friday.Completion!.SubmittedAt);
            Assert.NotNull(friday.Completion.ReviewedAt);
            Assert.DoesNotContain(friday.Breaks, b => b.EndedAt is null);
        }
    }

    // ── somebody else's changes win ──

    [Fact]
    public async Task EveryLiveDose_IsFlaggedWithoutCompetency_ExactlyWhenItsRecorderHadNoCurrentCompetencyThatDay()
    {
        var env = await TickAsync(FridayEvening);
        var flagged = 0;
        var clean = 0;

        foreach (var date in new[] { Friday.AddDays(-1), Friday })
            foreach (var story in LiveSetCatalog.Stories)
            {
                var day = await RequireDayAsync(env, story, date);
                foreach (var dose in day.Doses)
                {
                    var current = MedicationCompetencyGate.Evaluate(day.Worker, date).IsCurrent;
                    Assert.Equal(!current, dose.RecordedWithoutCompetency);
                    if (dose.RecordedWithoutCompetency) flagged++; else clean++;
                }
            }

        // Emily is the evening story's own first choice and is not medication competent (plan L3): the demo shows a flagged record next to clean ones.
        Assert.True(flagged >= 1, "no live dose is flagged");
        Assert.True(clean >= 10, "too few clean live doses");
    }

    [Fact]
    public async Task AShiftTheOwnerCancelled_OrGaveToSomebodyElse_IsLeftAlone()
    {
        var env = await TickAsync(new DateTimeOffset(2026, 10, 1, 20, 30, 0, TimeSpan.Zero));              // Fri 06:30 AEST: cast, nobody has started
        var cancelled = LiveSetCatalog.ShiftId(LiveSetCatalog.Morning, Friday);
        var reassigned = LiveSetCatalog.ShiftId(LiveSetCatalog.Insulin, Friday);
        await using (var db = env.AdminDb())
        {
            (await db.Shifts.SingleAsync(s => s.Id == cancelled)).Status = ShiftStatus.Cancelled;
            (await db.Shifts.SingleAsync(s => s.Id == reassigned)).UserId = Guid.Parse("b2000000-0000-0000-0000-000000000004");      // not one of the people the stories name
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Friday1030);

        var morning = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        Assert.Equal(ShiftStatus.Cancelled, morning.Shift.Status);
        Assert.Null(morning.Completion);
        await using var check = env.AdminDb();
        var insulin = await check.Shifts.SingleAsync(s => s.Id == reassigned);
        Assert.Equal(ShiftStatus.Published, insulin.Status);
        Assert.False(await check.ShiftCompletions.AnyAsync(c => c.ShiftId == reassigned));
        // The shift nobody touched still ran.
        Assert.Equal(ShiftStatus.Published, (await RequireDayAsync(env, LiveSetCatalog.Evening, Friday)).Shift.Status);
    }

    [Fact]
    public async Task ACoordinatorsEditToAFinishedCompletion_IsNeverOverwrittenByALaterTick()
    {
        var env = await TickAsync(FridayEvening);
        var day = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        await using (var db = env.AdminDb())
        {
            var completion = await db.ShiftCompletions.SingleAsync(c => c.Id == day.Completion!.Id);
            completion.HandoverText = "Edited by the coordinator.";
            await db.SaveChangesAsync();
        }

        await RunAsync(env, FridayEvening.AddMinutes(1));
        await RunAsync(env, new DateTimeOffset(2026, 10, 4, 23, 30, 0, TimeSpan.Zero));

        Assert.Equal("Edited by the coordinator.", (await RequireDayAsync(env, LiveSetCatalog.Morning, Friday)).Completion!.HandoverText);
    }

    // ── coexistence with the old seed (plan 4.5) ──

    [Fact]
    public async Task WithoutTheOldSeedsNotes_NoNoteIsWritten_TheShiftsStillRun_AndTheSkipIsSaid()
    {
        var env = new DemoTestEnv(FridayEvening);
        await DemoFixture.SeedPeopleAsync(env, oldSeed: false);
        await env.SetProviderStateAsync("NSW");

        var result = await RunAsync(env, FridayEvening);

        await using var db = env.AdminDb();
        Assert.Empty(await db.ShiftNotes.ToListAsync());                            // the first row of a table the old seed guards with Any()
        Assert.Contains(result.SkippedStories, s => s.Contains("live shift notes", StringComparison.Ordinal));
        var morning = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        Assert.Equal(ShiftStatus.PendingReview, morning.Shift.Status);
        Assert.True(morning.Completion!.NothingToNoteConfirmed);                      // and so the completion says there was nothing to note
    }

    // ── who works the shifts ──

    [Fact]
    public async Task ForTwoWeeks_EveryCastShift_IsOneTheRosterBoardHasNothingToSayAbout_ApartFromAHolidayOrALapsedCredential()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 1, 20, 0, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        var zone = Zone();
        var skipped = new HashSet<string>();                                             // "story date", once however many ticks retried it
        var days = Enumerable.Range(0, 15).Select(i => Friday.AddDays(i)).ToList();
        foreach (var date in days)
        {
            var result = await RunAsync(env, new DateTimeOffset(ProviderLocalTime.LocalToUtc(At(date, 10, 30), zone), TimeSpan.Zero));
            foreach (var line in result.SkippedStories)
            {
                var match = System.Text.RegularExpressions.Regex.Match(line, @"live shift (live-\w+) on (\d{4}-\d{2}-\d{2})");
                if (match.Success) skipped.Add(match.Groups[1].Value + " " + match.Groups[2].Value);
            }
        }

        var ids = LiveSetCatalog.ShiftIds(days.Prepend(Friday.AddDays(-1))).ToHashSet();
        var tolerated = new HashSet<string> { "PUBLIC_HOLIDAY", "CREDENTIAL_EXPIRED" };
        var findings = new List<string>();
        foreach (var monday in days.Select(DemoAnchors.MondayOf).Distinct())
        {
            var board = await DemoBoardAssertions.BoardAsync(env, monday);
            foreach (var e in board.Exceptions.Where(e => e.ShiftId is { } id && ids.Contains(id) && !tolerated.Contains(e.Finding.Code)))
                findings.Add($"{e.ShiftId}: {e.Finding.Code}");
        }
        Assert.True(findings.Count == 0, "the board flags live shifts: " + string.Join(", ", findings.Take(10)));

        // Nobody is double-booked with a live shift, whatever the board's wording.
        await using var db = env.AdminDb();
        var shifts = (await db.Shifts.Where(s => s.UserId != null && s.Status != ShiftStatus.Cancelled).ToListAsync()).ToList();
        foreach (var live in shifts.Where(s => ids.Contains(s.Id)))
        {
            var (start, end) = ProviderLocalTime.RosteredWindowLocal(live);
            foreach (var other in shifts.Where(s => s.Id != live.Id && s.UserId == live.UserId && DemoAnchors.MondayOf(s.ServiceDate) == DemoAnchors.MondayOf(live.ServiceDate)))
            {
                var (os, oe) = ProviderLocalTime.RosteredWindowLocal(other);
                Assert.False(os < end && start < oe, $"{live.Id} on {live.ServiceDate} overlaps {other.Id} for the same worker");
            }
        }

        // A story with nobody free on a day is skipped, and said; every other one is cast.
        var castIds = shifts.Where(s => ids.Contains(s.Id)).Select(s => s.Id).ToHashSet();
        var missing = days.Prepend(Friday.AddDays(-1)).SelectMany(d => LiveSetCatalog.Stories.Select(s => (Story: s, Date: d)))
            .Where(x => !castIds.Contains(LiveSetCatalog.ShiftId(x.Story, x.Date))).Select(x => $"{x.Story.Key} {x.Date:yyyy-MM-dd}").ToHashSet();
        Assert.True(missing.SetEquals(skipped), $"not cast: {string.Join(", ", missing)}; skipped: {string.Join(", ", skipped)}");
        Assert.True(castIds.Count >= 36, $"only {castIds.Count} of {ids.Count} live shifts were cast; skipped: {string.Join(" | ", skipped.Take(8))}");
    }

    [Fact]
    public async Task WhenNobodyIsFree_TheDayIsSkipped_TheTickSaysWhoWasTriedAndWhy_AndTheNextDayIsCastAgain()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 1, 20, 30, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        await using (var db = env.AdminDb())
        {
            // Everyone any story may use is on approved leave for Thursday and Friday.
            foreach (var key in LiveSetCatalog.Stories.SelectMany(s => s.Workers).Distinct())
            {
                var id = DemoIds.For("fixture", "leave", key);
                db.LeaveRequests.Add(new LeaveRequest
                {
                    Id = id, TenantId = DemoTestEnv.DemoTenantId, UserId = DemoFixture.StaffId(key), LeaveType = LeaveType.Annual, StartDate = Friday.AddDays(-1),
                    EndDate = Friday, Status = LeaveStatus.Approved, RequestedByUserId = DemoFixture.StaffId(key), RequestedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
                    DecidedByUserId = DemoFixture.StaffId("sarah"), DecidedAt = new DateTime(2026, 9, 2, 0, 0, 0, DateTimeKind.Utc),
                });
            }
            await db.SaveChangesAsync();
        }

        var result = await RunAsync(env, new DateTimeOffset(2026, 10, 1, 20, 30, 0, TimeSpan.Zero));

        foreach (var story in LiveSetCatalog.Stories)
            foreach (var date in new[] { Friday.AddDays(-1), Friday })
            {
                Assert.Null(await DayAsync(env, story, date));                                                              // nobody is forced onto a shift
                var line = Assert.Single(result.SkippedStories, s => s.Contains(story.Key, StringComparison.Ordinal) && s.Contains(date.ToString("yyyy-MM-dd"), StringComparison.Ordinal));
                Assert.Contains("nobody on the roster is free", line, StringComparison.Ordinal);
                foreach (var key in story.Workers) Assert.Contains(key + ": ", line, StringComparison.Ordinal);            // who was tried
                Assert.Contains("STAFF_ON_LEAVE", line, StringComparison.Ordinal);                                          // and why not
            }

        // The leave ends: the next day's tick casts Saturday as usual (Friday, still inside the leave, stays unfilled).
        await RunAsync(env, new DateTimeOffset(ProviderLocalTime.LocalToUtc(At(Friday.AddDays(1), 10, 30), Zone()), TimeSpan.Zero));
        foreach (var story in LiveSetCatalog.Stories)
        {
            Assert.NotNull(await DayAsync(env, story, Friday.AddDays(1)));
            Assert.Null(await DayAsync(env, story, Friday));
        }
    }
}
