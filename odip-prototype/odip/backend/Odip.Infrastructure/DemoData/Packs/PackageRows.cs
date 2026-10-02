using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Medications;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// The rows of the shift package and the medication chart, built the way the app builds them (field for field, as the portal's and the
/// recorder's own code does, minus the notifications they raise): every pack that writes one of these goes through here, so a break, a note, a
/// tick, an acknowledgement or a dose looks the same whichever script made it.
///
/// Time (plan 2.0, 5.3): a LOCAL argument is a provider-local wall-clock value (Kind Unspecified, never shifted); every instant on a row is
/// <see cref="DemoAnchors.LocalToUtc(DateTime)"/> of one, the one conversion allowed, so a dose at 08:00 is 22:00Z the evening before in standard
/// time and 21:00Z in daylight saving, and nothing here knows a UTC offset. Ids are <see cref="DemoIds"/> of the row's story key, so the same
/// row is found again whatever its values have become.
/// </summary>
internal static class PackageRows
{
    /// <summary>A wall-clock time on a date, Kind Unspecified, as shift times and dose slots are stored.</summary>
    public static DateTime Local(DateOnly date, TimeOnly time) => date.ToDateTime(time, DateTimeKind.Unspecified);

    // ── doses ────────────────────────────────────────────────────────────────

    /// <summary>The id of the record of one scheduled slot of a medication (one active record per slot, so the slot IS the key).</summary>
    public static Guid DoseId(Guid medicationId, DateTime scheduledLocal) => DemoIds.For("administration", medicationId, scheduledLocal);

    /// <summary>The id of an as-needed dose, keyed by the minute it was given.</summary>
    public static Guid PrnDoseId(Guid medicationId, DateTime givenLocal) => DemoIds.For("administration", medicationId, "prn", givenLocal);

    /// <summary>
    /// A record of one dose. <paramref name="givenLocal"/> is when it was given (null when it was not: a Refused, Withheld or Missed record has no
    /// administered time, as the recorder leaves it), <paramref name="recordedLocal"/> when it was written down. A staff witness makes it Pending
    /// (the recorder's rule for a high-risk medication) until the script moves it on; a competency flag is a fact about the recorder on the day.
    /// </summary>
    public static MedicationAdministration Dose(
        DemoRun run, ParticipantMedication med, DateTime? scheduledLocal, MedicationAdministrationStatus status, User recorder, DateTime? givenLocal,
        DateTime recordedLocal, string? reason = null, string? doseGiven = null, string? notes = null, string? prnReason = null, User? witness = null,
        Guid? idOverride = null)
    {
        var anchors = run.Anchors;
        var id = idOverride ?? (scheduledLocal is { } slot ? DoseId(med.Id, slot) : PrnDoseId(med.Id, givenLocal ?? recordedLocal));
        var recordedAt = anchors.LocalToUtc(recordedLocal);
        var administeredAt = givenLocal is { } given ? anchors.LocalToUtc(given) : (DateTime?)null;
        var competent = MedicationCompetencyGate.Evaluate(recorder, DateOnly.FromDateTime(recordedLocal)).IsCurrent;

        return new MedicationAdministration
        {
            Id = id,
            TenantId = run.TenantId,
            ParticipantMedicationId = med.Id,
            ParticipantId = med.ParticipantId,
            ScheduledAt = scheduledLocal,
            AdministeredAt = administeredAt,
            AdministeredAtTimeZone = administeredAt is null ? null : anchors.Provider.Id,
            Status = status,
            DoseGiven = doseGiven,
            RecordedByName = recorder.FullName,
            RecordedByUserId = recorder.Id,
            WitnessName = witness?.FullName,
            WitnessUserId = witness?.Id,
            WitnessStatus = witness is null ? WitnessStatus.NotRequired : WitnessStatus.Pending,
            WitnessRequestedAt = witness is null ? null : recordedAt,
            Reason = reason,
            PrnReason = prnReason,
            Notes = notes,
            IdempotencyKey = $"demo-v1:{id:D}",
            RecordedWithoutCompetency = !competent,
            CreatedAt = recordedAt,
            UpdatedAt = recordedAt,
        };
    }

    /// <summary>
    /// The recorder's own obligation task for a pending staff witness (SourceKey med-witness:{id}), due the provider day after the dose was recorded,
    /// open until the witness answers (see <see cref="WitnessAnswers"/>).
    /// </summary>
    public static BookingTask WitnessTask(DemoRun run, ParticipantMedication med, MedicationAdministration dose, DateOnly recordedOn)
    {
        var participant = run.Directory.AllParticipants.FirstOrDefault(p => p.Id == med.ParticipantId)?.FullName ?? "a participant";
        return new BookingTask
        {
            Id = DemoIds.For("task", "med-witness", dose.Id),
            TenantId = run.TenantId,
            SourceKey = $"med-witness:{dose.Id}",
            TaskType = TaskType.MedicationWitness,
            Title = $"Witness sign-off needed: {med.Name} for {participant}",
            DueDate = recordedOn.AddDays(1),
            LinkTo = "/portal/witness-approvals",
            MedicationAdministrationId = dose.Id,
            Status = TaskItemStatus.NotStarted,
            CreatedAt = dose.CreatedAt,
            UpdatedAt = dose.CreatedAt,
        };
    }

