using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// The rest of the shift package for the shifts the roster pack closed (plan 3a, 1b rows 21 to 23 and 27), so a completion in the review queue is
/// more than a pair of times: for each of the last four weeks' submitted completions that this top-up made (never an old-seed or an owner's, and
/// never the live set's, which tells its own story):
///  - a break of 15 to 45 minutes for a shift of five hours or more, placed by adding minutes to the start (elapsed time, so a clock change cannot move it);
///  - one shift note on a little over half of them, a second on the long ones, from a few wordings that the keyword scanner reads as nothing, and on
///    about one in twenty-five one that it flags (Falls, Medication, Injury, BehaviourOfConcern), which the author acknowledged the next morning, the
///    coordinator's follow-up task closed with it: the note and its task are written once that morning has come, not before. A completion that has a
///    note says so: it no longer says "nothing to note";
///  - the routines that fall inside the shift, matched by the portal's own rule (<see cref="RoutineWindowMatcher"/>), ticked at about four in five;
///  - the handover read: the next worker for that participant marking the previous one's handover read from their own shift, all but about one
///    in eight, which stay unread.
/// Every row is a function of its completion, so it is found again whatever its values have become and a gap is caught up with the same rows.
///
/// Plan 4.5: the old seed guards the shift-notes table with Any(), so no note is written unless one of its own six is there. The only change to an
/// existing row is that confirmed "nothing to note" on a completion that now has a note (compare-and-set, the guard lists it).
/// </summary>
public sealed class ShiftPackageHistoryPack : IDemoPack
{
    public string Name => "shift-package-history";

    private const int LookbackDays = 28;
    private const int UnreadPercent = 12;

    /// <summary>How far before the window a reader's handover is looked for (the participant's latest shift before the reader's is nearly always within a day or two).</summary>
    private const int HandoverLookbackDays = 7;

    /// <summary>A row is written when its time is this many minutes in the past (plan 5.2: "at least 2 minutes past").</summary>
    private const int GraceMinutes = 2;

    /// <summary>Wordings the keyword scanner reads as nothing; {n} is the participant's first name.</summary>
    public static readonly string[] CalmNotes =
    {
        "{n} had a calm shift and chose the activities. Out for a short walk and a coffee, in good spirits throughout.",
        "Helped {n} with the shopping list and the shopping. {n} paid at the counter and was proud of managing it.",
        "Quiet afternoon. {n} worked on a jigsaw and listened to music, then helped prepare dinner.",
        "A phone call with family went well and {n} was cheerful afterwards. Lunch eaten with a good appetite.",
        "{n} wanted to stay in today, so we cooked together and watched a favourite show. Drank plenty of water.",
        "Went to the park and fed the ducks. {n} chatted to a neighbour on the way home.",
        "{n} did some art for most of the shift and wants to put it up on the wall.",
        "Settled day. {n} did the washing and folded it, then tidied the bedroom with a little prompting.",
        "Visited the library and chose two books. Good conversation on the bus there and back.",
        "{n} was tired this morning, so we kept things gentle: a long breakfast, a stretch, and a late start to the walk.",
        "Went swimming at the community pool. {n} enjoyed it and was relaxed for the rest of the afternoon.",
        "Dinner choices made by {n}. Helped with the vegetables and set the table without being asked.",
    };

    /// <summary>Wordings it flags, one for each category (Falls with Injury, Medication, Injury, BehaviourOfConcern).</summary>
    public static readonly string[] FlaggedNotes =
    {
        "{n} lost footing on the kerb outside the shop and fell onto one knee. Checked over with no injury, and carried on with the outing.",
        "The delivery of {n}'s dosette box was late, so the morning tablets were given from the spare pack once the pharmacy had confirmed it.",
        "Small bruise on {n}'s left forearm noticed while helping with dressing. {n} could not say how it happened. Photo taken and the coordinator told.",
        "{n} became distressed in the car park when the bus was cancelled, and needed some quiet time in the van before carrying on.",
    };

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var anchors = run.Anchors;
        var staff = await run.FreshStaffAsync(ct);
        var closed = (await DemoQueries.ClosedCompletions(run.Db, anchors.D0.AddDays(-LookbackDays)).ToListAsync(ct))
            .Where(p => p.Completion.Id == DemoIds.For("shift-completion", p.Shift.Id) && !IsLive(p.Shift))
            .ToList();
        if (closed.Count == 0) return;

