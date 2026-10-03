using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// The rest of the shift package for the shifts the roster pack closed (plan 3a): breaks, notes, routine ticks and the handover read, on the
/// completions of the last four weeks. Read back with the app's own rules: the keyword scanner, the portal's routine matcher and the handover
/// service.
/// </summary>
public class DemoShiftPackageHistoryTests
{
    /// <summary>The top-up's own closed completions in the window, with their shifts: not the live set's, not the fixture's aged stand-in.</summary>
    private sealed record Closed(ShiftCompletion Completion, Shift Shift, List<ShiftBreak> Breaks, List<ShiftNote> Notes, List<ShiftRoutineCheck> Ticks);

    private static async Task<List<Closed>> ClosedAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        var shifts = await db.Shifts.ToDictionaryAsync(s => s.Id);
        var completions = (await db.ShiftCompletions.Where(c => c.IsActive && c.SubmittedAt != null).ToListAsync())
            .Where(c => shifts[c.ShiftId].Status is ShiftStatus.PendingReview or ShiftStatus.Completed && c.Id == DemoIds.For("shift-completion", c.ShiftId)
                        && !LiveSetCatalog.Stories.Any(story => LiveSetCatalog.ShiftId(story, shifts[c.ShiftId].ServiceDate) == c.ShiftId)).ToList();
        var breaks = await db.ShiftBreaks.ToListAsync();
        var notes = await db.ShiftNotes.ToListAsync();
        var ticks = await db.ShiftRoutineChecks.ToListAsync();
        return completions.Select(c => new Closed(c, shifts[c.ShiftId], breaks.Where(b => b.ShiftCompletionId == c.Id).ToList(),
            notes.Where(n => n.ShiftId == c.ShiftId).ToList(), ticks.Where(t => t.ShiftCompletionId == c.Id).ToList())).ToList();
    }

    private static readonly DateTimeOffset Monday = new(2026, 10, 5, 0, 30, 0, TimeSpan.Zero);          // Mon 5 Oct 11:30 AEDT

    // ── breaks ──

    [Fact]
    public async Task ABreak_IsForAShiftOfFiveHoursOrMore_OfFifteenToFortyFiveMinutes_InsideTheShift_PlacedByElapsedTime()
    {
        var env = await TickAsync(Friday1030);
        var closed = await ClosedAsync(env);

        var long5 = closed.Where(c => (c.Completion.ActualEnd!.Value - c.Completion.ActualStart).TotalHours >= 5.5).ToList();
        Assert.NotEmpty(long5);
        foreach (var c in closed)
        {
            var (start, end) = ProviderLocalTime.RosteredWindowLocal(c.Shift);
            if ((end - start).TotalHours < 5 || c.Completion.StartWasManual) { Assert.Empty(c.Breaks); continue; }            // a start typed in at the Finish was never in progress: no break

            var brk = Assert.Single(c.Breaks);
            Assert.InRange((brk.EndedAt!.Value - brk.StartedAt).TotalMinutes, 15, 45);
            Assert.InRange((brk.StartedAt - c.Completion.ActualStart).TotalMinutes, 150, 225);                    // elapsed time from the start, in any zone
            Assert.True(brk.EndedAt < c.Completion.ActualEnd, "the break ends before the shift does");
            Assert.Equal(c.Completion.SubmittedByUserId, brk.CreatedByUserId);
        }
    }

    // ── notes ──

    [Fact]
    public async Task Notes_AreOnAboutHalfOfTheCompletions_ReadBackByTheScannerAsTheyWereMeant_AndTheCompletionSaysItHasOne()
    {
        var env = await TickAsync(Friday1030);
        var closed = await ClosedAsync(env);

        var withNote = closed.Where(c => c.Notes.Count > 0).ToList();
        Assert.InRange(withNote.Count, closed.Count / 4, closed.Count * 3 / 4 + 1);
        foreach (var c in closed)
        {
            // A completion with a note no longer confirms "nothing to note"; one without keeps what the roster pack wrote.
            Assert.Equal(c.Notes.Count == 0, c.Completion.NothingToNoteConfirmed);
            Assert.All(c.Notes, n =>
            {
                Assert.Equal(c.Completion.SubmittedByUserId, n.AuthorUserId);
                Assert.Equal(ShiftNoteKeywordScanner.Scan(n.Body), n.FlaggedCategories);                // never typed
                Assert.InRange(n.Body.Length, 20, 1000);
                Assert.True(n.CreatedAt > c.Completion.ActualStart && n.CreatedAt < c.Completion.ActualEnd, "written during the shift");
            });
        }
    }

    [Fact]
    public void TheCalmWordings_ScanToNothing_AndTheFlaggedOnesToTheirCategories()
    {
        foreach (var calm in ShiftPackageHistoryPack.CalmNotes)
            Assert.Equal(ShiftNoteFlagCategory.None, ShiftNoteKeywordScanner.Scan(calm.Replace("{n}", "Noah", StringComparison.Ordinal)));

        var flagged = ShiftPackageHistoryPack.FlaggedNotes.Select(n => ShiftNoteKeywordScanner.Scan(n.Replace("{n}", "Noah", StringComparison.Ordinal))).ToList();
        Assert.All(flagged, f => Assert.NotEqual(ShiftNoteFlagCategory.None, f));
        Assert.True(flagged[0].HasFlag(ShiftNoteFlagCategory.Falls));
        Assert.True(flagged[1].HasFlag(ShiftNoteFlagCategory.Medication));
        Assert.True(flagged[2].HasFlag(ShiftNoteFlagCategory.Injury));
        Assert.True(flagged[3].HasFlag(ShiftNoteFlagCategory.BehaviourOfConcern));
    }

    [Fact]
    public async Task AFlaggedNote_WasAcknowledgedByItsAuthorTheNextMorning_AndItsFollowUpTaskIsClosed()
    {
        // Several weeks of ticks, so there are enough notes for one to be flagged (about one in twenty-five).
        var env = await TickAsync(Friday1030);
        for (var week = 1; week <= 8; week++) await RunAsync(env, Friday1030.AddDays(7 * week));
        await using var db = env.AdminDb();
        var flagged = (await db.ShiftNotes.ToListAsync()).Where(n => n.FlaggedCategories != ShiftNoteFlagCategory.None && n.FlagsAcknowledgedAt != null).ToList();
        var tasks = await db.BookingTasks.Where(t => t.TaskType == TaskType.FlaggedNoteFollowUp).ToListAsync();

        Assert.NotEmpty(flagged);
        foreach (var note in flagged)
        {
            var noteDay = DateOnly.FromDateTime(Local(note.CreatedAt));
            Assert.Equal(At(noteDay.AddDays(1), 9, 15), Local(note.FlagsAcknowledgedAt));
            var task = tasks.Single(t => t.SourceKey == $"flagged-note:{note.Id}");
            Assert.Equal(TaskItemStatus.Completed, task.Status);
            Assert.Equal(noteDay.AddDays(1), task.CompletedDate);
            Assert.Equal(note.FlagsAcknowledgedAt, task.AutoCompletedAt);
            Assert.Equal(note.Id, task.ShiftNoteId);
            Assert.Equal(note.ShiftId, task.ShiftId);
            Assert.Equal("/incidents?view=flagged-notes", task.LinkTo);
            Assert.Contains("decide whether an incident is needed", task.Title, StringComparison.Ordinal);
        }
    }

    /// <summary>
    /// PR 2 review L1: a flagged note was written already acknowledged, with the acknowledgement and the closed follow-up task dated the next morning even when
    /// the shift had closed that evening, so a row said it happened in the future. The acknowledgement is the author's the next morning at 09:15; the note
    /// and its task wait for it (the way a PRN dose and its outcome wait for each other). The test finds where the flagged notes' acknowledgements fall, then
    /// replays the same ticks with one a minute before each and one just after, and looks at every flagged note and task after every tick.
    /// </summary>
    [Fact]
    public async Task AFlaggedNote_AndItsFollowUpTask_AreNeverDatedAfterTheTickThatWroteThem()
    {
        var weekly = Enumerable.Range(1, 8).Select(w => Friday1030.AddDays(7 * w)).ToList();
        var discovery = await TickAsync(Friday1030);
        foreach (var tick in weekly) await RunAsync(discovery, tick);
        List<(Guid Id, DateTimeOffset At)> found;
        await using (var db = discovery.AdminDb())
            found = (await db.ShiftNotes.ToListAsync()).Where(n => n.FlaggedCategories != ShiftNoteFlagCategory.None && n.FlagsAcknowledgedAt > Friday1030.UtcDateTime)     // after the first tick
                .Select(n => (n.Id, new DateTimeOffset(ProviderLocalTime.AsUtc(n.FlagsAcknowledgedAt!.Value)))).OrderBy(x => x.Item2).Take(3).ToList();
        Assert.NotEmpty(found);

        var around = found.SelectMany(f => new[] { f.At.AddMinutes(-1), f.At.AddMinutes(3) });
        var plan = weekly.Concat(around).Distinct().OrderBy(t => t).ToList();
        var env = await TickAsync(Friday1030);
        foreach (var tick in plan)
        {
            await RunAsync(env, tick);

            await using var db = env.AdminDb();
            var notes = (await db.ShiftNotes.ToListAsync()).Where(n => n.FlaggedCategories != ShiftNoteFlagCategory.None && n.FlagsAcknowledgedAt != null).ToList();
            var tasks = await db.BookingTasks.Where(t => t.TaskType == TaskType.FlaggedNoteFollowUp).ToListAsync();
            var now = tick.UtcDateTime;
            Assert.All(notes, n => Assert.True(n.FlagsAcknowledgedAt <= now, $"{tick:O}: a note acknowledged at {n.FlagsAcknowledgedAt:O}"));
            Assert.All(tasks.Where(t => t.AutoCompletedAt != null), t => Assert.True(t.AutoCompletedAt <= now, $"{tick:O}: a task completed at {t.AutoCompletedAt:O}"));
            Assert.All(tasks.Where(t => t.CompletedDate != null), t => Assert.True(t.CompletedDate <= DateOnly.FromDateTime(Local(now)), $"{tick:O}: a task completed on {t.CompletedDate}"));

            foreach (var f in found)
            {
                if (tick == f.At.AddMinutes(-1)) Assert.DoesNotContain(notes, n => n.Id == f.Id);                 // not there before its time ...
                if (tick == f.At.AddMinutes(3)) Assert.Contains(notes, n => n.Id == f.Id);                        // ... and there just after it
            }
        }
    }

    // ── routine ticks ──

    [Fact]
    public async Task ARoutineTick_IsForARoutineThatFallsInsideTheShift_WithTheTitleItHadThen_OncePerCompletion()
    {
        var env = await TickAsync(Friday1030);
        var closed = await ClosedAsync(env);
        await using var db = env.AdminDb();
        var routines = await db.ParticipantRoutines.ToListAsync();

        var ticked = closed.Where(c => c.Ticks.Count > 0).ToList();
        Assert.NotEmpty(ticked);
        foreach (var c in closed)
        {
            var (start, end) = ProviderLocalTime.RosteredWindowLocal(c.Shift);
            var relevant = RoutineWindowMatcher.Match(routines.Where(r => r.ParticipantId == c.Shift.ParticipantId), start, end).Select(o => o.Routine.Id).ToHashSet();
            Assert.All(c.Ticks, t => Assert.Contains(t.ParticipantRoutineId, relevant));
            Assert.Equal(c.Ticks.Count, c.Ticks.Select(t => t.ParticipantRoutineId).Distinct().Count());
            Assert.All(c.Ticks, t =>
            {
                Assert.Equal(routines.Single(r => r.Id == t.ParticipantRoutineId).Title, t.RoutineTitle);
                Assert.Equal(c.Completion.SubmittedByUserId, t.CheckedByUserId);
                Assert.True(Local(t.CheckedAt) >= start && Local(t.CheckedAt) < end, "ticked inside the shift");
            });
        }
    }

    /// <summary>PR 2 review L4: the portal only takes a tick once the shift is InProgress with a started completion, so a tick before the worker started cannot exist.</summary>
    [Fact]
    public async Task ARoutineTick_IsNeverBeforeTheWorkerStarted_ButAtLeastAMinuteAfter()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        // Sophie's morning routine falls at 07:00, the start of a 07:00 shift. Sixty such shifts whose worker started twelve minutes late (the +6 to +12
        // starts of the review's example): the tick is placed five to thirty-five minutes after the occurrence, so some would land before the start.
        var zone = Zone();
        await using (var db = env.AdminDb())
        {
            for (var i = 0; i < 60; i++)
            {
                var date = Friday.AddDays(-2 - i % 20);
                var shiftId = DemoIds.For("fixture", "late-start", i);
                var start = ProviderLocalTime.LocalToUtc(At(date, 7, 12), zone);
                var end = ProviderLocalTime.LocalToUtc(At(date, 13, 3), zone);
                db.Shifts.Add(new Shift
                {
                    Id = shiftId, TenantId = DemoTestEnv.DemoTenantId, ParticipantId = DemoFixture.ParticipantId("sophie"), UserId = DemoFixture.StaffId("james"), ServiceDate = date,
                    StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Completed,
                    CreatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc), UpdatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
                });
                db.ShiftCompletions.Add(new ShiftCompletion
                {
                    Id = DemoIds.For("shift-completion", shiftId), TenantId = DemoTestEnv.DemoTenantId, ShiftId = shiftId, ActualStart = start, ActualEnd = end, StartedAt = start,
                    SubmittedAt = end.AddMinutes(6), TimeZoneId = zone.Id, SubmittedByUserId = DemoFixture.StaffId("james"), NothingToNoteConfirmed = true, IsActive = true,
                    ReviewOutcome = ReviewOutcome.Approved, ReviewedByUserId = DemoFixture.StaffId("sarah"), ReviewedAt = end.AddDays(1), CreatedAt = end.AddMinutes(6), UpdatedAt = end.AddDays(1),
                });
            }
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Friday1030);

        await using var check = env.AdminDb();
        var late = (await check.ShiftCompletions.ToListAsync()).Where(c => c.Id == DemoIds.For("shift-completion", c.ShiftId) && Local(c.ActualStart).TimeOfDay == new TimeSpan(7, 12, 0)).ToDictionary(c => c.Id);
        var ticks = (await check.ShiftRoutineChecks.ToListAsync()).Where(t => late.ContainsKey(t.ShiftCompletionId)).ToList();
        Assert.True(ticks.Count > 60, $"only {ticks.Count} ticks to look at");                               // about four in five of each routine of the window, over sixty shifts

        // A late start moves a tick, it does not lose it: every occurrence the history ticks (four in five, by the pack's own pick) has its tick.
        var shifts = await check.Shifts.ToDictionaryAsync(s => s.Id);
        var routines = await check.ParticipantRoutines.Where(r => r.IsActive).ToListAsync();
        var expected = late.Values.Sum(c =>
        {
            var (from, to) = ProviderLocalTime.RosteredWindowLocal(shifts[c.ShiftId]);
            return RoutineWindowMatcher.Match(routines.Where(r => r.ParticipantId == shifts[c.ShiftId].ParticipantId), from, to)
                .Count(o => DemoIds.Pick(DemoIds.For("history-tick", c.Id, o.Routine.Id), "tick", 0, 99) < 80);
        });
        Assert.Equal(expected, ticks.Count);

        var early = ticks.Where(t => t.CheckedAt < late[t.ShiftCompletionId].ActualStart.AddMinutes(1)).ToList();
        Assert.True(early.Count == 0, $"{early.Count} of {ticks.Count} ticks were made before the worker started (or in the same minute), e.g. {(early.Count == 0 ? "" : $"{early[0].CheckedAt:O} against a start of {late[early[0].ShiftCompletionId].ActualStart:O}")}");
        Assert.All(ticks, t => Assert.True(Local(t.CheckedAt) < At(DateOnly.FromDateTime(Local(t.CheckedAt)), 13, 0), "and still inside the shift"));
    }

    /// <summary>Independent review N8: L4 kept a tick after the start; the same portal rule keeps it before the Finish, which can be eight minutes before the rostered end.</summary>
    [Fact]
    public async Task ARoutineTick_IsNeverAfterTheWorkerFinished()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        var zone = Zone();
        var routineId = DemoIds.For("fixture", "lunch-routine");
        await using (var db = env.AdminDb())
        {
            // A routine for the last half hour of a 07:00 to 13:00 shift, so the tick is placed at 12:35 to 13:05 and clamped to the end of the shift.
            db.ParticipantRoutines.Add(new ParticipantRoutine
            {
                Id = routineId, TenantId = DemoTestEnv.DemoTenantId, ParticipantId = DemoFixture.ParticipantId("sophie"), Title = "Settle for the afternoon", Description = "A quiet half hour.",
                StartTime = new TimeOnly(12, 30), EndTime = new TimeOnly(13, 0), IsActive = true,
            });
            for (var i = 0; i < 30; i++)
            {
                var date = Friday.AddDays(-2 - i % 20);
                var shiftId = DemoIds.For("fixture", "early-finish", i);
                var start = ProviderLocalTime.LocalToUtc(At(date, 7, 2), zone);
                var end = ProviderLocalTime.LocalToUtc(At(date, 12, 52), zone);                                // the worker finished eight minutes before the rostered end
                db.Shifts.Add(new Shift
                {
                    Id = shiftId, TenantId = DemoTestEnv.DemoTenantId, ParticipantId = DemoFixture.ParticipantId("sophie"), UserId = DemoFixture.StaffId("james"), ServiceDate = date,
                    StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Completed,
                    CreatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc), UpdatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
                });
                db.ShiftCompletions.Add(new ShiftCompletion
                {
                    Id = DemoIds.For("shift-completion", shiftId), TenantId = DemoTestEnv.DemoTenantId, ShiftId = shiftId, ActualStart = start, ActualEnd = end, StartedAt = start,
                    SubmittedAt = end.AddMinutes(6), TimeZoneId = zone.Id, SubmittedByUserId = DemoFixture.StaffId("james"), NothingToNoteConfirmed = true, IsActive = true,
                    ReviewOutcome = ReviewOutcome.Approved, ReviewedByUserId = DemoFixture.StaffId("sarah"), ReviewedAt = end.AddDays(1), CreatedAt = end.AddMinutes(6), UpdatedAt = end.AddDays(1),
                });
            }
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Friday1030);

        await using var check = env.AdminDb();
        var completions = (await check.ShiftCompletions.ToListAsync()).ToDictionary(c => c.Id);
        var ticks = (await check.ShiftRoutineChecks.Where(t => t.ParticipantRoutineId == routineId).ToListAsync());
        Assert.True(ticks.Count > 10, $"only {ticks.Count} ticks to look at");
        var late = ticks.Where(t => t.CheckedAt > completions[t.ShiftCompletionId].ActualEnd!.Value).ToList();
        Assert.True(late.Count == 0, $"{late.Count} of {ticks.Count} ticks were made after the worker finished, e.g. {(late.Count == 0 ? "" : $"{late[0].CheckedAt:O} against a finish of {completions[late[0].ShiftCompletionId].ActualEnd:O}")}");
    }

    /// <summary>
    /// Second independent review X5: one completion in ten has its start entered by hand at the Finish (the worker forgot to tap Start): the shift was never in progress,
    /// the completion is made at the Finish, and the portal takes a tick or a break only from an in-progress shift. The history wrote both for them, timed before the
    /// completion existed.
    /// </summary>
    [Fact]
    public async Task ACompletionWhoseStartWasTypedInAtTheFinish_HasNoTickAndNoBreak_ButOneThatWasStartedDoes()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        var zone = Zone();
        var manual = new HashSet<Guid>();
        await using (var db = env.AdminDb())
        {
            for (var i = 0; i < 40; i++)
            {
                var date = Friday.AddDays(-2 - i % 20);
                var shiftId = DemoIds.For("fixture", "manual-start", i);
                var start = ProviderLocalTime.LocalToUtc(At(date, 7, 2), zone);
                var end = ProviderLocalTime.LocalToUtc(At(date, 13, 3), zone);
                var typedIn = i % 2 == 0;
                db.Shifts.Add(new Shift
                {
                    Id = shiftId, TenantId = DemoTestEnv.DemoTenantId, ParticipantId = DemoFixture.ParticipantId("sophie"), UserId = DemoFixture.StaffId("james"), ServiceDate = date,
                    StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Completed,
                    CreatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc), UpdatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
                });
                var completionId = DemoIds.For("shift-completion", shiftId);
                if (typedIn) manual.Add(completionId);
                db.ShiftCompletions.Add(new ShiftCompletion
                {
                    Id = completionId, TenantId = DemoTestEnv.DemoTenantId, ShiftId = shiftId, ActualStart = start, ActualEnd = end, StartedAt = typedIn ? end.AddMinutes(6) : start, StartWasManual = typedIn,
                    SubmittedAt = end.AddMinutes(6), TimeZoneId = zone.Id, SubmittedByUserId = DemoFixture.StaffId("james"), NothingToNoteConfirmed = true, IsActive = true,
                    ReviewOutcome = ReviewOutcome.Approved, ReviewedByUserId = DemoFixture.StaffId("sarah"), ReviewedAt = end.AddDays(1), CreatedAt = end.AddMinutes(6), UpdatedAt = end.AddDays(1),
                });
            }
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Friday1030);

        await using var check = env.AdminDb();
        var ticks = await check.ShiftRoutineChecks.ToListAsync();
        var breaks = await check.ShiftBreaks.ToListAsync();
        Assert.Empty(ticks.Where(t => manual.Contains(t.ShiftCompletionId)));
        Assert.Empty(breaks.Where(b => manual.Contains(b.ShiftCompletionId)));
        Assert.True(ticks.Count(t => !manual.Contains(t.ShiftCompletionId) && t.CheckedAt > DateTime.MinValue) > 10, "the completions that were started got no ticks, so the test could not see the defect");
        Assert.True(breaks.Count(b => !manual.Contains(b.ShiftCompletionId)) > 5, "the completions that were started got no breaks, so the test could not see the defect");
    }

    // ── the handover read ──

    /// <summary>A closed shift of the top-up's making (the completion id is the one the roster pack would give), for a participant, by a worker, on a date.</summary>
    private static (Shift Shift, ShiftCompletion Completion) ClosedShift(Guid shiftId, string participant, string worker, DateOnly date, string handover)
    {
        var zone = Zone();
        var shift = new Shift
        {
            Id = shiftId, TenantId = DemoTestEnv.DemoTenantId, ParticipantId = DemoFixture.ParticipantId(participant), UserId = DemoFixture.StaffId(worker),
            ServiceDate = date, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Completed,
            CreatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc), UpdatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
        };
        var start = ProviderLocalTime.LocalToUtc(At(date, 9, 2), zone);
        var end = ProviderLocalTime.LocalToUtc(At(date, 13, 3), zone);
        var completion = new ShiftCompletion
        {
            Id = DemoIds.For("shift-completion", shiftId), TenantId = DemoTestEnv.DemoTenantId, ShiftId = shiftId, ActualStart = start, ActualEnd = end, StartedAt = start,
            SubmittedAt = end.AddMinutes(6), TimeZoneId = zone.Id, SubmittedByUserId = DemoFixture.StaffId(worker), HandoverText = handover, NothingToHandOver = false,
            NothingToNoteConfirmed = true, IsActive = true, ReviewOutcome = ReviewOutcome.Approved, ReviewedByUserId = DemoFixture.StaffId("sarah"),
            ReviewedAt = end.AddDays(1), CreatedAt = end.AddMinutes(6), UpdatedAt = end.AddDays(1),
        };
        return (shift, completion);
    }

    /// <summary>A shift id whose completion the history reads (or leaves unread): the unread pick is fixed by the completion id, so search for ids that give each.</summary>
    private static Guid ShiftIdWhoseHandoverIs(bool read, string prefix) =>
        Enumerable.Range(0, 400).Select(i => DemoIds.For("fixture", prefix, i))
            .First(id => (DemoIds.Pick(DemoIds.For("shift-completion", id), "unread", 0, 99) >= 12) == read);

    [Fact]
    public async Task AHandoverRead_IsTheOneTheAppWouldShowTheReader_ByANewWorkerAfterItWasSubmitted_AndSomeStayUnread()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        // Noah, three days running, a different worker each day: the second reads the first's handover; the third's reading is one of the few left undone.
        var first = ClosedShift(DemoIds.For("fixture", "ack-source"), "noah", "james", Friday.AddDays(-5), "Settled morning. Out for coffee, back by noon.");
        var read = ClosedShift(ShiftIdWhoseHandoverIs(true, "ack-read"), "noah", "brendan", Friday.AddDays(-4), "Quiet day, helped with the garden.");
        var unread = ClosedShift(ShiftIdWhoseHandoverIs(false, "ack-unread"), "noah", "rachel", Friday.AddDays(-3), "Rested after lunch.");
        await using (var db = env.AdminDb())
        {
            foreach (var (shift, completion) in new[] { first, read, unread })
            {
                db.Shifts.Add(shift);
                db.ShiftCompletions.Add(completion);
            }
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Friday1030);

        await using var check = env.AdminDb();
        var service = new ShiftHandoverService(check, env.Clock);
        var ack = await check.HandoverAcknowledgements.SingleAsync(a => a.ShiftId == read.Shift.Id);
        Assert.Equal(first.Completion.Id, ack.SourceCompletionId);
        Assert.Equal(DemoFixture.StaffId("brendan"), ack.UserId);
        Assert.InRange((ack.AcknowledgedAt - read.Completion.ActualStart).TotalMinutes, 8, 40);               // from the reader's own shift
        Assert.False(await check.HandoverAcknowledgements.AnyAsync(a => a.ShiftId == unread.Shift.Id));

        // And the app's own view agrees: the latest handover for each reader, read or not.
        var readView = (await service.GetAsync(read.Shift, read.Shift.UserId!.Value, CancellationToken.None)).Latest!;
        Assert.Equal(first.Completion.Id, readView.CompletionId);
        Assert.True(readView.IsRead);
        var unreadView = (await service.GetAsync(unread.Shift, unread.Shift.UserId!.Value, CancellationToken.None)).Latest!;
        Assert.Equal(read.Completion.Id, unreadView.CompletionId);
        Assert.False(unreadView.IsRead);
        Assert.True(unreadView.RequiresAcknowledgement);
    }

    // PR 2 review finding H1: a person's own row beside the history's. The app allows one acknowledgement per reader and handover and one tick per
    // completion, routine and occurrence, and a row a person makes has a random id where the pack's is deterministic.
    [Fact]
    public async Task APersonsOwnAcknowledgement_OfTheHandoverTheHistoryWouldHaveReadForThem_IsKept_AndThePackGoesOn()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        var first = ClosedShift(DemoIds.For("fixture", "ack-source"), "noah", "james", Friday.AddDays(-5), "Settled morning. Out for coffee, back by noon.");
        var read = ClosedShift(ShiftIdWhoseHandoverIs(true, "ack-read"), "noah", "brendan", Friday.AddDays(-4), "Quiet day, helped with the garden.");
        var theirs = new HandoverAcknowledgement
        {
            Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, SourceCompletionId = first.Completion.Id, ShiftId = read.Shift.Id, UserId = DemoFixture.StaffId("brendan"),
            AcknowledgedAt = read.Completion.ActualStart.AddMinutes(10),
        };
        await using (var db = env.AdminDb())
        {
            db.Shifts.AddRange(first.Shift, read.Shift);
            db.ShiftCompletions.AddRange(first.Completion, read.Completion);
            db.HandoverAcknowledgements.Add(theirs);                                     // Brendan opened the handover in the portal before the history was written
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Friday1030);

        await using var check = env.AdminDb();
        Assert.Equal(theirs.Id, (await check.HandoverAcknowledgements.SingleAsync(a => a.SourceCompletionId == first.Completion.Id && a.UserId == DemoFixture.StaffId("brendan"))).Id);
        Assert.NotEmpty(await check.ShiftBreaks.ToListAsync());                             // and the rest of the history was still written
    }

    [Fact]
    public async Task APersonsOwnTick_OfARoutineTheHistoryWouldHaveTicked_IsKept_AndThePackGoesOn()
    {
        var env = await TickAsync(Friday1030);
        Guid completion, routine;
        DateTime? scheduled;
        await using (var db = env.AdminDb())
        {
            var live = (await db.ShiftCompletions.ToListAsync()).Where(c => LiveSetCatalog.Stories.Any(s => LiveSetCatalog.ShiftId(s, Friday) == c.ShiftId || LiveSetCatalog.ShiftId(s, Friday.AddDays(-1)) == c.ShiftId)).Select(c => c.Id).ToHashSet();
            var scripted = (await db.ShiftRoutineChecks.ToListAsync()).First(t => !live.Contains(t.ShiftCompletionId));
            (completion, routine, scheduled) = (scripted.ShiftCompletionId, scripted.ParticipantRoutineId, scripted.ScheduledAt);
            // The state a person's tick first would have left: the pack's own row away, theirs (random id, same occurrence) in its place.
            db.ShiftRoutineChecks.Remove(scripted);
            db.ShiftRoutineChecks.Add(new ShiftRoutineCheck
            {
                Id = Guid.NewGuid(), TenantId = scripted.TenantId, ShiftCompletionId = completion, ParticipantRoutineId = routine, ScheduledAt = scheduled, RoutineTitle = scripted.RoutineTitle,
                CheckedByUserId = scripted.CheckedByUserId, CheckedAt = scripted.CheckedAt.AddMinutes(1),
            });
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Friday1030.AddMinutes(5));

        await using var check = env.AdminDb();
        var tick = Assert.Single(await check.ShiftRoutineChecks.Where(t => t.ShiftCompletionId == completion && t.ParticipantRoutineId == routine && t.ScheduledAt == scheduled).ToListAsync());
        Assert.NotEqual(DemoIds.For("shift-routine-check", completion, routine), tick.Id);
    }

    /// <summary>
    /// Independent review B1: a tick's id is a function of the completion and the routine, its natural key also holds the occurrence, and the two are not one to
    /// one. A coordinator who moves a routine to another time (the routines controller edits it in place) changes the occurrence every closed shift would be
    /// ticked at, so a pack that asks only "is there a tick under this key?" tries to insert a row whose id is already there, and fails on every tick after.
    /// </summary>
    [Fact]
    public async Task ARoutineTheCoordinatorMovedAfterItsTicksWereWritten_DoesNotMakeThePackWriteThemAgain()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        // Sophie's morning routine falls at 07:00, the start of a 07:00 shift: twenty such closed shifts, so the history ticks it (four in five) at 07:00.
        var zone = Zone();
        await using (var db = env.AdminDb())
        {
            for (var i = 0; i < 20; i++)
            {
                var date = Friday.AddDays(-2 - i);
                var shiftId = DemoIds.For("fixture", "moved-routine", i);
                var start = ProviderLocalTime.LocalToUtc(At(date, 7, 2), zone);
                var end = ProviderLocalTime.LocalToUtc(At(date, 13, 3), zone);
                db.Shifts.Add(new Shift
                {
                    Id = shiftId, TenantId = DemoTestEnv.DemoTenantId, ParticipantId = DemoFixture.ParticipantId("sophie"), UserId = DemoFixture.StaffId("james"), ServiceDate = date,
                    StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Completed,
                    CreatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc), UpdatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
                });
                db.ShiftCompletions.Add(new ShiftCompletion
                {
                    Id = DemoIds.For("shift-completion", shiftId), TenantId = DemoTestEnv.DemoTenantId, ShiftId = shiftId, ActualStart = start, ActualEnd = end, StartedAt = start,
                    SubmittedAt = end.AddMinutes(6), TimeZoneId = zone.Id, SubmittedByUserId = DemoFixture.StaffId("james"), NothingToNoteConfirmed = true, IsActive = true,
                    ReviewOutcome = ReviewOutcome.Approved, ReviewedByUserId = DemoFixture.StaffId("sarah"), ReviewedAt = end.AddDays(1), CreatedAt = end.AddMinutes(6), UpdatedAt = end.AddDays(1),
                });
            }
            await db.SaveChangesAsync();
        }
        await RunAsync(env, Friday1030);
        Guid routineId;
        await using (var db = env.AdminDb())
        {
            var timed = (await db.ShiftRoutineChecks.ToListAsync()).Where(t => t.ScheduledAt is { Hour: 7, Minute: 0 }).ToList();
            Assert.True(timed.Count > 5, $"only {timed.Count} timed ticks were written");
            routineId = timed[0].ParticipantRoutineId;
            var routine = await db.ParticipantRoutines.SingleAsync(r => r.Id == routineId);
            routine.StartTime = routine.StartTime!.Value.AddMinutes(15);                          // the coordinator moves 07:00 to 07:15: every window has another occurrence
            routine.EndTime = routine.EndTime?.AddMinutes(15);
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Friday1030.AddMinutes(5));                                             // must run clean: a duplicate key here fails the pack for good

        await using var check = env.AdminDb();
        var ticks = await check.ShiftRoutineChecks.Where(t => t.ParticipantRoutineId == routineId).ToListAsync();
        Assert.All(ticks.GroupBy(t => t.ShiftCompletionId), g => Assert.Single(g));                // one tick per completion and routine, as written
    }

    /// <summary>
    /// Second independent review X2: an acknowledgement's id is a function of the handover and the reader, not of the reader's shift, like the app's unique index. Two
    /// closed shifts of one participant and one worker that cannot see each other (they start together, or the earlier is not submitted by the read) pick the same
    /// handover, build two acknowledgements with the same id in one tick, and the second Add throws: the whole pack rolled back on every tick after.
    /// </summary>
    [Fact]
    public async Task TwoClosedShiftsOfOneWorkerThatReadTheSameHandover_AreOneAcknowledgement_NotAFailedPack()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        var first = ClosedShift(DemoIds.For("fixture", "dup-source"), "noah", "james", Friday.AddDays(-5), "Settled morning. Out for coffee, back by noon.");
        var second = ClosedShift(ShiftIdWhoseHandoverIs(true, "dup-b"), "noah", "brendan", Friday.AddDays(-4), "Quiet day.");
        var alongside = ClosedShift(ShiftIdWhoseHandoverIs(true, "dup-c"), "noah", "brendan", Friday.AddDays(-4), "Quiet day, too.");            // the same day and hours: neither is before the other
        await using (var db = env.AdminDb())
        {
            foreach (var (shift, completion) in new[] { first, second, alongside })
            {
                db.Shifts.Add(shift);
                db.ShiftCompletions.Add(completion);
            }
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Friday1030);                                                          // must run clean: the same id twice in one tick fails the pack for good

        await using var check = env.AdminDb();
        var reads = await check.HandoverAcknowledgements.Where(a => a.SourceCompletionId == first.Completion.Id && a.UserId == DemoFixture.StaffId("brendan")).ToListAsync();
        Assert.Single(reads);
    }

    [Fact]
    public async Task AWorkerWhoGivesTheirOwnHandoverToThemselvesAWeekLater_ReadsNothing()
    {
        // The pattern roster gives a participant the same worker every week: nobody "acknowledges" a handover they wrote.
        var env = await TickAsync(Friday1030);
        await using var db = env.AdminDb();
        var closed = await ClosedAsync(env);
        var acks = await db.HandoverAcknowledgements.ToListAsync();

        foreach (var ack in acks.Where(a => closed.Any(c => c.Shift.Id == a.ShiftId)))
        {
            var source = closed.Single(c => c.Completion.Id == ack.SourceCompletionId);
            Assert.NotEqual(source.Completion.SubmittedByUserId, ack.UserId);
        }
    }

    // ── what it leaves alone ──

    [Fact]
    public async Task TheFixturesAgedShift_AndTheLiveShifts_GetNoHistoryRows()
    {
        var env = await TickAsync(Friday1030);
        await using var db = env.AdminDb();

        var oldCompletion = DemoFixture.OldCompletionId;
        Assert.Empty(await db.ShiftBreaks.Where(b => b.ShiftCompletionId == oldCompletion).ToListAsync());
        Assert.Empty(await db.ShiftRoutineChecks.Where(t => t.ShiftCompletionId == oldCompletion).ToListAsync());
        Assert.Single(await db.ShiftNotes.Where(n => n.ShiftId == DemoFixture.OldShiftId).ToListAsync());     // the old seed's own
        Assert.True((await db.ShiftCompletions.SingleAsync(c => c.Id == oldCompletion)).NothingToNoteConfirmed == false);   // and what it said is unchanged
        foreach (var story in LiveSetCatalog.Stories)
        {
            var day = await RequireDayAsync(env, story, Friday.AddDays(-1));
            Assert.DoesNotContain(await db.ShiftBreaks.Where(b => b.ShiftCompletionId == day.Completion!.Id).ToListAsync(), b => b.Id == DemoIds.For("shift-break", day.Completion!.Id, "history"));
        }
    }

    [Fact]
    public async Task WithoutTheOldSeedsNotes_NoNoteIsWritten_ButTheBreaksStillAre()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env, oldSeed: false);
        await env.SetProviderStateAsync("NSW");

        var result = await RunAsync(env, Friday1030);

        await using var db = env.AdminDb();
        Assert.Empty(await db.ShiftNotes.ToListAsync());
        Assert.Contains(result.SkippedStories, s => s.Contains("shift package history notes", StringComparison.Ordinal));
        Assert.NotEmpty(await db.ShiftBreaks.ToListAsync());
        Assert.True((await db.ShiftCompletions.Where(c => c.IsActive).ToListAsync()).All(c => c.NothingToNoteConfirmed || c.SubmittedAt is null));
    }

    [Fact]
    public async Task ASecondTick_AtTheSameClock_WritesNothingMore()
    {
        var env = await TickAsync(Friday1030);

        var again = await RunAsync(env, Friday1030);

        Assert.DoesNotContain(again.RowsAdded.Keys, k => k.StartsWith("shift-package-history/", StringComparison.Ordinal));
        Assert.DoesNotContain(again.RowsChanged.Keys, k => k.StartsWith("shift-package-history/", StringComparison.Ordinal));
    }

    [Fact]
    public async Task TheSameRows_WhateverTheTicksWere_EveryFifteenMinutesForADayOrOneCatchUp()
    {
        var incremental = new DemoTestEnv(new DateTimeOffset(2026, 10, 1, 20, 0, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(incremental);
        await incremental.SetProviderStateAsync("NSW");
        for (var utc = new DateTimeOffset(2026, 10, 1, 20, 0, 0, TimeSpan.Zero); utc <= new DateTimeOffset(2026, 10, 2, 12, 55, 0, TimeSpan.Zero); utc = utc.AddMinutes(60))
            await RunAsync(incremental, utc);
        var oneGo = await TickAsync(new DateTimeOffset(2026, 10, 2, 12, 55, 0, TimeSpan.Zero));

        static List<string> Rows(DemoTestEnv env)
        {
            using var db = env.AdminDb();
            var snapshot = DemoSnapshot.Take(db);
            var types = new[] { nameof(ShiftBreak), nameof(ShiftNote), nameof(ShiftRoutineCheck), nameof(HandoverAcknowledgement) };
            return snapshot.Keys.Where(k => types.Contains(DemoSnapshot.TypeOf(k))).OrderBy(k => k, StringComparer.Ordinal)
                .Select(k => k + "=" + string.Join(";", snapshot.Row(k)!.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => kv.Key + ":" + kv.Value))).ToList();
        }
        var expected = Rows(oneGo);
        Assert.True(expected.Count >= 30, $"only {expected.Count} rows");
        Assert.Equal(expected, Rows(incremental));
    }

    [Fact]
    public async Task ACompletionTheRosterPackClosesLater_IsDecoratedWhenItCloses()
    {
        var env = await TickAsync(Friday1030);
        var before = await ClosedAsync(env);

        await RunAsync(env, Monday);                                                    // a weekend later: more shifts have closed
        var after = await ClosedAsync(env);

        Assert.True(after.Count > before.Count, "more shifts closed over the weekend");
        var added = after.Where(a => before.All(b => b.Completion.Id != a.Completion.Id)).ToList();
        Assert.All(added, c => Assert.Equal(c.Notes.Count == 0, c.Completion.NothingToNoteConfirmed));
        Assert.True(added.Any(c => c.Notes.Count > 0 || c.Breaks.Count > 0), "the newly closed shifts have a note or a break");
    }
}
