using Odip.Domain.Entities;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Audit;

public static class AuditedEntities
{
    public static readonly HashSet<Type> Types = new()
    {
        typeof(TripInstance),
        typeof(Participant),
        typeof(ParticipantBooking),
        typeof(IncidentReport),
        typeof(User),
        typeof(StaffAssignment),
        typeof(VehicleAssignment),

        // Rostering (M1/M2): a Shift carries OverrideReason — the justification a coordinator
        // gives for rostering against a Warning finding (e.g. a lapsed-but-unverified worker
        // screening record). That reason, and every other field change on the shift, must be
        // recoverable after the fact, so Shift is audited like the other operational entities.
        typeof(Shift),

        // ShiftPattern is the origination point for a recurring staff/participant pairing:
        // every Shift the pattern later expands into inherits DefaultUserId from it, so who
        // set up (or changed) that pairing, and when, is the same class of question as who
        // rostered a single shift. Audited for the same reason as Shift itself.
        typeof(ShiftPattern),

        // A StaffParticipantCompatibility row marking a pair Excluded is a safeguarding
        // decision with real consequences: RosterConflictService raises it as the
        // COMPATIBILITY_EXCLUDED finding (a Warning, per decision 2 — overridable with a
        // reason like any other Warning, not the one Blocking rule). Who set an Excluded
        // flag, when, and why it was later changed is exactly the kind of thing an audit
        // needs to answer, so all three CompatibilityLevel transitions are audited.
        typeof(StaffParticipantCompatibility),

        // Medication management: prescribing details (dose, PRN limits, chemical-restraint
        // flags, consent) and every administration record are exactly the kind of change
        // history NDIS medication management practice standards expect to be recoverable.
        typeof(ParticipantMedication),
        typeof(MedicationAdministration),

        // Participant notes: free-text observations/preferences about a participant —
        // who wrote or changed a note, and when, should be recoverable like any other
        // participant-facing record.
        typeof(ParticipantNote),

        // Caregiver profile form: a family member's staged edits and the admin
        // create/revoke/accept/reject lifecycle around them are exactly the kind of
        // participant-facing change history an audit needs to answer. Submit runs
        // anonymously (no authenticated principal) — see AuditInterceptor's ActorItemKey
        // override for how that row still gets attributed to the caregiver by name.
        typeof(CaregiverProfileSubmission),

        // Staff leave + recurring unavailability: a coordinator's approve/decline decision and
        // note, and every subsequent field change, must be recoverable — same reasoning as
        // Shift.OverrideReason above. StaffAvailability is added here too (it was conspicuously
        // absent before this feature, per the design spec's Context section): its remaining
        // Unavailable/Training/Preferred/Available rows now get history from this point forward,
        // even though the entity itself is otherwise unchanged by this PR.
        typeof(LeaveRequest),
        typeof(RecurringUnavailability),
        typeof(StaffAvailability),

        // Shift-completion state machine: a Return's reason and every review decision must be
        // recoverable — same reasoning as Shift.OverrideReason above.
        typeof(ShiftCompletion),

        // Shift breaks (shift package): the times a worker took off during a shift, and any edit to them before
        // Finish, feed the coordinator's review of the shift's worked time — who adjusted a break and when
        // must be recoverable, same reasoning as ShiftCompletion above.
        typeof(ShiftBreak),

        // Handover acknowledgement (shift package): who marked a handover as read, and when - a compliance-adjacent
        // "did the next worker actually see this?" record, audited like the shift notes it comes from.
        typeof(HandoverAcknowledgement),
        // A routine tick is the worker's record that a routine was done on a shift (and the untick, a removal of it): who and when is
        // recoverable, like the breaks.
        typeof(ShiftRoutineCheck),

        // Compliance-coverage report (item 11): these six were flagged as audited-entity gaps.
        // Restrictive practices, claims/line items, participant consent decisions, shift notes
        // (compliance-adjacent per its own remarks — falls/medication/injury/behaviour keyword
        // flags), and booking tasks all carry the same "who changed this, and when" requirement
        // as the entities already listed above.
        typeof(RestrictivePractice),
        typeof(TripClaim),
        typeof(ClaimLineItem),
        typeof(ParticipantConsent),
        typeof(ShiftNote),
        typeof(BookingTask),

        // Notifications: a user's own "stop emailing me about X" is worth a history — same
        // reasoning as any other self-service preference change. NotificationOutbox/
        // NotificationLog are deliberately NOT audited: outbox rows churn every dispatcher tick
        // (Attempts/Status/NextAttemptAt update repeatedly on Pending rows) and would flood
        // AuditLog with zero-investigative-value noise — their own Status/LastError/SentAt
        // fields already are the purpose-built delivery trail (design spec §1).
        typeof(NotificationPreference),
    };

    private static readonly HashSet<string> ExcludedProperties = new()
    {
        "CreatedAt", "UpdatedAt"
    };

    public static bool IsExcluded(string propertyName) =>
        ExcludedProperties.Contains(propertyName);
}
