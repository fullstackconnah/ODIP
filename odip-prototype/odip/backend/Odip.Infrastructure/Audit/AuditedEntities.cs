using Odip.Domain.Entities;
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
    };

    private static readonly HashSet<string> ExcludedProperties = new()
    {
        "CreatedAt", "UpdatedAt"
    };

    public static bool IsExcluded(string propertyName) =>
        ExcludedProperties.Contains(propertyName);
}
