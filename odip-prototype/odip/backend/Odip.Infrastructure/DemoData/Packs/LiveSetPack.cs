using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Medications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Tasks;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// "Today, on shift" (plan 2.1, 5.2): three shifts a day that follow the provider's clock, so whenever the demo is opened there is a worker who
/// has started, a dose that is due or overdue, a break that is running and a handover nobody has read. Each tick, for today and yesterday:
///  1. the day's three shifts exist (cast by <see cref="LiveCaster"/>; keyed by story and date, so made once);
///  2. each shift is moved through its day by the clock: Published, then InProgress when the worker starts (rostered start plus the story's own
///     variance), then PendingReview a few minutes after the rostered end, with the doses, ticks, breaks, notes and handover acknowledgements the
///     story scripts at their local times. An event is written once its time is at least two minutes past, and only while the tick is between 06:00
///     and 23:00 on the provider's clock; a tick that was missed writes the events it owes, with their scripted times;
///  3. Published, InProgress and PendingReview are the only states this pack moves a shift between. It never touches a shift somebody else changed.
///
/// What it deliberately leaves open while the shift is on: the dose that is due or overdue, the running break, and the unfinished shift. At the end
/// it does what the worker's Finish would have been made to do: a dose with no outcome is written down as not given, a running break is ended, and
/// the handover is written; and PendingReview becomes Completed, approved by Sarah, after three provider days (the same rule as the roster's shifts).
///
/// Time (plan 2.0): scripted times are provider-local wall-clock values, typed; every instant goes through the one conversion
/// (<see cref="DemoAnchors.LocalToUtc(DateTime)"/>), so the story reads the same in Sydney, Brisbane and Adelaide and across both clock changes.
/// </summary>
public sealed class LiveSetPack : IDemoPack
{
    public string Name => "live-set";

    /// <summary>An event is written when its time is this many minutes in the past (plan 5.2: "at least 2 minutes past").</summary>
    private const int GraceMinutes = 2;

    /// <summary>How far back a reader's handover is looked for: the participant's latest shift before this one is nearly always within a day or two.</summary>
    private const int HandoverLookbackDays = 7;

    private static readonly TimeOnly LiveFrom = new(6, 0);
    private static readonly TimeOnly LiveUntil = new(23, 0);

    // The routine the old seed gives Sophie for the morning (DbSeeder.cs, routine 74..02).
    private static readonly Guid MorningRoutine = Guid.Parse("74000000-0000-0000-0000-000000000002");

    private sealed class Live
    {
        public required LiveStory Story { get; init; }
        public required DateOnly Date { get; init; }
        public required Shift Shift { get; init; }
        public required User Worker { get; init; }
        public ShiftCompletion? Completion { get; set; }
        public bool IsNew { get; init; }

        /// <summary>The handover the worker reads, chosen by the app's own rule once the read is due (null: nothing to read, or not due yet).</summary>
        public HandoverSource? Handover { get; set; }
    }

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var anchors = run.Anchors;
        var dates = new[] { anchors.D0.AddDays(-1), anchors.D0 };

        // Outside the live hours (06:00 to 23:00 on the provider's clock) nothing new is rostered or scripted: a shift made at three in the
        // morning could not be started, and the first tick after six builds the day, yesterday's too, in one go. Approval is by date, so it is not held back.
        if (InLiveHours(anchors))
        {
            var lives = await EnsureShiftsAsync(run, dates, ct);
            await ScriptAsync(run, lives, ct);
        }
        await ApproveOldAsync(run, ct);
        await WitnessAnswers.RunAsync(run, ct);

