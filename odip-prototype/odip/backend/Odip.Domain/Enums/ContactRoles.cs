namespace Odip.Domain.Enums;

/// <summary>
/// CONTACT-01's 14 NDIS/disability-practice contact role types (see the research document cited
/// in <see cref="Entities.ParticipantContactRole"/>'s type doc, §2's numbered table). Deliberately
/// NOT the pre-existing <see cref="ContactType"/> (a flat, unused 8-value enum with no per-type
/// field set) — <see cref="ParticipantContactRole"/> is a new, separate model living alongside the
/// legacy <see cref="Entities.Contact"/>/<see cref="Entities.ParticipantContact"/> pair, which stays
/// wired to <c>Participant.PlanManagerContact</c>/<c>InvoiceService</c> untouched (see the
/// migration's doc comment for why a full cutover is out of scope here).
///
/// The research's item 4 ("Plan nominee") notes a confirmed NDIA sub-distinction between a "plan
/// nominee" (full authority) and a "correspondence nominee" (receive/act on correspondence only) —
/// modelled here as the single <see cref="PlanNominee"/> role type with the distinction captured by
/// <see cref="NomineeScope"/> on the role row, per the research's own second suggested option
/// ("one role with a nominee_scope enum"), rather than as two separate enum members — this keeps
/// the type set at exactly the researched 14 and matches CONTACT-02's gating text, which only ever
/// names "Plan Nominee" (never "Correspondence Nominee") as a distinct gate.
/// </summary>
public enum ContactRoleType
{
    NextOfKin = 0,
    EmergencyContact = 1,
    Guardian = 2,
    PlanNominee = 3,
    ChildRepresentative = 4,
    SupportCoordinator = 5,
    PlanManager = 6,
    Gp = 7,
    Specialist = 8,
    Pharmacy = 9,
    ProviderContact = 10,
    Advocate = 11,
    Interpreter = 12,
    Solicitor = 13,
}

/// <summary>See <see cref="ContactRoleType.PlanNominee"/>'s doc — captures which of the two NDIA
/// nominee sub-types a <see cref="ContactRoleType.PlanNominee"/> row represents. Null/unset for
/// every other role type.</summary>
public enum NomineeScope
{
    Plan = 0,
    Correspondence = 1,
}

/// <summary>Lifecycle status of a <see cref="Entities.ParticipantContactRole"/> row — independent
/// of <see cref="Entities.Person"/> (a person is never "expired", only a specific role they hold
/// can be). Research §5's <c>status</c> column.</summary>
public enum ContactRoleStatus
{
    Active = 0,
    Expired = 1,
    Superseded = 2,
}

/// <summary>
/// CONTACT-02's plan-management-type and age conditional rules (research §4's pseudocode),
/// implemented once here so both <see cref="Api.Controllers.ParticipantsController"/> (rows
/// submitted transactionally with a new participant) and
/// <see cref="Api.Controllers.ParticipantContactRolesController"/> (rows added afterwards via the
/// Contacts tab) validate identically — mirrors the "shared static validator" convention already
/// used for participant-level rules (see ParticipantsController.ValidateGender/
/// ValidateFundingSource/ValidateLivingArrangement).
/// </summary>
public static class ContactRoleRules
{
    /// <summary>
    /// Age in whole years as of <paramref name="asOf"/> (defaults to UTC today when omitted) — a
    /// participant with no recorded <see cref="Entities.Participant.DateOfBirth"/> has an unknown
    /// age, so every age-gated rule below treats a null age as "don't gate" (neither role is
    /// hidden/rejected) rather than guessing — conservative, matching this task's brief for the two
    /// explicitly flagged unverified research items (see below).
    /// </summary>
    public static int? CalculateAge(DateOnly? dateOfBirth, DateOnly? asOf = null)
    {
        if (dateOfBirth is not { } dob) return null;
        var today = asOf ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var age = today.Year - dob.Year;
        if (dob > today.AddYears(-age)) age--;
        return age;
    }