    /// <summary>The witness answered: Approved, at the given local time (never before the request).</summary>
    public static void WitnessApproved(DemoRun run, MedicationAdministration dose, DateTime respondedLocal)
    {
        var at = run.Anchors.LocalToUtc(respondedLocal);
        if (dose.WitnessRequestedAt is { } requested && at < requested) at = requested.AddMinutes(1);
        dose.WitnessStatus = WitnessStatus.Approved;
        dose.WitnessRespondedAt = at;
        dose.UpdatedAt = at;
    }

    /// <summary>What the worker wrote down about an as-needed dose afterwards (the outcome is not a Finish blocker, and it can be left for the shift's end).</summary>
    public static void PrnOutcome(DemoRun run, MedicationAdministration dose, string outcome, DateTime atLocal)
    {
        var at = run.Anchors.LocalToUtc(atLocal);
        dose.PrnOutcome = outcome;
        dose.PrnOutcomeAt = at;
        dose.UpdatedAt = at;
    }

    // ── breaks, notes, ticks, acknowledgements ───────────────────────────────

    /// <summary>A break of the shift's active completion; <paramref name="endLocal"/> null is the one running break (the partial unique index allows one).</summary>
    public static ShiftBreak Break(DemoRun run, ShiftCompletion completion, User worker, DateTime startLocal, DateTime? endLocal)
    {
        var started = run.Anchors.LocalToUtc(startLocal);
        var ended = endLocal is { } end ? run.Anchors.LocalToUtc(end) : (DateTime?)null;
        return new ShiftBreak
        {
            Id = DemoIds.For("shift-break", completion.Id, startLocal),
            TenantId = run.TenantId,
            ShiftCompletionId = completion.Id,
            StartedAt = started,
            EndedAt = ended,
            CreatedByUserId = worker.Id,
            CreatedAt = started,
            UpdatedAt = ended ?? started,
        };
    }

    /// <summary>
    /// The one break of a finished shift, between two instants: a break is a stretch of elapsed time after the shift started, so history places it
    /// by adding minutes to the start instant, never by a wall-clock time that a clock change could move.
    /// </summary>
    public static ShiftBreak BreakBetween(DemoRun run, ShiftCompletion completion, User worker, DateTime startedAt, DateTime endedAt) => new()
    {
        Id = DemoIds.For("shift-break", completion.Id, "history"),
        TenantId = run.TenantId,
        ShiftCompletionId = completion.Id,
        StartedAt = startedAt,
        EndedAt = endedAt,
        CreatedByUserId = worker.Id,
        CreatedAt = startedAt,
        UpdatedAt = endedAt,
    };

    /// <summary>A shift note. The flags are what the scanner says of the body, never typed (NOTES-02).</summary>
    public static ShiftNote Note(DemoRun run, Shift shift, User author, DateTime atLocal, string body)
    {
        var at = run.Anchors.LocalToUtc(atLocal);
        return new ShiftNote
        {
            Id = DemoIds.For("shift-note", shift.Id, atLocal),
            TenantId = run.TenantId,
            ShiftId = shift.Id,
            AuthorUserId = author.Id,
            AuthorName = author.FullName,
            Body = body,
            FlaggedCategories = ShiftNoteKeywordScanner.Scan(body),
            CreatedAt = at,
            UpdatedAt = at,
        };
    }

    /// <summary>A routine ticked on the shift's completion, with the snapshot the review needs (the occurrence's local time and the routine's title as it was).</summary>
    public static ShiftRoutineCheck Tick(
        DemoRun run, ShiftCompletion completion, ParticipantRoutine routine, DateTime? occursAtLocal, User worker, DateTime checkedLocal)
    {
        var at = run.Anchors.LocalToUtc(checkedLocal);
        return new ShiftRoutineCheck
        {
            Id = DemoIds.For("shift-routine-check", completion.Id, routine.Id),
            TenantId = run.TenantId,
            ShiftCompletionId = completion.Id,
            ParticipantRoutineId = routine.Id,
            ScheduledAt = occursAtLocal,
            RoutineTitle = routine.Title,
            CheckedByUserId = worker.Id,
            CheckedAt = at,
            CreatedAt = at,
            UpdatedAt = at,
        };
    }

    /// <summary>The next worker marking the previous worker's handover read, from their own shift.</summary>
    public static HandoverAcknowledgement Acknowledgement(DemoRun run, ShiftCompletion source, Shift readerShift, User reader, DateTime atLocal)
    {
        var at = run.Anchors.LocalToUtc(atLocal);
        return new HandoverAcknowledgement
        {
            Id = DemoIds.For("handover-ack", source.Id, reader.Id),
            TenantId = run.TenantId,
            SourceCompletionId = source.Id,
            ShiftId = readerShift.Id,
            UserId = reader.Id,
            AcknowledgedAt = at,
            CreatedAt = at,
            UpdatedAt = at,
        };
    }
}