        if (run.Db.ChangeTracker.HasChanges()) await run.SaveAsync(ct);
    }

    private static List<Guid> LiveParticipantIds(DemoRun run) =>
        LiveSetCatalog.Stories.Select(s => run.Directory.Participant(s.Participant)?.Id).OfType<Guid>().Distinct().ToList();

    internal static bool InLiveHours(DemoAnchors anchors)
    {
        var time = TimeOnly.FromDateTime(anchors.NowLocal);
        return time >= LiveFrom && time < LiveUntil;
    }

    // ── 1. the shifts ────────────────────────────────────────────────────────

    private static async Task<List<Live>> EnsureShiftsAsync(DemoRun run, DateOnly[] dates, CancellationToken ct)
    {
        var anchors = run.Anchors;
        var ids = LiveSetCatalog.ShiftIds(dates).ToList();
        var existing = await run.ExistingIdsAsync<Shift>(ids, ct);

        var staff = await run.FreshStaffAsync(ct);
        var lives = new List<Live>();

        // Live shifts of earlier days that were never finished (a host that was off for a while): they are caught up the same way, so a gap leaves
        // nothing Published or InProgress after it ended.
        var stale = (await DemoQueries.UnfinishedShifts(run.Db, dates[0], LiveParticipantIds(run)).ToListAsync(ct))
            .Where(s => LiveSetCatalog.Stories.Any(story => LiveSetCatalog.ShiftId(story, s.ServiceDate) == s.Id)).ToList();

        if (existing.Count > 0 || stale.Count > 0)
        {
            var shifts = (await DemoQueries.ShiftsByIds(run.Db, existing.ToList()).ToListAsync(ct)).Concat(stale);
            foreach (var shift in shifts)
            {
                var (story, date) = Identify(shift.Id, dates.Concat(stale.Select(s => s.ServiceDate)).Distinct().ToArray());
                var worker = shift.UserId is { } id ? staff.Values.FirstOrDefault(u => u.Id == id) : null;
                if (story is null || worker is null) continue;
                lives.Add(new Live { Story = story, Date = date, Shift = shift, Worker = worker });
            }
        }

        var missing = dates.SelectMany(d => LiveSetCatalog.Stories.Select(s => (Story: s, Date: d)))
            .Where(x => !existing.Contains(LiveSetCatalog.ShiftId(x.Story, x.Date))).ToList();
        if (missing.Count == 0) return lives;

        var caster = new LiveCaster(run);
        foreach (var (story, date) in missing)
        {
            var shift = await caster.CastAsync(story, date, ct);
            if (shift is null) continue;

            // Rostered a few days before, like any shift that was planned ahead.
            shift.CreatedAt = anchors.LocalToUtc(date.AddDays(-3), new TimeOnly(9, 0));
            shift.UpdatedAt = shift.CreatedAt;
            run.Db.Shifts.Add(shift);
            lives.Add(new Live { Story = story, Date = date, Shift = shift, Worker = staff.Values.First(u => u.Id == shift.UserId), IsNew = true });
            run.Added("live shifts");
        }

        // Saved as Published before anything is done to them, so each move that follows is its own audit entry (Created, then Updated by the worker).
        await run.SaveAsync(ct);
        return lives;

        static (LiveStory? Story, DateOnly Date) Identify(Guid id, DateOnly[] dates)
        {
            foreach (var date in dates)
                foreach (var story in LiveSetCatalog.Stories)
                    if (LiveSetCatalog.ShiftId(story, date) == id) return (story, date);
            return (null, default);
        }
    }

    // ── 2. the day's script ──────────────────────────────────────────────────

    private async Task ScriptAsync(DemoRun run, List<Live> lives, CancellationToken ct)
    {
        // A finished shift has had every step: closing out is the last thing the script does, and a pack run is all or nothing.
        var open = lives.Where(l => l.Shift.Status is ShiftStatus.Published or ShiftStatus.InProgress).ToList();
        if (open.Count == 0) return;

        // Every saved completion of the two days (a finished shift's too: the next day's worker acknowledges its handover).
        var existingCompletions = await DemoQueries.ActiveCompletionsOf(run.Db, lives.Where(l => !l.IsNew).Select(l => l.Shift.Id).ToList()).ToListAsync(ct);
        foreach (var live in lives) live.Completion = existingCompletions.FirstOrDefault(c => c.ShiftId == live.Shift.Id);

        var participantIds = open.Select(l => l.Shift.ParticipantId).Distinct().ToList();
        var meds = await DemoQueries.ActiveMedicationsOf(run.Db, participantIds).ToListAsync(ct);
        var routines = await DemoQueries.RoutinesByIds(run.Db, new List<Guid> { MorningRoutine }).ToListAsync(ct);

        var script = new Script(run, await run.FreshStaffAsync(ct), meds, routines, lives);
        foreach (var live in open.OrderBy(l => l.Date).ThenBy(l => l.Shift.StartTime))
        {
            // One live shift, whole or not at all: a person's own row the script did not foresee, a race with somebody editing the same shift, a bug in one
            // day's story. It is undone and reported, and the other shifts are worked as if it had not been there (PR 2 review H1).
            if (await run.TryUnitAsync($"{live.Story.Key} {live.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}", () => script.RunAsync(live, ct), ct)) continue;

            // What the shift has in the database now: a completion the undone piece had made is gone, one it only changed is as it was.
            live.Completion = (await DemoQueries.ActiveCompletionsOf(run.Db, new List<Guid> { live.Shift.Id }).ToListAsync(ct)).FirstOrDefault();
        }
    }

    // ── 3. approval ──────────────────────────────────────────────────────────

    private static async Task ApproveOldAsync(DemoRun run, CancellationToken ct)
    {
        var reviewer = run.Directory.Staff("sarah");
        if (reviewer is null) return;

        var anchors = run.Anchors;
        var cutoff = anchors.D0.AddDays(-ShiftLifecycle.ApproveAfterDays);
        var waiting = await DemoQueries.UnreviewedShifts(run.Db, cutoff, LiveParticipantIds(run)).ToListAsync(ct);
        var live = waiting.Where(s => LiveSetCatalog.Stories.Any(story => LiveSetCatalog.ShiftId(story, s.ServiceDate) == s.Id)).ToList();
        if (live.Count == 0) return;

        var completions = await DemoQueries.ActiveCompletionsOf(run.Db, live.Select(s => s.Id).ToList()).ToListAsync(ct);
        var approved = 0;
        foreach (var shift in live)
        {
            var completion = completions.FirstOrDefault(c => c.ShiftId == shift.Id && c.ReviewOutcome is null && c.ReviewedByUserId is null && c.SubmittedAt != null);
            if (completion is null) continue;

            ShiftLifecycle.Approve(run, shift, completion, reviewer.Id);
            shift.Status = ShiftStatus.Completed;
            shift.UpdatedAt = completion.ReviewedAt ?? anchors.NowUtc;
            run.StampAudit(completion.Id, completion.ReviewedAt!.Value, "sarah");
            run.StampAudit(shift.Id, shift.UpdatedAt, "sarah");
            approved++;
        }
        if (approved > 0) run.Changed("live shifts approved", approved);
    }

    // ── the per-shift story ──────────────────────────────────────────────────

    private sealed class Script
    {
        private readonly DemoRun _run;
        private readonly DemoAnchors _a;
        private readonly IReadOnlyDictionary<string, User> _staff;
        private readonly List<ParticipantMedication> _meds;
        private readonly List<ParticipantRoutine> _routines;
        private readonly List<Live> _lives;

        public Script(DemoRun run, IReadOnlyDictionary<string, User> staff, List<ParticipantMedication> meds, List<ParticipantRoutine> routines,
            List<Live> lives)
        {
            _run = run;
            _a = run.Anchors;
            _staff = staff;
            _meds = meds;
            _routines = routines;
            _lives = lives;
        }

        /// <summary>When the worker reads the last handover, on the wall clock of the shift's day.</summary>
        private static DateTime AckAt(Live live) =>
            live.Story == LiveSetCatalog.Evening ? At(live, 15, 20) : live.Story == LiveSetCatalog.Insulin ? At(live, 8, 20) : At(live, 7, 12);

        /// <summary>
        /// The handover the worker reads, once the read is due: the one the portal showed AT the read, by the app's own rule across every shift of the participant
        /// (PR 2 review L3: the latest shift before this one, whatever story it belongs to, not the same story's day before, which can be an older handover than the
        /// night shift that came in between), among the completions that had been submitted by then. Choosing the latest first and asking afterwards whether it was
        /// submitted made the read depend on the ticks (independent review S1): a roster shift that ends after the read is closed at a later tick, and when the host
        /// had been down until then the read was written for nothing. Earlier live shifts were finished and saved before this one is worked, so a day built from
        /// nothing in one tick comes out the same as one built over two.
        /// </summary>
        private async Task ChooseHandoverAsync(Live live, DateTime actualStartLocal, CancellationToken ct)
        {
            live.Handover = null;
            var at = AckAt(live);
            if (at <= actualStartLocal || !Due(at)) return;                                    // a worker who has not started has read nothing, and nothing is read before its time

            var sources = await DemoQueries.HandoverSourcesOf(_run.Db, new List<Guid> { live.Shift.ParticipantId }, live.Date.AddDays(-HandoverLookbackDays)).ToListAsync(ct);
            var readAt = _a.LocalToUtc(at);
            var latest = HandoverSourceRule.LatestBefore(sources.Where(s => s.SubmittedAt < readAt), live.Shift.ParticipantId, live.Shift.Id, live.Shift.ServiceDate, live.Shift.StartTime);
            if (latest is { HasHandover: true }) live.Handover = latest;
        }

        /// <summary>True once the local time is at least <see cref="GraceMinutes"/> minutes in the past on the provider's clock.</summary>
        private bool Due(DateTime local) => _a.LocalToUtc(local).AddMinutes(GraceMinutes) <= _a.NowUtc;

        private static DateTime At(Live live, int hour, int minute) => PackageRows.Local(live.Date, new TimeOnly(hour, minute));

        public async Task RunAsync(Live live, CancellationToken ct)
        {
            var shift = live.Shift;
            var (startLocal, endLocal) = ProviderLocalTime.RosteredWindowLocal(shift);
            var variance = StartVariance(live);
            var actualStartLocal = startLocal.AddMinutes(variance);

            // Start: the worker taps Start (rostered start plus the story's variance).
            if (shift.Status == ShiftStatus.Published)
            {
                if (!Due(actualStartLocal)) return;
                if (live.Completion is null)
                {
                    live.Completion = BuildStart(live, actualStartLocal, variance);
                    _run.Db.ShiftCompletions.Add(live.Completion);
                }
                shift.Status = ShiftStatus.InProgress;
                shift.UpdatedAt = live.Completion.StartedAt;
                _run.StampAudit(live.Completion.Id, live.Completion.StartedAt, live.Worker);
                _run.StampAudit(shift.Id, shift.UpdatedAt, live.Worker);
                _run.Added("live shifts started");
                await _run.SaveAsync(ct);
            }
            if (shift.Status != ShiftStatus.InProgress || live.Completion is null) return;

            await ChooseHandoverAsync(live, actualStartLocal, ct);
            var events = Events(live, actualStartLocal).Where(e => Due(e.Local)).ToList();
            await WriteAsync(live, events, ct);
            await CloseAsync(live, endLocal, ct);
        }

        private int StartVariance(Live live) => live.Story == LiveSetCatalog.Insulin ? 12
            : live.Story == LiveSetCatalog.Morning ? -2
            : DemoIds.Pick(live.Shift.Id, "variance-start", 0, 6);

        private ShiftCompletion BuildStart(Live live, DateTime actualStartLocal, int variance)
        {
            var id = DemoIds.For("shift-completion", live.Shift.Id);
            var actualStart = _a.LocalToUtc(actualStartLocal);
            var geo = DemoIds.Pick(id, "geo", 1, 9);                       // one in nine declined location sharing; nobody started it by hand
            var completion = new ShiftCompletion
            {
                Id = id,
                TenantId = _run.TenantId,
                ShiftId = live.Shift.Id,
                ActualStart = actualStart,
                TimeZoneId = _a.Provider.Id,
                GeolocationDeclined = geo == 1,
                StartWasManual = false,
                SubmittedByUserId = live.Worker.Id,
                StartedAt = actualStart,
                VarianceMinutesStart = variance,
                IsActive = true,
                CreatedAt = actualStart,
                UpdatedAt = actualStart,
            };
            if (geo >= 2)
            {
                completion.StartLatitude = -33.8688m + DemoIds.Pick(id, "lat-start", -30, 30) / 1000m;
                completion.StartLongitude = 151.2093m + DemoIds.Pick(id, "lon-start", -30, 30) / 1000m;
            }
            return completion;
        }

        // ── the scripted events of each story, at their local times ──

        private sealed record Event(DateTime Local, Type Type, Guid Id, object Entity, User? Actor, Func<Task>? After = null);

        private IEnumerable<Event> Events(Live live, DateTime actualStartLocal)
        {
            var completion = live.Completion!;
            var worker = live.Worker;
            var story = live.Story;

            // The next worker reads the last handover (a worker who has not started has read nothing), the one chosen by ChooseHandoverAsync.
            if (live.Handover is { } source)
            {
                var at = AckAt(live);
                var ack = PackageRows.Acknowledgement(_run, source.CompletionId, live.Shift, worker, at);
                yield return new Event(at, typeof(HandoverAcknowledgement), ack.Id, ack, worker);
            }

            if (story == LiveSetCatalog.Morning)
            {
                if (_routines.FirstOrDefault(r => r.Id == MorningRoutine) is { } routine && At(live, 7, 40) > actualStartLocal)
                {
                    var tick = PackageRows.Tick(_run, completion, routine, At(live, 7, 0), worker, At(live, 7, 40));
                    yield return new Event(At(live, 7, 40), typeof(ShiftRoutineCheck), tick.Id, tick, worker);
                }
                foreach (var e in Dose(live, MedicationCatalog.Levetiracetam, "08:00", MedicationAdministrationStatus.Administered, 8, 4, 5,
                             doseGiven: "1 tablet (500mg)")) yield return e;
                var brk = PackageRows.Break(_run, completion, worker, At(live, 9, 30), At(live, 9, 45));
                yield return new Event(At(live, 9, 45), typeof(ShiftBreak), brk.Id, brk, worker);
                // Ten past ten, not 09:41: that minute belongs to the one flagged note of the demo's first day (the incident story, plan I-09).
                var note = PackageRows.Note(_run, live.Shift, worker, At(live, 10, 5), LiveSetCatalog.MorningNote(live.Date));
                yield return new Event(At(live, 10, 5), typeof(ShiftNote), note.Id, note, worker);
                foreach (var e in Dose(live, MedicationCatalog.IdOf("sophie-omeprazole"), "10:00", MedicationAdministrationStatus.Refused, 0, 0, 8,
                             reason: "Unsettled stomach. Re-offered at 10:30 with a snack and declined again.")) yield return e;
                foreach (var e in Prn(live, MedicationCatalog.Paracetamol, At(live, 10, 20), At(live, 10, 22), "Headache after a busy morning", "2 tablets (1000mg)")) yield return e;
            }
            else if (story == LiveSetCatalog.Insulin)
            {
                var witness = Witness(live);
                foreach (var e in Dose(live, MedicationCatalog.InsulinGlargine, "08:00", MedicationAdministrationStatus.Administered, 8, 16, 17,
                             doseGiven: "18 units subcutaneously", witness: witness)) yield return e;
                var brk = PackageRows.Break(_run, completion, worker, At(live, 10, 15), null);           // the running break: closed when the shift is
                yield return new Event(At(live, 10, 15), typeof(ShiftBreak), brk.Id, brk, worker);
                foreach (var e in Dose(live, MedicationCatalog.IdOf("harrison-metformin"), "12:00", MedicationAdministrationStatus.Withheld, 12, 0, 10,
                             reason: "Blood glucose 4.2 before lunch. Held until it is rechecked after the meal.")) yield return e;
            }
            else
            {
                var note = PackageRows.Note(_run, live.Shift, worker, At(live, 18, 15),
                    "Charlotte helped prepare dinner and chose the music. A little restless at 5pm; the garden and a snack helped.");
                yield return new Event(At(live, 18, 15), typeof(ShiftNote), note.Id, note, worker);
                foreach (var e in Dose(live, MedicationCatalog.IdOf("charlotte-quetiapine"), "20:00", MedicationAdministrationStatus.Administered, 20, 6, 7,
                             doseGiven: "1 tablet (25mg)")) yield return e;
            }
        }

        /// <summary>The one scheduled dose of a medication at a time of day, if that medication has such a slot in the shift's window today.</summary>
        private IEnumerable<Event> Dose(Live live, Guid medicationId, string timeOfDay, MedicationAdministrationStatus status, int givenHour, int givenMinute,
            int recordedMinuteAfterSlot, string? reason = null, string? doseGiven = null, User? witness = null)
        {
            var med = _meds.FirstOrDefault(m => m.Id == medicationId);
            if (med is null) yield break;

            var (windowStart, windowEnd) = ProviderLocalTime.RosteredWindowLocal(live.Shift);
            var time = TimeOnly.ParseExact(timeOfDay, "HH:mm", System.Globalization.CultureInfo.InvariantCulture);
            var slot = PackageRows.Local(live.Date, time);
            if (!MedicationSlotCalculator.EnumerateSlots(med, windowStart, windowEnd).Contains(slot)) yield break;

            var given = status == MedicationAdministrationStatus.Administered ? PackageRows.Local(live.Date, new TimeOnly(givenHour, givenMinute)) : (DateTime?)null;
            var recorded = given?.AddMinutes(1) ?? slot.AddMinutes(recordedMinuteAfterSlot);
            var dose = PackageRows.Dose(_run, med, slot, status, live.Worker, given, recorded, reason, doseGiven, witness: witness);
            yield return new Event(recorded, typeof(MedicationAdministration), dose.Id, dose, live.Worker,
                After: witness is null ? null : () => AddWitnessTaskAsync(live, med, dose));
        }

        private IEnumerable<Event> Prn(Live live, Guid medicationId, DateTime givenLocal, DateTime recordedLocal, string reason, string doseGiven)
        {
            var med = _meds.FirstOrDefault(m => m.Id == medicationId);
            if (med is null) yield break;

            var dose = PackageRows.Dose(_run, med, null, MedicationAdministrationStatus.Administered, live.Worker, givenLocal, recordedLocal,
                doseGiven: doseGiven, prnReason: reason);
            yield return new Event(recordedLocal, typeof(MedicationAdministration), dose.Id, dose, live.Worker);
        }

        /// <summary>A competent colleague other than the worker, who has the witness request in their portal.</summary>
        private User? Witness(Live live)
        {
            foreach (var key in new[] { "james", "sarah", "rachel", "brendan" })
            {
                if (_staff.TryGetValue(key, out var user) && user.Id != live.Worker.Id) return user;
            }
            return null;
        }

        private Task AddWitnessTaskAsync(Live live, ParticipantMedication med, MedicationAdministration dose)
        {
            _run.Db.BookingTasks.Add(PackageRows.WitnessTask(_run, med, dose, live.Date));
            return Task.CompletedTask;
        }

        private bool? _oldNotesThere;

        /// <summary>Plan 4.5: never the FIRST row of the shift-notes table the old seed guards with Any() (see <see cref="OldSeedChecks"/>); asked once per tick.</summary>
        private async Task<bool> OldSeedNotesThereAsync(CancellationToken ct) =>
            _oldNotesThere ??= await OldSeedChecks.ShiftNotesThereAsync(_run, "live shift notes", ct);

        private async Task WriteAsync(Live live, List<Event> events, CancellationToken ct)
        {
            if (events.Count == 0) return;

            foreach (var group in events.GroupBy(e => e.Type))
            {
                if (group.Key == typeof(ShiftNote) && !await OldSeedNotesThereAsync(ct)) continue;
                var existing = await AlreadyThereAsync(group.Key, group.ToList(), ct);
                foreach (var e in group.Where(e => !existing.Contains(e.Id)))
                {
                    _run.Db.Add(e.Entity);
                    var when = e.Entity switch
                    {
                        MedicationAdministration m => m.CreatedAt,
                        ShiftBreak b => b.CreatedAt,
                        ShiftNote n => n.CreatedAt,
                        ShiftRoutineCheck t => t.CheckedAt,
                        HandoverAcknowledgement a => a.AcknowledgedAt,
                        _ => _a.NowUtc,
                    };
                    if (e.Actor is not null) _run.StampAudit(e.Id, when, e.Actor);
                    if (e.After is not null) await e.After();
                    _run.Added(live.Story.Key.Replace("live-", "live ", StringComparison.Ordinal) + " " + e.Type.Name);
                }
            }
        }

        /// <summary>Every row of the type the context holds (saved ones it has loaded, and ones this run has added), so a step sees what an earlier step did.</summary>
        private IEnumerable<T> Pending<T>() where T : class =>
            _run.Db.ChangeTracker.Entries<T>().Where(e => e.State != EntityState.Deleted).Select(e => e.Entity);

        /// <summary>
        /// The events of one type whose row is already there, by id (the script's own row from an earlier tick) AND by the key the app holds the row to
        /// (PR 2 review H1, H2). A row a person makes in the portal has a random id where the script's is deterministic, but the app allows one
        /// acknowledgement per reader and handover, one running break per completion, one tick per completion, routine and occurrence, and one active
        /// record per scheduled medication slot, so a person's row is "already there" and the script writes nothing beside it: a second row for the key
        /// is refused by the database and, inside a pack's one transaction, rolls the whole pack back for good, or (a dose, which has no such index)
        /// hides the person's record behind the script's.
        /// </summary>
        private async Task<HashSet<Guid>> AlreadyThereAsync(Type type, List<Event> events, CancellationToken ct)
        {
            var there = await ExistingAsync(type, events.Select(e => e.Id).ToList(), ct);
            if (events.All(e => there.Contains(e.Id))) return there;                              // every row is the script's own, already written: nothing to look for by key (an idle tick stays cheap)

            if (type == typeof(HandoverAcknowledgement))
            {
                var acks = events.Select(e => (Event: e, Row: (HandoverAcknowledgement)e.Entity)).ToList();
                var users = acks.Select(a => a.Row.UserId).Distinct().ToList();
                var have = (await _run.ChunkedAsync(acks.Select(a => a.Row.SourceCompletionId), sources => DemoQueries.HandoverAcksOf(_run.Db, sources, users), ct))
                    .Select(k => (k.SourceCompletionId, k.UserId)).ToHashSet();
                have.UnionWith(Pending<HandoverAcknowledgement>().Select(a => (a.SourceCompletionId, a.UserId)));
                there.UnionWith(acks.Where(a => have.Contains((a.Row.SourceCompletionId, a.Row.UserId))).Select(a => a.Event.Id));
            }
            else if (type == typeof(ShiftBreak))
            {
                // Only one break of a completion may be running: the script's own running break waits for a person's (the shift's end ends it).
                var running = events.Where(e => ((ShiftBreak)e.Entity).EndedAt is null).ToList();
                if (running.Count > 0)
                {
                    await DemoQueries.RunningBreaksOf(_run.Db, running.Select(e => ((ShiftBreak)e.Entity).ShiftCompletionId).Distinct().ToList()).ToListAsync(ct);   // attaches the saved ones
                    var held = Pending<ShiftBreak>().Where(b => b.EndedAt == null).Select(b => b.ShiftCompletionId).ToHashSet();
                    there.UnionWith(running.Where(e => held.Contains(((ShiftBreak)e.Entity).ShiftCompletionId)).Select(e => e.Id));
                }
            }
            else if (type == typeof(ShiftRoutineCheck))
            {
                var ticks = events.Select(e => (Event: e, Row: (ShiftRoutineCheck)e.Entity)).ToList();
                var have = (await _run.ChunkedAsync(ticks.Select(t => t.Row.ShiftCompletionId), completions => DemoQueries.RoutineTicksOf(_run.Db, completions), ct))
                    .Select(k => (k.CompletionId, k.RoutineId, k.ScheduledAt)).ToHashSet();
                have.UnionWith(Pending<ShiftRoutineCheck>().Select(t => (t.ShiftCompletionId, t.ParticipantRoutineId, t.ScheduledAt)));
                there.UnionWith(ticks.Where(t => have.Contains((t.Row.ShiftCompletionId, t.Row.ParticipantRoutineId, t.Row.ScheduledAt))).Select(t => t.Event.Id));
            }
            else if (type == typeof(MedicationAdministration))
            {
                var scheduled = events.Select(e => (Event: e, Row: (MedicationAdministration)e.Entity)).Where(d => d.Row.ScheduledAt is not null).ToList();
                if (scheduled.Count > 0)
                {
                    var recorded = await RecordedSlotsAsync(scheduled.Select(d => d.Row.ParticipantMedicationId).Distinct().ToList(),
                        scheduled.Min(d => d.Row.ScheduledAt!.Value), scheduled.Max(d => d.Row.ScheduledAt!.Value).AddMinutes(1), ct);
                    there.UnionWith(scheduled.Where(d => recorded.Contains((d.Row.ParticipantMedicationId, d.Row.ScheduledAt!.Value))).Select(d => d.Event.Id));
                }
            }
            return there;
        }

        /// <summary>The scheduled slots in a provider-local window that already have an active record, whoever wrote it: saved ones, and ones this run has loaded or added.</summary>
        private async Task<HashSet<(Guid Medication, DateTime Slot)>> RecordedSlotsAsync(List<Guid> medicationIds, DateTime fromLocal, DateTime toLocal, CancellationToken ct)
        {
            var recorded = (await DemoQueries.SlotsRecorded(_run.Db, medicationIds, fromLocal, toLocal).ToListAsync(ct)).Select(s => (s.MedicationId, s.ScheduledAt)).ToHashSet();
            recorded.UnionWith(Pending<MedicationAdministration>().Where(a => a.ScheduledAt != null && a.SupersededByAdministrationId == null)
                .Select(a => (a.ParticipantMedicationId, a.ScheduledAt!.Value)));
            return recorded;
        }

        private Task<HashSet<Guid>> ExistingAsync(Type type, List<Guid> ids, CancellationToken ct)
        {
            if (type == typeof(MedicationAdministration)) return _run.ExistingIdsAsync<MedicationAdministration>(ids, ct);
            if (type == typeof(ShiftBreak)) return _run.ExistingIdsAsync<ShiftBreak>(ids, ct);
            if (type == typeof(ShiftNote)) return _run.ExistingIdsAsync<ShiftNote>(ids, ct);
            if (type == typeof(ShiftRoutineCheck)) return _run.ExistingIdsAsync<ShiftRoutineCheck>(ids, ct);
            if (type == typeof(HandoverAcknowledgement)) return _run.ExistingIdsAsync<HandoverAcknowledgement>(ids, ct);
            throw new InvalidOperationException($"No existing-id probe for {type.Name}.");
        }

        // ── the end of the shift: what the worker's Finish would have required ──

        private async Task CloseAsync(Live live, DateTime endLocal, CancellationToken ct)
        {
            var shift = live.Shift;
            var completion = live.Completion!;
            var rosteredEnd = _a.LocalToUtc(endLocal);
            // Sophie's morning runs over: the worker cannot finish until the lunchtime dose has an outcome, so the shift ends a quarter of an hour late and
            // the dose is overdue (from 13:01) for a while before it is dealt with. The others finish about on time.
            var endVariance = live.Story == LiveSetCatalog.Morning ? DemoIds.Pick(completion.Id, "variance-end", 12, 20) : DemoIds.Pick(completion.Id, "variance-end", -6, 10);
            var actualEnd = rosteredEnd.AddMinutes(endVariance);
            var submittedAt = actualEnd.AddMinutes(DemoIds.Pick(completion.Id, "submit-lag", 2, 9));
            if (submittedAt.AddMinutes(GraceMinutes) > _a.NowUtc) return;

            var submittedLocal = ProviderLocalTime.UtcToLocal(submittedAt, _a.Zone);

            // A break still running is ended (and marked as adjusted, as an edit would): the running break is a Finish blocker.
            await DemoQueries.RunningBreaksOf(_run.Db, new List<Guid> { completion.Id }).ToListAsync(ct);          // attaches the saved ones
            var running = Pending<ShiftBreak>().Where(b => b.ShiftCompletionId == completion.Id && b.EndedAt == null).ToList();   // and the ones just added
            foreach (var b in running)
            {
                var ended = b.StartedAt.AddMinutes(DemoIds.Pick(b.Id, "break-length", 20, 40));
                b.EndedAt = ended > submittedAt ? submittedAt.AddMinutes(-1) : ended;
                b.EditedAt = submittedAt.AddMinutes(-2);
                b.UpdatedAt = submittedAt.AddMinutes(-2);
            }

            // A dose with no outcome is written down now, as the checklist makes the worker do before Finish: given a little after its slot (the
            // worker records it at the end) or, when it cannot be a given dose (a high-risk one has no witness here), not given with a reason.
            var (windowStart, windowEnd) = ProviderLocalTime.RosteredWindowLocal(shift);
            var participantMeds = _meds.Where(m => m.ParticipantId == shift.ParticipantId && m.Type == MedicationType.Regular).ToList();
            var open = participantMeds
                .SelectMany(m => MedicationSlotCalculator.EnumerateSlots(m, windowStart, windowEnd).Select(slot => (Med: m, Slot: slot)))
                .Where(x => _a.LocalToUtc(x.Slot) <= submittedAt)
                .Select(x => (x.Med, x.Slot, Id: PackageRows.DoseId(x.Med.Id, x.Slot)))
                .ToList();
            if (open.Count > 0)
            {
                // A slot that has an active record is dealt with, whoever wrote it: a person who recorded the 12:00 dose, given or refused, has recorded it, and
                // the script never writes a second beside theirs (PR 2 review H2: the shift's close would otherwise hide the person's record behind its own).
                // The script's own row by id counts too (a later record may have superseded it), and so do the ones this run has just written.
                var recorded = await RecordedSlotsAsync(open.Select(x => x.Med.Id).Distinct().ToList(), windowStart, windowEnd, ct);
                var ours = await _run.ExistingIdsAsync<MedicationAdministration>(open.Select(x => x.Id), ct);
                ours.UnionWith(Pending<MedicationAdministration>().Select(a => a.Id));
                var recordedAt = submittedLocal.AddMinutes(-3);
                foreach (var (med, slot, id) in open.Where(x => !recorded.Contains((x.Med.Id, x.Slot)) && !ours.Contains(x.Id)))
                {
                    var given = slot.AddMinutes(DemoIds.Pick(id, "late-given", 8, 40));
                    if (given >= recordedAt) given = recordedAt.AddMinutes(-1);
                    var late = !med.IsHighRisk && given >= slot;
                    var dose = late
                        ? PackageRows.Dose(_run, med, slot, MedicationAdministrationStatus.Administered, live.Worker, given, recordedAt, doseGiven: med.DoseDescription)
                        : PackageRows.Dose(_run, med, slot, MedicationAdministrationStatus.Missed, live.Worker, null, recordedAt,
                            reason: "Not recorded during the shift. Marked as not given at finish.");
                    _run.Db.MedicationAdministrations.Add(dose);
                    _run.StampAudit(dose.Id, dose.CreatedAt, live.Worker);
                    _run.Added(late ? "live doses recorded late" : "live doses closed as not given");
                }
            }

            // An as-needed dose's outcome, written when the shift is finished (it is not a Finish blocker).
            var prnIds = _meds.Where(m => m.ParticipantId == shift.ParticipantId && m.Type == MedicationType.Prn).Select(m => m.Id).ToList();
            if (prnIds.Count > 0)
            {
                var from = _a.LocalToUtc(windowStart);
                await DemoQueries.PrnDosesAwaitingOutcome(_run.Db, prnIds, from).ToListAsync(ct);          // attaches the saved ones
                var pending = Pending<MedicationAdministration>()
                    .Where(a => prnIds.Contains(a.ParticipantMedicationId) && a.Status == MedicationAdministrationStatus.Administered && a.PrnOutcome == null
                                && a.AdministeredAt >= from && a.IdempotencyKey != null && a.IdempotencyKey.StartsWith("demo-v1:", StringComparison.Ordinal))
                    .ToList();
                foreach (var dose in pending)
                    PackageRows.PrnOutcome(_run, dose, "Settled within the hour with rest and a drink.", submittedLocal.AddMinutes(-4));
            }

            var hasNote = await DemoQueries.NotesOf(_run.Db, new List<Guid> { shift.Id }).AnyAsync(ct) || _run.Db.ChangeTracker.Entries<ShiftNote>().Any(n => n.Entity.ShiftId == shift.Id);

            completion.ActualEnd = actualEnd;
            completion.SubmittedAt = submittedAt;
            completion.VarianceMinutesEnd = ShiftVarianceCalculator.VarianceMinutes(actualEnd, rosteredEnd);
            completion.HandoverText = LiveSetCatalog.HandoverOf(live.Story, live.Date);
            completion.NothingToHandOver = false;
            completion.NothingToNoteConfirmed = !hasNote;
            if (completion.StartLatitude is not null)
            {
                completion.EndLatitude = completion.StartLatitude + DemoIds.Pick(completion.Id, "lat-end", -3, 3) / 1000m;
                completion.EndLongitude = completion.StartLongitude + DemoIds.Pick(completion.Id, "lon-end", -3, 3) / 1000m;
            }
            completion.UpdatedAt = submittedAt;

            shift.Status = ShiftStatus.PendingReview;
            shift.UpdatedAt = submittedAt;
            _run.StampAudit(completion.Id, submittedAt, live.Worker);                          // the one tap is one story: the completion's Finish names the worker and the instant, as the shift's does (PR 2 review L10)
            _run.StampAudit(shift.Id, submittedAt, live.Worker);
            _run.Changed("live shifts finished");
        }
    }
}
