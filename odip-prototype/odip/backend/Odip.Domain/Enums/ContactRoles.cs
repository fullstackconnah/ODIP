using Odip.Domain.Entities;

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

    /// <summary>
    /// PF-10.2 (SPEC-05 <c>docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md</c>) —
    /// added additively (no renumbering of the existing 14 values). Profile V2026's contact block
    /// explicitly separates "Financial Administrator" from Guardian/Plan Nominee/Plan
    /// Manager/Solicitor, but this codebase's original <see cref="Solicitor"/> member had been
    /// mislabelled on the frontend as "Solicitor / Financial Administrator", bundling two distinct
    /// real-world roles under one enum member. This is additive-only: no existing
    /// <see cref="Solicitor"/> row is reclassified automatically — an operator retypes a row they
    /// know is actually a Financial Administrator via the existing Contacts tab edit form,
    /// post-deploy.
    /// </summary>
    FinancialAdministrator = 14,
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
    /// Age in whole years as of <paramref name="asOf"/> (defaults to the UTC date when omitted: a request handler passes the PROVIDER's date) — a
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
    public static string? Validate(ContactRoleType roleType, PlanType participantPlanType, DateOnly? participantDateOfBirth, bool? registeredProviderFlag, DateOnly? asOf = null)
    {
        if (roleType == ContactRoleType.PlanManager && participantPlanType != PlanType.PlanManaged)
            return "Plan Manager contacts are only available for plan-managed participants.";

        if (roleType == ContactRoleType.ProviderContact
            && participantPlanType == PlanType.AgencyManaged
            && registeredProviderFlag != true)
            return "Agency-managed participants can only record registered-provider contacts.";

        var age = CalculateAge(participantDateOfBirth, asOf);
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

    /// <summary>
    /// PF-2 (SPEC-02): advisory, non-blocking plan-type↔contact-role completeness check. Per the
    /// product owner's decision, this is warn-only in BOTH create and edit — it never throws and is
    /// never wired into <see cref="Validate"/>/<see cref="ValidateUniqueness"/> or any
    /// request-validation path; callers only use the returned string to populate
    /// <c>ParticipantDetailDto.PlanTypeComplianceWarning</c> for display. Evaluated purely against
    /// the participant's persisted, ACTIVE contact roles (never the submitted DTO), so create and
    /// edit compute the identical value from the identical source — see SPEC-02 PF-2's Design
    /// section for the full rationale.
    ///
    /// Table (PF-2):
    ///  - SelfManaged: no candidate field exists for this plan type — always null.
    ///  - PlanManaged: warns when there is no active PlanManager role.
    ///  - AgencyManaged: warns when there is no active ProviderContact role with
    ///    RegisteredProviderFlag == true — "agency details" ARE ProviderContact's own
    ///    OrganisationName/RoleTitle/RegistrationNumber/RegisteredProviderFlag fields; no new
    ///    entity/columns are needed for this rule.
    /// </summary>
    public static string? PlanTypeComplianceWarning(
        PlanType planType,
        IEnumerable<(ContactRoleType RoleType, bool? RegisteredProviderFlag, ContactRoleStatus Status)> activeRoles)
    {
        // Defensive: callers are expected to pre-filter to Active rows, but a caller passing the
        // participant's full role history through unfiltered must not produce a false "satisfied"
        // reading from an Expired/Superseded row.
        var active = activeRoles.Where(r => r.Status == ContactRoleStatus.Active);

        return planType switch
        {
            PlanType.PlanManaged when !active.Any(r => r.RoleType == ContactRoleType.PlanManager)
                => "This plan-managed participant has no active Plan Manager contact recorded.",
            PlanType.AgencyManaged when !active.Any(r => r.RoleType == ContactRoleType.ProviderContact && r.RegisteredProviderFlag == true)
                => "This agency-managed participant has no active registered-provider contact with agency details recorded.",
            _ => null,
        };
    }
}

