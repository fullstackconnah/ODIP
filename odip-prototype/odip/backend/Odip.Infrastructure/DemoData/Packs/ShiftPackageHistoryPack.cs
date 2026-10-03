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
///    coordinator's follow-up task closed with it. A completion that has a note says so: it no longer says "nothing to note";
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
        AcknowledgementsOf(run, closed, staff, acks);

        // Only what is not there yet. A person's own acknowledgement or tick has a random id, but the app allows one acknowledgement per reader and handover and one
        // tick per completion, routine and occurrence, so those two are looked up by that key (which finds the pack's own row too): a second row for the key is
        // refused by the database and rolls the pack back for good (PR 2 review H1).
        var have = new HashSet<Guid>();
        have.UnionWith(await run.ExistingIdsAsync<ShiftBreak>(breaks.Select(b => b.Row.Id), ct));
        have.UnionWith(await run.ExistingIdsAsync<ShiftNote>(notes.Select(n => n.Row.Id), ct));
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
        foreach (var (row, worker) in ticks.Where(t => !tickKeys.Contains((t.Row.ShiftCompletionId, t.Row.ParticipantRoutineId, t.Row.ScheduledAt))))
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
            if (flagged) note.FlagsAcknowledgedAt = run.Anchors.LocalToUtc(DateOnly.FromDateTime(Local(run, at)).AddDays(1), new TimeOnly(9, 15));
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
        var (startLocal, endLocal) = ProviderLocalTime.RosteredWindowLocal(shift);
        foreach (var occurrence in RoutineWindowMatcher.Match(routines, startLocal, endLocal))
        {
            var key = DemoIds.For("history-tick", completion.Id, occurrence.Routine.Id);
            if (DemoIds.Pick(key, "tick", 0, 99) >= 80) continue;                             // one in five is left for the viewer to notice

            var at = (occurrence.OccursAtLocal ?? startLocal).AddMinutes(5 + DemoIds.Pick(key, "after", 0, 30));
            if (at >= endLocal) at = endLocal.AddMinutes(-5);
            ticks.Add((PackageRows.Tick(run, completion, occurrence.Routine, occurrence.OccursAtLocal, worker, at), worker));
        }
    }

    // ── the handover read ──

    private static void AcknowledgementsOf(DemoRun run, List<DemoQueries.ClosedPair> closed, IReadOnlyDictionary<string, User> staff, List<(HandoverAcknowledgement, User)> acks)
    {
        foreach (var byParticipant in closed.GroupBy(p => p.Shift.ParticipantId))
        {
            var ordered = byParticipant.OrderBy(p => p.Shift.ServiceDate).ThenBy(p => p.Shift.StartTime).ToList();
            for (var i = 1; i < ordered.Count; i++)
            {
                var (source, reader) = (ordered[i - 1], ordered[i]);
                if (string.IsNullOrWhiteSpace(source.Completion.HandoverText) || source.Completion.NothingToHandOver) continue;
                var readerUser = staff.Values.FirstOrDefault(u => u.Id == reader.Shift.UserId);
                if (readerUser is null || reader.Shift.UserId == source.Shift.UserId) continue;          // the baton passes to somebody else
                if (DemoIds.Pick(reader.Completion.Id, "unread", 0, 99) < UnreadPercent) continue;

                var at = ProviderLocalTime.AsUtc(reader.Completion.ActualStart).AddMinutes(8 + DemoIds.Pick(reader.Completion.Id, "ack-after", 0, 32));
                if (at <= ProviderLocalTime.AsUtc(source.Completion.SubmittedAt!.Value)) continue;      // the shifts overlap: nothing to read yet
                acks.Add((PackageRows.Acknowledgement(run, source.Completion, reader.Shift, readerUser, Local(run, at)), readerUser));
            }
        }
    }
}
