using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Medications;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// The medication chart's history (plan 3a, 1b rows 24 to 26): for the last seven days and today, every scheduled dose of the story participants'
/// active medications has a record, written as its time passes (so a first run fills the week at once and every later tick adds what has come
/// due, and a host that was off catches up with the same rows). A record is a function of its slot (<see cref="PackageRows.DoseId"/>), so it is
/// found again whatever its values have become, and a slot that already has an active record, whoever wrote it (the old seed's aged rows, a worker,
/// the live set), is never given a second.
///
/// What the records say: out of every thousand slots about 871 were given a little after their time, 50 refused, 36 withheld and 43 missed (the
/// plan's proportions of about 140: 118 / 7 / 5 / 6), a third of the missed ones were later given and the missed record is kept as history linked to
/// the one that replaced it, and one in sixty was recorded by somebody whose competency is not current (Emily has none, Priya's lapsed): the flagged
/// records. A high-risk dose has a staff witness who answers the next morning (<see cref="WitnessAnswers"/>), its task open until then. As-needed
/// medications are given on about a third of the days, outcome recorded on three in four, the rest left for the viewer to notice. One record is
/// the plan's wrong-medication story (Mia given the wrong strength of sertraline on the day before the first run, which the incident story files
/// from). Slots inside a live shift's window on the two days the live set works are left to it: those are its stories, with the dose that is due,
/// overdue or about to be.
///
/// Time (plan 2.0): slots are provider-local wall-clock values, every instant on a record is the one conversion of a local time, and "today" is
/// the provider's date, so the week is the same in Sydney, Brisbane and Adelaide and across both clock changes.
/// </summary>
public sealed class MedicationHistoryPack : IDemoPack
{
    public string Name => "medication-history";

    private const int HistoryDays = 7;
    private const int GraceMinutes = 2;

    // Per thousand slots (plan 3a: of about 140, 7 refused, 5 withheld, 6 missed).
    private const int RefusedBelow = 50;
    private const int WithheldBelow = 86;
    private const int MissedBelow = 129;

    private const int PrnDayPercent = 33;

    private static readonly string[] CompetentRecorders = { "james", "brendan", "rachel", "marcus", "jade", "sarah", "daniel" };
    private static readonly string[] Witnesses = { "james", "sarah", "rachel", "brendan", "marcus" };

    private static readonly string[] RefusedReasons =
    {
        "Declined the dose at the time and again when it was offered later.",
        "Said she felt sick and did not want it. Offered again after a snack and declined.",
        "Was asleep and could not be woken properly. Offered again later and declined.",
        "Did not want to take it today. Prompted twice, with a drink, and still declined.",
    };

    private static readonly string[] WithheldReasons =
    {
        "Held because of drowsiness on waking. The pharmacist's advice was followed and the family was told.",
        "Withheld before the blood test this morning, as the prescriber's instructions say. Given at the next dose.",
        "Held while a temperature was being watched. The on-call GP was phoned and agreed.",
    };

    private static readonly string[] MissedReasons =
    {
        "Away from home on a community outing at the scheduled time and the pack was left behind.",
        "The pharmacy delivery was late, so there was no pack to give from.",
        "Nobody was on shift for this participant at the scheduled time. Noticed at the next handover.",
    };

    private static readonly string[] PrnOutcomes =
    {
        "Settled within the hour with rest and a drink.",
        "Eased after about 45 minutes. No further dose needed.",
        "Some relief; rested quietly for the afternoon.",
        "Settled. Checked again at the end of the shift and no further concerns.",
    };

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var anchors = run.Anchors;
        var participantIds = run.Directory.AllParticipants.Where(p => p.Key.Length > 0 && p.IsActive && !p.IsDraft).Select(p => p.Id).ToList();
        if (participantIds.Count == 0) return;

        var chart = await DemoQueries.ActiveMedicationsOf(run.Db, participantIds).ToListAsync(ct);
        if (chart.Count == 0) return;

        var staff = await run.FreshStaffAsync(ct);
        var firstDay = anchors.D0.AddDays(-HistoryDays);
        var from = PackageRows.Local(firstDay, TimeOnly.MinValue);
        var to = PackageRows.Local(anchors.D0.AddDays(1), TimeOnly.MinValue);

        var recorded = (await DemoQueries.SlotsRecorded(run.Db, chart.Select(m => m.Id).ToList(), from, to).ToListAsync(ct))
            .Select(s => (s.MedicationId, s.ScheduledAt)).ToHashSet();
        var live = await LiveWindowsAsync(run, ct);