    /// <summary>
    /// CONTACT-02 server-side gate, mirrored by the frontend's INTAKE-07 conditional-visibility
    /// declarations for the wizard's Contacts step (form-local convenience only — this is the
    /// authority). Returns an error message when <paramref name="roleType"/> is not available for
    /// this participant, or null when it's fine to add.
    ///
    /// Research §4's rules implemented:
    ///  - PlanManager: only for PlanManaged participants.
    ///  - ProviderContact: AgencyManaged participants must flag the provider as registered
    ///    (unregistered providers aren't payable under agency management).
    ///  - PlanNominee: hidden/rejected once age is known to be under 18 (use ChildRepresentative).
    ///  - ChildRepresentative: not rejected once age is known to be 18+ (research: "becomes
    ///    read-only/historical" — a transition prompt, not a hard block) — so, deliberately, this
    ///    is NOT gated the same direction as PlanNominee; an 18+ participant may still legally have
    ///    a lingering ChildRepresentative record pending that transition.
    ///  - SupportCoordinator: explicitly NOT gated on plan-management type (research: "it's a
    ///    funded support category, independent of financial management model").
    ///  - Guardian: never gated — "independent of plan_management_type; always optional".
    ///
    /// Combination plan management is out of scope: this codebase's <see cref="PlanType"/> enum has
    /// no "Combination" member (SelfManaged/PlanManaged/AgencyManaged only) — research §6 flags
    /// combination (per-support-category management types) as
    /// <c>[unverified — domain knowledge]</c> and unresolved for MVP. Per this task's brief
    /// ("treat combination as allowing all types"), no gating rule below narrows availability for a
    /// combination scenario since there is no representable Combination value to gate on in the
    /// first place — every rule here is expressed purely in terms of the existing three PlanType
    /// values, which is already the most permissive reading available.
    /// </summary>
    public static string? Validate(ContactRoleType roleType, PlanType participantPlanType, DateOnly? participantDateOfBirth, bool? registeredProviderFlag)
    {
        if (roleType == ContactRoleType.PlanManager && participantPlanType != PlanType.PlanManaged)
            return "Plan Manager contacts are only available for plan-managed participants.";

        if (roleType == ContactRoleType.ProviderContact
            && participantPlanType == PlanType.AgencyManaged
            && registeredProviderFlag != true)
            return "Agency-managed participants can only record registered-provider contacts.";

        var age = CalculateAge(participantDateOfBirth);
        if (roleType == ContactRoleType.PlanNominee && age is < 18)
            return "Plan Nominee is not available for a participant under 18 — use Child Representative instead.";

        return null;
    }

    /// <summary>
    /// CONTACT-03 uniqueness rules (research §5: "role_type uniqueness constraints differ —
    /// enforce 'max 1 active plan_manager if plan_managed', ... but allow unlimited
    /// specialist/provider_contact rows"). Checked against the participant's OTHER active roles
    /// (the caller excludes the row being updated, if any, before calling this). Returns an error
    /// message, or null when adding/keeping <paramref name="roleType"/> (with the given
    /// <paramref name="isPrimary"/>) is fine.
    /// </summary>
    public static string? ValidateUniqueness(ContactRoleType roleType, bool isPrimary, ContactRoleStatus status, IEnumerable<(ContactRoleType RoleType, bool IsPrimary, ContactRoleStatus Status)> otherRolesForParticipant)
    {
        if (status != ContactRoleStatus.Active) return null;

        if (roleType == ContactRoleType.PlanManager
            && otherRolesForParticipant.Any(r => r.RoleType == ContactRoleType.PlanManager && r.Status == ContactRoleStatus.Active))
            return "This participant already has an active Plan Manager — end that role before adding another.";

        // Research §5: "one primary NoK" — a second, non-primary NextOfKin row is fine (the
        // research's own suggestion: "consider a 'secondary NOK' as a separate role").
        if (roleType == ContactRoleType.NextOfKin && isPrimary
            && otherRolesForParticipant.Any(r => r.RoleType == ContactRoleType.NextOfKin && r.IsPrimary && r.Status == ContactRoleStatus.Active))
            return "This participant already has a primary Next of Kin — unset the existing primary first.";

        return null;
    }
}