/// <summary>
/// Fix-round finding 2: per-<see cref="ContactRoleType"/> field relevance, mirroring the
/// frontend's CONTACT_ROLE_FIELD_MAP (frontend/src/api/types/contacts.ts) that drives the
/// add/edit modal's showField visibility (ContactsTab.tsx / ParticipantCreatePage.tsx's Contacts
/// step) — same "one authoritative source, co-documented across the TS/C# boundary" convention
/// already used for <see cref="ContactRoleRules.Validate"/>/the frontend's contactRoleGateError.
/// Keep this map in sync with CONTACT_ROLE_FIELD_MAP by hand — there is no shared codegen source
/// between the two runtimes; a future pass could add one, out of scope here.
/// <see cref="Entities.ParticipantContactRole.RelationshipToParticipant"/>/IsPrimary/Status/Notes
/// (plus the person-identifying and lifecycle-bookkeeping columns) are never cleared — they're
/// valid input for every role type, matching CONTACT_ROLE_FIELD_MAP's own comment that
/// "relationshipToParticipant/notes are offered for every role and aren't listed per-entry".
/// </summary>
public static class ContactRoleFieldRules
{
    private static readonly HashSet<string> NoExtraFields = new();

    private static readonly IReadOnlyDictionary<ContactRoleType, HashSet<string>> RelevantFields = new Dictionary<ContactRoleType, HashSet<string>>
    {
        [ContactRoleType.NextOfKin] = NoExtraFields,
        [ContactRoleType.EmergencyContact] = new() { nameof(ParticipantContactRole.PriorityOrder), nameof(ParticipantContactRole.AuthorisedForMedicalInfo) },
        [ContactRoleType.Guardian] = new()
        {
            nameof(ParticipantContactRole.AppointingTribunal), nameof(ParticipantContactRole.OrderScopeDomains),
            nameof(ParticipantContactRole.OrderStartDate), nameof(ParticipantContactRole.OrderReviewDate), nameof(ParticipantContactRole.OrderEndDate),
        },
        [ContactRoleType.PlanNominee] = new() { nameof(ParticipantContactRole.NomineeScope), nameof(ParticipantContactRole.AppointmentDate), nameof(ParticipantContactRole.ReasonForAppointment) },
        [ContactRoleType.ChildRepresentative] = new() { nameof(ParticipantContactRole.AlternateRepresentativeName) },
        [ContactRoleType.SupportCoordinator] = new()
        {
            nameof(ParticipantContactRole.OrganisationName), nameof(ParticipantContactRole.FundingLineItemType),
            nameof(ParticipantContactRole.RegistrationNumber), nameof(ParticipantContactRole.StartDate), nameof(ParticipantContactRole.EndDate),
        },
        [ContactRoleType.PlanManager] = new() { nameof(ParticipantContactRole.OrganisationName), nameof(ParticipantContactRole.StartDate), nameof(ParticipantContactRole.EndDate) },
        [ContactRoleType.Gp] = new()
        {
            nameof(ParticipantContactRole.OrganisationName), nameof(ParticipantContactRole.RegistrationNumber),
            nameof(ParticipantContactRole.LastVisitDate), nameof(ParticipantContactRole.ConsentToShare),
        },
        [ContactRoleType.Specialist] = new() { nameof(ParticipantContactRole.Discipline), nameof(ParticipantContactRole.OrganisationName), nameof(ParticipantContactRole.FrequencyOfContact) },
        [ContactRoleType.Pharmacy] = new() { nameof(ParticipantContactRole.OrganisationName), nameof(ParticipantContactRole.WebsterPackFlag) },
        [ContactRoleType.ProviderContact] = new()
        {
            nameof(ParticipantContactRole.OrganisationName), nameof(ParticipantContactRole.RoleTitle),
            nameof(ParticipantContactRole.RegisteredProviderFlag), nameof(ParticipantContactRole.RegistrationNumber),
        },
        [ContactRoleType.Advocate] = new() { nameof(ParticipantContactRole.OrganisationName), nameof(ParticipantContactRole.ScopeNotes), nameof(ParticipantContactRole.AuthorisationDocumentReference) },
        [ContactRoleType.Interpreter] = new() { nameof(ParticipantContactRole.PreferredLanguage), nameof(ParticipantContactRole.OrganisationName) },
        [ContactRoleType.Solicitor] = new() { nameof(ParticipantContactRole.OrganisationName), nameof(ParticipantContactRole.ScopeNotes), nameof(ParticipantContactRole.AuthorisationDocumentReference) },
        // PF-10.2: same field shape as Solicitor — both are professional/authority contacts that
        // record an organisation, a scope-of-authority note, and a supporting document reference.
        [ContactRoleType.FinancialAdministrator] = new() { nameof(ParticipantContactRole.OrganisationName), nameof(ParticipantContactRole.ScopeNotes), nameof(ParticipantContactRole.AuthorisationDocumentReference) },
    };