        var doses = new List<(MedicationAdministration Dose, ParticipantMedication Med, User Recorder, bool Witnessed)>();
        void Add(MedicationAdministration dose, ParticipantMedication med, User recorder, bool witnessed) => doses.Add((dose, med, recorder, witnessed));

        // The wrong-medication story, once: Mia's sertraline slot on the day before the first run (while that day is still in the week).
        WrongMedication(run, chart, staff, recorded, from, to, Add);

        foreach (var med in chart.Where(m => m.Type == MedicationType.Regular))
        {
            foreach (var slot in MedicationSlotCalculator.EnumerateSlots(med, from, to))
            {
                if (recorded.Contains((med.Id, slot))) continue;
                if (live.Any(w => w.Participant == med.ParticipantId && slot >= w.Start && slot < w.End)) continue;
                ScheduledDose(run, med, slot, staff, Add);
            }
        }

        await PrnDosesAsync(run, chart, staff, firstDay, live, Add, ct);
        if (doses.Count == 0)
        {
            await WitnessAnswers.RunAsync(run, ct);
            return;
        }

        foreach (var (dose, med, recorder, witnessed) in doses)
        {
            run.Db.MedicationAdministrations.Add(dose);
            run.StampAudit(dose.Id, dose.CreatedAt, recorder);
            if (witnessed) run.Db.BookingTasks.Add(PackageRows.WitnessTask(run, med, dose, DateOnly.FromDateTime(ProviderLocal(run, dose.CreatedAt))));
        }
        await run.SaveAsync(ct);
        run.Added("medication history doses", doses.Count);