        var participants = run.Directory.AllParticipants.Where(p => p.Key.Length > 0).ToDictionary(p => p.Id);
        closed = closed.Where(p => participants.ContainsKey(p.Shift.ParticipantId)).ToList();
        var sources = await DemoQueries.HandoverSourcesOf(run.Db, participants.Keys.ToList(), anchors.D0.AddDays(-LookbackDays - HandoverLookbackDays)).ToListAsync(ct);

        // The live shifts the live set has yet to finish (it works only between 06:00 and 23:00): a reader who would read one of them waits, so the read does not depend on
        // whether the live set had caught up when the history looked (second independent review X3).
        var workers = staff.Values.Select(u => u.Id).ToHashSet();
        var liveParticipants = LiveSetCatalog.Stories.Select(s => run.Directory.Participant(s.Participant)?.Id).OfType<Guid>().Distinct().ToList();
        var unfinishedLive = (await DemoQueries.UnfinishedStartsOf(run.Db, liveParticipants).ToListAsync(ct))
            .Where(u => u.UserId is { } worker && workers.Contains(worker) && LiveSetCatalog.Stories.Any(story => LiveSetCatalog.ShiftId(story, u.ServiceDate) == u.Id)).ToList();
        var routines = await DemoQueries.ActiveRoutinesOf(run.Db, participants.Keys.ToList()).ToListAsync(ct);
        var notesAllowed = await OldSeedChecks.ShiftNotesThereAsync(run, "shift package history notes", ct);

        var breaks = new List<(ShiftBreak Row, User Worker)>();
        var notes = new List<(ShiftNote Row, User Worker, ShiftCompletion Completion)>();
        var ticks = new List<(ShiftRoutineCheck Row, User Worker)>();
        var acks = new List<(HandoverAcknowledgement Row, User Worker)>();

        foreach (var pair in closed.OrderBy(p => p.Shift.ServiceDate).ThenBy(p => p.Shift.StartTime))
        {
            var (completion, shift) = (pair.Completion, pair.Shift);
            var worker = staff.Values.FirstOrDefault(u => u.Id == shift.UserId);
            if (worker is null) continue;                                                    // not one of the people the stories name

            BreakOf(run, completion, shift, worker, breaks);
            if (notesAllowed) NotesOf(run, completion, shift, worker, participants[shift.ParticipantId], notes);
            TicksOf(run, completion, shift, worker, routines.Where(r => r.ParticipantId == shift.ParticipantId).ToList(), ticks);
        }
        AcknowledgementsOf(run, closed, sources, unfinishedLive, staff, acks);

        // Only what is not there yet. A person's own acknowledgement or tick has a random id, but the app allows one acknowledgement per reader and handover and one
        // tick per completion, routine and occurrence, so those two are looked up by that key (which finds the pack's own row too): a second row for the key is
        // refused by the database and rolls the pack back for good (PR 2 review H1). A tick is looked up by its id as well: the id is a function of the completion
        // and the routine alone, so a routine the coordinator moves to another time changes the occurrence (the key) of a tick that is already there, and asking
        // only by key would insert its id a second time (independent review B1). An acknowledgement's id IS its key.
        var have = new HashSet<Guid>();
        have.UnionWith(await run.ExistingIdsAsync<ShiftBreak>(breaks.Select(b => b.Row.Id), ct));
        have.UnionWith(await run.ExistingIdsAsync<ShiftNote>(notes.Select(n => n.Row.Id), ct));
        have.UnionWith(await run.ExistingIdsAsync<ShiftRoutineCheck>(ticks.Select(t => t.Row.Id), ct));
        var ackReaders = acks.Select(a => a.Row.UserId).Distinct().ToList();
        var ackKeys = (await run.ChunkedAsync(acks.Select(a => a.Row.SourceCompletionId), sources => DemoQueries.HandoverAcksOf(run.Db, sources, ackReaders), ct))
            .Select(k => (k.SourceCompletionId, k.UserId)).ToHashSet();
        var tickKeys = (await run.ChunkedAsync(ticks.Select(t => t.Row.ShiftCompletionId), completions => DemoQueries.RoutineTicksOf(run.Db, completions), ct))
            .Select(k => (k.CompletionId, k.RoutineId, k.ScheduledAt)).ToHashSet();

