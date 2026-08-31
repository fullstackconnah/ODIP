using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// CONTACT-01/02/03: one role a <see cref="Person"/> holds for one <see cref="Participant"/> —
/// the many-to-many join the research (§5) recommends over a single flat "contact type" row, so
/// that a person holding several roles (e.g. a parent who is both Next of Kin and Emergency
/// Contact, or a Guardian who is also the Plan Nominee — research: "the same person may be
/// appointed as both guardian and nominee") is stored once as a <see cref="Person"/> with N role
/// rows, rather than N duplicated contact-detail rows.
///
/// Role-specific fields (research §3.1-3.14) are flat nullable columns on this one table rather
/// than 14 per-type subtables — matches this codebase's existing convention for the same shape of
/// problem (compare <see cref="Participant"/>'s LIVING-02/03/04 per-arrangement-type flat columns,
/// only ever a few of which are populated for a given row depending on
/// <see cref="Participant.LivingArrangement"/>; here, depending on <see cref="RoleType"/>).
/// Only the columns relevant to the row's <see cref="RoleType"/> are expected to be populated —
/// enforcing that is a controller-level concern (see ParticipantContactRolesController), not a DB
/// constraint, mirroring ApplyLivingArrangementFields' server-side clearing pattern.
///
/// CONTACT-02's plan-management-type/age gating and CONTACT-03's uniqueness rules both live in
/// <see cref="ContactRoleRules"/>, shared by every write path (participant-creation-time rows and
/// the standalone nested CRUD alike).
/// </summary>
public class ParticipantContactRole : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public Guid PersonId { get; set; }
    public Person? Person { get; set; }

    public ContactRoleType RoleType { get; set; }

    // ── Common across most role types ──────────────────────────────────
    /// <summary>Free text (e.g. "Mother", "Father / Guardian") — Next of Kin, Guardian, Plan
    /// Nominee, Child Representative all use this per research §3.</summary>
    public string? RelationshipToParticipant { get; set; }

    /// <summary>Research §5: "is_primary (bool, for roles allowing multiple e.g. specialists,
    /// emergency contacts)". Also drives CONTACT-03's "one primary NoK" uniqueness rule.</summary>
    public bool IsPrimary { get; set; }

    /// <summary>Emergency Contact ranking (1st/2nd/3rd call) — research §3.2.</summary>
    public int? PriorityOrder { get; set; }
    /// <summary>Emergency Contact — research §3.2's "authorised to receive medical info" flag.</summary>
    public bool? AuthorisedForMedicalInfo { get; set; }

    // ── Guardian (research §3.3) ────────────────────────────────────────
    public string? AppointingTribunal { get; set; }
    /// <summary>Domain list (health/accommodation/lifestyle/legal/financial/plenary) the order
    /// covers — Postgres text[] column, same convention as Participant.MobilitySupportOptions.</summary>
    public List<string> OrderScopeDomains { get; set; } = new();
    public DateOnly? OrderStartDate { get; set; }
    /// <summary>
    /// [unverified — domain knowledge, research §3.3]: "most tribunal orders carry a mandatory
    /// review date; flag for re-verification workflow". Implemented conservatively per this task's
    /// brief — captured as plain data only, with NO default value and NO auto-flagging/expiry
    /// workflow built on top of it (unlike RestrictivePractice's reviewDate-driven "overdue"
    /// badge). A future pass can add that surfacing once the review-date requirement is confirmed
    /// against an authoritative source.
    /// </summary>
    public DateOnly? OrderReviewDate { get; set; }
    public DateOnly? OrderEndDate { get; set; }

    // ── Plan Nominee (research §3.4, and the sub-type note under §2 item 4) ─────
    public NomineeScope? NomineeScope { get; set; }
    public DateOnly? AppointmentDate { get; set; }
    public string? ReasonForAppointment { get; set; }

    // ── Child Representative (research §3.5) ────────────────────────────
    public string? AlternateRepresentativeName { get; set; }

    // ── Support Coordinator (§3.6) / Plan Manager (§3.7) ────────────────
    /// <summary>Support Coordinator only: Support Connection / Coordination of Supports /
    /// Specialist Support Coordination — free text rather than a closed enum, same "curated but
    /// not enforced" judgement call as Diagnoses (no Master Data Dictionary entry for this set).</summary>
    public string? FundingLineItemType { get; set; }
    /// <summary>Role-specific organisation name — distinct from Person.Organisation because the
    /// same person can hold different roles at different organisations over time (e.g. a GP's
    /// practice name, a Plan Manager's admin org, a Provider Contact's employer).</summary>
    public string? OrganisationName { get; set; }
    /// <summary>NDIS registration number (Support Coordinator/Provider Contact) or Medicare
    /// provider number (GP) — shared slot, research explicitly treats these as the same kind of
    /// "registration identifier" concept per role.</summary>
    public string? RegistrationNumber { get; set; }

    // ── GP (§3.8) ────────────────────────────────────────────────────────
    public DateOnly? LastVisitDate { get; set; }
    public bool? ConsentToShare { get; set; }

    // ── Specialist / allied health (§3.9) ────────────────────────────────
    public string? Discipline { get; set; }
    public string? FrequencyOfContact { get; set; }

    // ── Pharmacy (§3.10) ──────────────────────────────────────────────────
    public bool? WebsterPackFlag { get; set; }

    // ── Support worker / provider contact (§3.11) ────────────────────────
    public string? RoleTitle { get; set; }
    /// <summary>CONTACT-02 gate: must be true for every active ProviderContact row when the
    /// participant is Agency-managed (see ContactRoleRules.Validate).</summary>
    public bool? RegisteredProviderFlag { get; set; }

    // ── Advocate (§3.12) / Solicitor (§3.14) ──────────────────────────────
    /// <summary>Advocate's "scope of advocacy" (informal/formal) or Solicitor's "scope" — shared
    /// free-text slot, same reasoning as RegistrationNumber above.</summary>
    public string? ScopeNotes { get; set; }
    /// <summary>Advocate's authorisation document reference, or Solicitor's appointment authority
    /// (tribunal/court order reference) — shared slot.</summary>
    public string? AuthorisationDocumentReference { get; set; }

    // ── Interpreter / language support (§3.13) ────────────────────────────
    public string? PreferredLanguage { get; set; }

    // ── Lifecycle (shared) ─────────────────────────────────────────────
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public ContactRoleStatus Status { get; set; } = ContactRoleStatus.Active;
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