        await WitnessAnswers.RunAsync(run, ct);
    }

    private static DateTime ProviderLocal(DemoRun run, DateTime utc) => ProviderLocalTime.UtcToLocal(ProviderLocalTime.AsUtc(utc), run.Anchors.Zone);

    /// <summary>True once the local time is at least two minutes past, on the provider's clock.</summary>
    private static bool Due(DemoRun run, DateTime local) => run.Anchors.LocalToUtc(local).AddMinutes(GraceMinutes) <= run.Anchors.NowUtc;

    // ── scheduled doses ──

    private static void ScheduledDose(DemoRun run, ParticipantMedication med, DateTime slot, IReadOnlyDictionary<string, User> staff,
        Action<MedicationAdministration, ParticipantMedication, User, bool> add)
    {
        var id = PackageRows.DoseId(med.Id, slot);
        var date = DateOnly.FromDateTime(slot);
        // A high-risk dose (insulin, warfarin) is always written as given, with its witness: the stories do not have it refused or missed.
        var outcome = med.IsHighRisk ? 999 : DemoIds.Pick(id, "outcome", 0, 999);
        var recorder = Recorder(staff, id, slot, med);
        if (recorder is null) return;

        if (outcome < MissedBelow)
        {
            var status = outcome < RefusedBelow ? MedicationAdministrationStatus.Refused
                : outcome < WithheldBelow ? MedicationAdministrationStatus.Withheld : MedicationAdministrationStatus.Missed;
            var recordedLocal = slot.AddMinutes(DemoIds.Pick(id, "recorded", 8, 45));
            var reasons = status == MedicationAdministrationStatus.Refused ? RefusedReasons : status == MedicationAdministrationStatus.Withheld ? WithheldReasons : MissedReasons;
            var reason = reasons[DemoIds.Pick(id, "reason", 0, reasons.Length - 1)];

            // A missed dose is, a third of the time, given later once somebody notices: the later record replaces it and the missed one is kept as history.
            if (status == MedicationAdministrationStatus.Missed && DemoIds.Pick(id, "later", 0, 2) == 0)
            {
                var lateGiven = slot.AddMinutes(DemoIds.Pick(id, "late-given", 150, 300));
                var lateRecorded = lateGiven.AddMinutes(2);
                if (!Due(run, lateRecorded)) return;                                         // both records appear together, once the later one is written

                var lateId = DemoIds.For("administration", med.Id, slot, "late");
                var later = PackageRows.Dose(run, med, slot, MedicationAdministrationStatus.Administered, recorder, lateGiven, lateRecorded,
                    doseGiven: med.DoseDescription, notes: "Given late once the missed dose was noticed.", idOverride: lateId);
                var missed = PackageRows.Dose(run, med, slot, MedicationAdministrationStatus.Missed, recorder, null, recordedLocal, reason: reason);
                missed.SupersededByAdministrationId = later.Id;
                missed.UpdatedAt = later.CreatedAt;
                add(missed, med, recorder, false);
                add(later, med, recorder, false);
                return;
            }

            if (!Due(run, recordedLocal)) return;
            add(PackageRows.Dose(run, med, slot, status, recorder, null, recordedLocal, reason: reason), med, recorder, false);
            return;
        }

        var given = slot.AddMinutes(DemoIds.Pick(id, "given", 0, 25));
        var recordedAt = given.AddMinutes(DemoIds.Pick(id, "recorded-after", 1, 3));
        if (!Due(run, recordedAt)) return;

        User? witness = null;
        if (med.IsHighRisk)
        {
            witness = Witness(staff, recorder, id, date);
            if (witness is null) return;                                                      // no colleague to witness it: the stories do not give it
        }
        var dose = PackageRows.Dose(run, med, slot, MedicationAdministrationStatus.Administered, recorder, given, recordedAt, doseGiven: med.DoseDescription, witness: witness);
        add(dose, med, recorder, witness is not null);
    }

    /// <summary>
    /// Who recorded a dose: one in sixty by somebody whose competency is not current (Emily or Priya), otherwise somebody whose is that day. The
    /// worker is a function of the participant, the date and the part of the day (morning, afternoon, evening), as a shift would be, so one person
    /// gives a participant's morning doses.
    /// </summary>
    private static User? Recorder(IReadOnlyDictionary<string, User> staff, Guid id, DateTime at, ParticipantMedication med)
    {
        var date = DateOnly.FromDateTime(at);
        if (!med.IsHighRisk && DemoIds.Pick(id, "flagged-recorder", 0, 59) == 0)
        {
            var key = DemoIds.Pick(id, "flagged-who", 0, 1) == 0 ? "emily" : "priya";
            if (staff.TryGetValue(key, out var flagged)) return flagged;
        }

        var pool = CompetentRecorders.Where(k => staff.TryGetValue(k, out var u) && MedicationCompetencyGate.Evaluate(u, date).IsCurrent).ToArray();
        var part = at.Hour < 12 ? "morning" : at.Hour < 17 ? "afternoon" : "evening";
        var shift = DemoIds.For("dose-shift", med.ParticipantId, date, part);
        return pool.Length == 0 ? null : staff[pool[DemoIds.Pick(shift, "recorder", 0, pool.Length - 1)]];
    }

    private static User? Witness(IReadOnlyDictionary<string, User> staff, User recorder, Guid id, DateOnly date)
    {
        var pool = Witnesses.Where(k => staff.TryGetValue(k, out var u) && u.Id != recorder.Id && MedicationCompetencyGate.Evaluate(u, date).IsCurrent).ToArray();
        return pool.Length == 0 ? null : staff[pool[DemoIds.Pick(id, "witness", 0, pool.Length - 1)]];
    }

    // ── the wrong-medication story ──

    private static void WrongMedication(DemoRun run, List<ParticipantMedication> chart, IReadOnlyDictionary<string, User> staff,
        HashSet<(Guid, DateTime)> recorded, DateTime from, DateTime to, Action<MedicationAdministration, ParticipantMedication, User, bool> add)
    {
        var med = chart.FirstOrDefault(m => m.Id == MedicationCatalog.MiaSertraline);
        if (med is null || MedicationCatalog.FirstRunDay(chart) is not { } firstRun) return;
        if (!staff.TryGetValue("daniel", out var daniel)) return;

        var slot = PackageRows.Local(firstRun.AddDays(-1), new TimeOnly(8, 0));
        if (slot < from || slot >= to || recorded.Contains((med.Id, slot))) return;           // out of the week by now, or already there

        var given = slot.AddMinutes(9);
        var recordedLocal = given.AddMinutes(3);
        if (!Due(run, recordedLocal)) return;

        const string notes = "A 100mg tablet was given from a pack meant for another person; Mia's prescribed dose is 50mg. "
            + "The GP was phoned and advised watching her for drowsiness and nausea today, and an incident report was started.";
        var dose = PackageRows.Dose(run, med, slot, MedicationAdministrationStatus.WrongMedication, daniel, given, recordedLocal,
            doseGiven: "1 tablet (100mg), double the prescribed dose", notes: notes);
        recorded.Add((med.Id, slot));
        add(dose, med, daniel, false);
    }

    // ── as-needed doses ──

    private async Task PrnDosesAsync(DemoRun run, List<ParticipantMedication> chart, IReadOnlyDictionary<string, User> staff, DateOnly firstDay,
        List<(Guid Participant, DateTime Start, DateTime End)> live, Action<MedicationAdministration, ParticipantMedication, User, bool> add, CancellationToken ct)
    {
        var anchors = run.Anchors;
        var candidates = new List<(ParticipantMedication Med, DateOnly Date, DateTime Given, Guid Id)>();
        foreach (var med in chart.Where(m => m.Type == MedicationType.Prn && !m.IsChemicalRestraint))
        {
            for (var date = firstDay; date <= anchors.D0; date = date.AddDays(1))
            {
                if (med.StartDate > PackageRows.Local(date, new TimeOnly(23, 59))) continue;
                if (med.EndDate is { } end && end < PackageRows.Local(date, TimeOnly.MinValue)) continue;
                if (live.Any(w => w.Participant == med.ParticipantId && DateOnly.FromDateTime(w.Start) == date)) continue;       // the live set's own day

                var key = DemoIds.For("prn-day", med.Id, date);
                if (DemoIds.Pick(key, "has-dose", 0, 99) >= PrnDayPercent) continue;

                var given = PackageRows.Local(date, new TimeOnly(9, 0)).AddMinutes(DemoIds.Pick(key, "time", 0, 600));
                candidates.Add((med, date, given, PackageRows.PrnDoseId(med.Id, given)));
            }
        }
        if (candidates.Count == 0) return;

        var existing = await run.ExistingIdsAsync<MedicationAdministration>(candidates.Select(c => c.Id), ct);
        foreach (var (med, date, given, id) in candidates.Where(c => !existing.Contains(c.Id)))
        {
            var hasOutcome = DemoIds.Pick(id, "has-outcome", 0, 99) < 75;
            var recordedLocal = given.AddMinutes(DemoIds.Pick(id, "recorded-after", 1, 3));
            var outcomeLocal = given.AddMinutes(DemoIds.Pick(id, "outcome-after", 40, 120));
            if (!Due(run, hasOutcome ? outcomeLocal : recordedLocal)) continue;                // a dose and its outcome appear together, once both are written

            var recorder = Recorder(staff, id, given, med);
            if (recorder is null) continue;
            var reason = PrnReasonFor(med, id);
            var dose = PackageRows.Dose(run, med, null, MedicationAdministrationStatus.Administered, recorder, given, recordedLocal,
                doseGiven: med.DoseDescription, prnReason: reason);
            if (hasOutcome) PackageRows.PrnOutcome(run, dose, PrnOutcomes[DemoIds.Pick(id, "outcome", 0, PrnOutcomes.Length - 1)], outcomeLocal);
            add(dose, med, recorder, false);
        }
    }

    private static string PrnReasonFor(ParticipantMedication med, Guid id)
    {
        var options = med.Name switch
        {
            "Paracetamol" => new[] { "Headache after a busy morning", "Sore back after the long walk", "Feeling hot and unwell this afternoon" },
            "Ibuprofen" => new[] { "Aching knee after the stairs", "Sore shoulder after the gym session", "Joint pain after sitting for a long time" },
            "Salbutamol" => new[] { "Wheeze after the morning walk", "Short of breath after the stairs" },
            _ => new[] { med.PrnIndication ?? "As needed" },
        };
        return options[DemoIds.Pick(id, "prn-reason", 0, options.Length - 1)];
    }

    // ── the live set's windows ──

    private static async Task<List<(Guid Participant, DateTime Start, DateTime End)>> LiveWindowsAsync(DemoRun run, CancellationToken ct)
    {
        var anchors = run.Anchors;
        var dates = new[] { anchors.D0.AddDays(-1), anchors.D0 };
        var existing = await run.ExistingIdsAsync<Shift>(LiveSetCatalog.ShiftIds(dates), ct);

        var windows = new List<(Guid, DateTime, DateTime)>();
        foreach (var date in dates)
        {
            foreach (var story in LiveSetCatalog.Stories)
            {
                if (!existing.Contains(LiveSetCatalog.ShiftId(story, date))) continue;
                if (run.Directory.Participant(story.Participant) is not { } participant) continue;
                windows.Add((participant.Id, PackageRows.Local(date, story.Start), PackageRows.Local(date, story.End)));
            }
        }
        return windows;
    }
}