        var added = 0;
        foreach (var (row, worker) in breaks.Where(b => !have.Contains(b.Row.Id)))
        {
            run.Db.ShiftBreaks.Add(row);
            run.StampAudit(row.Id, row.CreatedAt, worker);
            added++;
        }
        foreach (var (row, worker) in ticks.Where(t => !have.Contains(t.Row.Id) && !tickKeys.Contains((t.Row.ShiftCompletionId, t.Row.ParticipantRoutineId, t.Row.ScheduledAt))))
        {
            run.Db.ShiftRoutineChecks.Add(row);
            run.StampAudit(row.Id, row.CheckedAt, worker);
            added++;
        }
        foreach (var (row, worker) in acks.Where(a => !ackKeys.Contains((a.Row.SourceCompletionId, a.Row.UserId))))
        {
            run.Db.HandoverAcknowledgements.Add(row);
            run.StampAudit(row.Id, row.AcknowledgedAt, worker);
            added++;
        }

        var newNotes = notes.Where(n => !have.Contains(n.Row.Id)).ToList();
        if (newNotes.Count > 0)
        {
            var tracked = (await DemoQueries.ActiveCompletionsOf(run.Db, newNotes.Select(n => n.Completion.ShiftId).Distinct().ToList()).ToListAsync(ct))
                .ToDictionary(c => c.ShiftId);
            foreach (var (row, worker, completion) in newNotes)
            {
                run.Db.ShiftNotes.Add(row);
                run.StampAudit(row.Id, row.CreatedAt, worker);
                if (row.FlaggedCategories != ShiftNoteFlagCategory.None) AddFollowUp(run, row, worker, completion);
                added++;

                // A completion with a note no longer says "nothing to note" (compare-and-set: only the confirmation this top-up wrote).
                if (tracked.TryGetValue(completion.ShiftId, out var live) && live.NothingToNoteConfirmed)
                {
                    live.NothingToNoteConfirmed = false;
                    run.StampAudit(live.Id, row.CreatedAt, worker);
                }
            }
        }

