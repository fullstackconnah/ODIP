using System.Globalization;
using Odip.Domain.Entities;

namespace Odip.Domain.Medications;

public enum MedicationCompetencyStatus
{
    /// <summary>The user holds a Medication Competency credential that has not expired.</summary>
    Current,

    /// <summary>The user does not hold (or has not had recorded) a Medication Competency credential.</summary>
    NotRecorded,

    /// <summary>The user holds the credential but its expiry date has passed.</summary>
    Expired,

    /// <summary>No staff user could be resolved for the request, so the credential cannot be checked.</summary>
    Unverifiable,
}

/// <param name="Status">The result of the check.</param>
/// <param name="ExpiredOn">For <see cref="MedicationCompetencyStatus.Expired"/>, the expiry date that has passed.</param>
public sealed record MedicationCompetencyCheck(MedicationCompetencyStatus Status, DateOnly? ExpiredOn = null)
{
    public bool IsCurrent => Status == MedicationCompetencyStatus.Current;

    /// <summary>Machine-readable code for clients (403 <c>code</c>, <c>canRecordDosesReasonCode</c>); null when current.</summary>
    public string? Code => Status switch
    {
        MedicationCompetencyStatus.NotRecorded => MedicationCompetencyGate.CodeMissing,
        MedicationCompetencyStatus.Expired => MedicationCompetencyGate.CodeExpired,
        MedicationCompetencyStatus.Unverifiable => MedicationCompetencyGate.CodeUnverifiable,
        _ => null,
    };

    /// <summary>Plain-language reason for the worker; null when current.</summary>
    public string? Message => Status switch
    {
        MedicationCompetencyStatus.NotRecorded =>
            "You need a current Medication Competency credential to record medication doses. "
            + "Ask your coordinator to add it to your qualifications.",
        MedicationCompetencyStatus.Expired =>
            // Invariant culture: server-rendered text must not depend on the host's locale.
            $"Your Medication Competency expired on {ExpiredOn!.Value.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}. "
            + "Ask your coordinator to update your qualifications before you record medication doses.",
        MedicationCompetencyStatus.Unverifiable =>
            "We couldn't identify your staff account, so your Medication Competency can't be checked. "
            + "Sign in again, or ask your coordinator.",
        _ => null,
    };
}

/// <summary>
/// The Medication Competency gate (D3): recording ANY medication administration requires the recording
/// user to hold a current, unexpired Medication Competency credential. The credential lives on the staff
/// <see cref="User"/> (<see cref="User.IsMedicationCompetent"/> + <see cref="User.MedicationCompetencyExpiryDate"/>,
/// edited on the staff qualification forms) — the same two fields the roster's CREDENTIAL_EXPIRED warning and
/// <see cref="User.HasExpiredQualifications"/> read, so all three agree on what "expired" means.
///
/// Rules: the flag must be set; an expiry date, when recorded, must not be BEFORE the provider-local
/// "today" (the expiry date itself is the last valid day, matching the roster's <c>expiry &lt; date</c>
/// test); a ticked credential with NO expiry date recorded is treated as current, exactly as the roster
/// and <see cref="User.HasExpiredQualifications"/> already do. There is deliberately no role bypass: an
/// Admin, Coordinator or SuperAdmin recording a dose needs the credential like anyone else.
/// </summary>
public static class MedicationCompetencyGate
{
    /// <summary>What a worker sees (<c>canRecordDosesReason</c>) when the provider is in Warn mode and their credential is not current:
    /// they may record, and the record is flagged.</summary>
    public const string WarningMessage = "Medication Competency not current — this record will be flagged";

    public const string CodeMissing = "MEDICATION_COMPETENCY_MISSING";
    public const string CodeExpired = "MEDICATION_COMPETENCY_EXPIRED";
    public const string CodeUnverifiable = "MEDICATION_COMPETENCY_UNVERIFIABLE";

    /// <param name="user">The recording staff user, or null when none could be resolved.</param>
    /// <param name="providerToday">Today's date in the PROVIDER's time zone (not UTC).</param>
    public static MedicationCompetencyCheck Evaluate(User? user, DateOnly providerToday)
    {
        if (user is null) return new MedicationCompetencyCheck(MedicationCompetencyStatus.Unverifiable);
        if (!user.IsMedicationCompetent) return new MedicationCompetencyCheck(MedicationCompetencyStatus.NotRecorded);
        if (user.MedicationCompetencyExpiryDate is { } expiry && expiry < providerToday)
            return new MedicationCompetencyCheck(MedicationCompetencyStatus.Expired, expiry);
        return new MedicationCompetencyCheck(MedicationCompetencyStatus.Current);
    }
}
