namespace Odip.Application.Common;

/// <summary>
/// Machine-readable <c>code</c> values for medication-administration failures, so clients can branch on the
/// failure kind instead of parsing message text. The Medication Competency gate's own codes
/// (<c>MEDICATION_COMPETENCY_MISSING</c> / <c>_EXPIRED</c> / <c>_UNVERIFIABLE</c>) live on
/// <c>Odip.Domain.Medications.MedicationCompetencyGate</c>, next to the rule that produces them.
/// </summary>
public static class MedicationErrorCodes
{
    /// <summary>409: the scheduled dose slot already has an ACTIVE record that this request cannot supersede (only an Administered record
    /// supersedes a Refused or Missed one). The response <c>data</c> is that record.</summary>
    public const string AdministrationAlreadyRecorded = "ADMINISTRATION_ALREADY_RECORDED";

    /// <summary>400: the idempotency key was already used for a different medication.</summary>
    public const string AdministrationIdempotencyKeyReused = "ADMINISTRATION_IDEMPOTENCY_KEY_REUSED";

    /// <summary>422: the submitted <c>scheduledAt</c> is not one of the dose slots due in the shift window.</summary>
    public const string DoseSlotNotDue = "DOSE_SLOT_NOT_DUE";

    /// <summary>422: an Administered dose was charted more than 60 minutes before its slot (provider-local time).</summary>
    public const string AdministrationTooEarly = "ADMINISTRATION_TOO_EARLY";

    /// <summary>422: <c>administeredAt</c> is in the future (more than 5 minutes ahead) or before the earliest time the dose could have been
    /// given (the shift's actual start on the portal; the start of the slot's day on the MAR).</summary>
    public const string AdministrationTimeOutOfRange = "ADMINISTRATION_TIME_OUT_OF_RANGE";

    /// <summary>409: the medication is OnHold or Ceased, so it can't be recorded from a shift.</summary>
    public const string MedicationNotActive = "MEDICATION_NOT_ACTIVE";
}