        if (added == 0 && !run.Db.ChangeTracker.HasChanges()) return;
        await run.SaveAsync(ct);
        run.Added("shift package history rows", added);
    }

    /// <summary>The live set's own shifts (any date): they tell their own story, with their own breaks, notes, ticks and acknowledgements.</summary>
    private static bool IsLive(Shift shift) => LiveSetCatalog.Stories.Any(story => LiveSetCatalog.ShiftId(story, shift.ServiceDate) == shift.Id);

    private static DateTime Local(DemoRun run, DateTime utc) => ProviderLocalTime.UtcToLocal(ProviderLocalTime.AsUtc(utc), run.Anchors.Zone);

    // ── a break for a long shift ──

    private static void BreakOf(DemoRun run, ShiftCompletion completion, Shift shift, User worker, List<(ShiftBreak, User)> breaks)
    {
        if (completion.StartWasManual) return;                                                  // the shift was never in progress: the portal takes a break only from one (second independent review X5)
        var (startLocal, endLocal) = ProviderLocalTime.RosteredWindowLocal(shift);
        if ((endLocal - startLocal).TotalHours < 5) return;

        var start = ProviderLocalTime.AsUtc(completion.ActualStart).AddMinutes(150 + DemoIds.Pick(completion.Id, "break-start", 0, 75));
        var end = start.AddMinutes(DemoIds.Pick(completion.Id, "break-length", 15, 45));
        if (end >= ProviderLocalTime.AsUtc(completion.ActualEnd!.Value)) return;
        breaks.Add((PackageRows.BreakBetween(run, completion, worker, start, end), worker));
    }

    // ── notes ──

    private static void NotesOf(DemoRun run, ShiftCompletion completion, Shift shift, User worker, DemoParticipant participant,
        List<(ShiftNote, User, ShiftCompletion)> notes)
    {
        var first = participant.FullName.Split(' ')[0];
        var start = ProviderLocalTime.AsUtc(completion.ActualStart);
        var end = ProviderLocalTime.AsUtc(completion.ActualEnd!.Value);
        var hours = (end - start).TotalHours;

        // Roughly 55 in a hundred have a note, and a long shift may have a second.
        var count = DemoIds.Pick(completion.Id, "notes", 0, 99) < 55 ? (hours >= 7 && DemoIds.Pick(completion.Id, "notes-two", 0, 99) < 40 ? 2 : 1) : 0;
        for (var i = 0; i < count; i++)
        {
            var key = DemoIds.For("history-note", completion.Id, i);
            var at = i == 0 ? start.AddMinutes(40 + DemoIds.Pick(key, "at", 0, 140)) : end.AddMinutes(-(8 + DemoIds.Pick(key, "at", 0, 30)));
            if (at <= start || at >= end) continue;

            var flagged = DemoIds.Pick(key, "flagged", 0, 99) < 4;
            var template = flagged ? FlaggedNotes[DemoIds.Pick(key, "wording", 0, FlaggedNotes.Length - 1)] : CalmNotes[DemoIds.Pick(key, "wording", 0, CalmNotes.Length - 1)];
            var note = PackageRows.Note(run, shift, worker, Local(run, at), template.Replace("{n}", first, StringComparison.Ordinal));
            if (flagged)
            {
                // The author acknowledges the flags the next morning and the follow-up task is closed with it. The note waits for that moment (and, like every
                // other row, for two minutes past it), so no row is ever dated after the tick that writes it (PR 2 review L1).
                var acknowledgedAt = run.Anchors.LocalToUtc(DateOnly.FromDateTime(Local(run, at)).AddDays(1), new TimeOnly(9, 15));
                if (acknowledgedAt.AddMinutes(GraceMinutes) > run.Anchors.NowUtc) continue;
                note.FlagsAcknowledgedAt = acknowledgedAt;
            }
            notes.Add((note, worker, completion));
        }
    }

    /// <summary>The coordinator's follow-up the app raises for a flagged note, closed because the author acknowledged the flags (as the portal closes it).</summary>
    private static void AddFollowUp(DemoRun run, ShiftNote note, User worker, ShiftCompletion completion)
    {
        var task = PackageRows.FlaggedNoteTask(run, note, DateOnly.FromDateTime(Local(run, note.CreatedAt)), ProviderLocalTime.AsUtc(note.FlagsAcknowledgedAt!.Value));
        run.Db.BookingTasks.Add(task);
        run.StampAudit(task.Id, note.CreatedAt, worker);
    }

    // ── routine ticks ──

    private static void TicksOf(DemoRun run, ShiftCompletion completion, Shift shift, User worker, List<ParticipantRoutine> routines, List<(ShiftRoutineCheck, User)> ticks)
    {
        if (routines.Count == 0) return;
        if (completion.StartWasManual) return;                                                  // a start typed in at the Finish: the shift was never in progress, so nothing could be ticked (second independent review X5)
        var (startLocal, endLocal) = ProviderLocalTime.RosteredWindowLocal(shift);
        foreach (var occurrence in RoutineWindowMatcher.Match(routines, startLocal, endLocal))
        {
            var key = DemoIds.For("history-tick", completion.Id, occurrence.Routine.Id);
            if (DemoIds.Pick(key, "tick", 0, 99) >= 80) continue;                             // one in five is left for the viewer to notice

            var at = (occurrence.OccursAtLocal ?? startLocal).AddMinutes(5 + DemoIds.Pick(key, "after", 0, 30));

            // The portal takes a tick only while the shift is in progress, so never before the worker started, and not in the same minute (PR 2 review L4: a routine
            // due at the rostered start, ticked for a worker who started six to twelve minutes late, came before the start), and never after the Finish (independent
            // review N8: a worker can finish eight minutes before the rostered end, and a tick clamped to five minutes before it came after).
            var firstPossible = Local(run, ProviderLocalTime.AsUtc(completion.ActualStart)).AddMinutes(1);
            var lastPossible = Local(run, ProviderLocalTime.AsUtc(completion.ActualEnd!.Value)).AddMinutes(-1);
            if (at < firstPossible) at = firstPossible;
            if (at >= endLocal) at = endLocal.AddMinutes(-5);
            if (at > lastPossible) at = lastPossible;
            if (at < firstPossible) continue;
            ticks.Add((PackageRows.Tick(run, completion, occurrence.Routine, occurrence.OccursAtLocal, worker, at), worker));
        }
    }

    // ── the handover read ──

    /// <summary>
    /// The reader of each closed shift marks as read the handover the portal would have shown them (PR 2 review L3: the app's own rule across every shift of the
    /// participant, the live set's and the old seed's included, among those submitted by the time of the read), all but about one in eight, and never their own.
    /// </summary>
    private static void AcknowledgementsOf(DemoRun run, List<DemoQueries.ClosedPair> closed, List<HandoverSource> sources, List<DemoQueries.UnfinishedStart> unfinishedLive,
        IReadOnlyDictionary<string, User> staff, List<(HandoverAcknowledgement, User)> acks)
    {
        var written = new HashSet<Guid>();                                                                  // an acknowledgement's id is its handover and reader, whatever the reader's shift
        foreach (var reader in closed.OrderBy(p => p.Shift.ServiceDate).ThenBy(p => p.Shift.StartTime))
        {
            var readerUser = staff.Values.FirstOrDefault(u => u.Id == reader.Shift.UserId);
            if (readerUser is null) continue;
            if (DemoIds.Pick(reader.Completion.Id, "unread", 0, 99) < UnreadPercent) continue;
            if (unfinishedLive.Any(u => u.ParticipantId == reader.Shift.ParticipantId
                                        && (u.ServiceDate < reader.Shift.ServiceDate || (u.ServiceDate == reader.Shift.ServiceDate && u.StartTime < reader.Shift.StartTime)))) continue;     // waits for the live shift before it

            var at = ProviderLocalTime.AsUtc(reader.Completion.ActualStart).AddMinutes(8 + DemoIds.Pick(reader.Completion.Id, "ack-after", 0, 32));
            var source = HandoverSourceRule.LatestBefore(sources.Where(s => ProviderLocalTime.AsUtc(s.SubmittedAt) < at), reader.Shift.ParticipantId, reader.Shift.Id, reader.Shift.ServiceDate, reader.Shift.StartTime);
            if (source is not { HasHandover: true }) continue;                                              // nothing to read (and an older handover is never resurrected)
            if (reader.Shift.UserId == source.ShiftUserId) continue;                                        // the baton passes to somebody else
            var row = PackageRows.Acknowledgement(run, source.CompletionId, reader.Shift, readerUser, Local(run, at));
            if (written.Add(row.Id)) acks.Add((row, readerUser));                                           // two shifts of one worker that pick one handover read it once, at the earlier shift (second independent review X2)
        }
    }
}