    /// <summary>
    /// Server-side clearing mirroring <c>ParticipantsController.ApplyLivingArrangementFields</c>
    /// (per the entity's own type doc) — nulls every role-specific field NOT relevant to
    /// <paramref name="role"/>'s CURRENT RoleType, regardless of what a stale payload (e.g. a
    /// client that switched RoleType without re-fetching the form) carried for that field. Call
    /// this AFTER copying every DTO field onto the entity (see
    /// ParticipantContactRolesController.ApplyRoleFields), so it clears against the
    /// just-assigned RoleType — a Guardian -> NextOfKin RoleType change on Update nulls
    /// AppointingTribunal/OrderScopeDomains/OrderStartDate/OrderReviewDate/OrderEndDate; the
    /// reverse direction (NextOfKin -> Guardian) leaves those fields exactly as the incoming DTO
    /// set them, since NextOfKin's own set has nothing to clear.
    /// </summary>
    public static void ClearIrrelevantFields(ParticipantContactRole role)
    {
        var relevant = RelevantFields.TryGetValue(role.RoleType, out var set) ? set : NoExtraFields;

        if (!relevant.Contains(nameof(role.PriorityOrder))) role.PriorityOrder = null;
        if (!relevant.Contains(nameof(role.AuthorisedForMedicalInfo))) role.AuthorisedForMedicalInfo = null;
        if (!relevant.Contains(nameof(role.AppointingTribunal))) role.AppointingTribunal = null;
        if (!relevant.Contains(nameof(role.OrderScopeDomains))) role.OrderScopeDomains = new();
        if (!relevant.Contains(nameof(role.OrderStartDate))) role.OrderStartDate = null;
        if (!relevant.Contains(nameof(role.OrderReviewDate))) role.OrderReviewDate = null;
        if (!relevant.Contains(nameof(role.OrderEndDate))) role.OrderEndDate = null;
        if (!relevant.Contains(nameof(role.NomineeScope))) role.NomineeScope = null;
        if (!relevant.Contains(nameof(role.AppointmentDate))) role.AppointmentDate = null;
        if (!relevant.Contains(nameof(role.ReasonForAppointment))) role.ReasonForAppointment = null;
        if (!relevant.Contains(nameof(role.AlternateRepresentativeName))) role.AlternateRepresentativeName = null;
        if (!relevant.Contains(nameof(role.FundingLineItemType))) role.FundingLineItemType = null;
        if (!relevant.Contains(nameof(role.OrganisationName))) role.OrganisationName = null;
        if (!relevant.Contains(nameof(role.RegistrationNumber))) role.RegistrationNumber = null;
        if (!relevant.Contains(nameof(role.LastVisitDate))) role.LastVisitDate = null;
        if (!relevant.Contains(nameof(role.ConsentToShare))) role.ConsentToShare = null;
        if (!relevant.Contains(nameof(role.Discipline))) role.Discipline = null;
        if (!relevant.Contains(nameof(role.FrequencyOfContact))) role.FrequencyOfContact = null;
        if (!relevant.Contains(nameof(role.WebsterPackFlag))) role.WebsterPackFlag = null;
        if (!relevant.Contains(nameof(role.RoleTitle))) role.RoleTitle = null;
        if (!relevant.Contains(nameof(role.RegisteredProviderFlag))) role.RegisteredProviderFlag = null;
        if (!relevant.Contains(nameof(role.ScopeNotes))) role.ScopeNotes = null;
        if (!relevant.Contains(nameof(role.AuthorisationDocumentReference))) role.AuthorisationDocumentReference = null;
        if (!relevant.Contains(nameof(role.PreferredLanguage))) role.PreferredLanguage = null;
        if (!relevant.Contains(nameof(role.StartDate))) role.StartDate = null;
        if (!relevant.Contains(nameof(role.EndDate))) role.EndDate = null;
    }
}
