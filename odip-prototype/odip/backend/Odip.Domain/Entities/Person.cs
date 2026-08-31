using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// CONTACT-01/CONTACT-03: a real human (or, for a couple of role types where an individual name
/// doesn't quite apply — e.g. a pharmacy — an org treated as one "person" record), holding contact
/// details independent of any particular role. Tenant-scoped and separate from
/// <see cref="Participant"/> identity, per CONTACT-01's brief ("Split Identity and Contacts").
///
/// A single Person can hold several <see cref="ParticipantContactRole"/> rows — for the same
/// participant (e.g. a parent who is both Next of Kin and Emergency Contact) or across different
/// participants (e.g. one Support Coordinator serving several participants) — see CONTACT-03's
/// model doc on <see cref="ParticipantContactRole"/> for the many-to-many shape and the
/// deduplicate-on-Person rationale (research §5).
///
/// Deliberately NOT the same as the pre-existing <see cref="Contact"/> entity: <see cref="Contact"/>
/// stays untouched, still backing <c>Participant.PlanManagerContact</c> and
/// <c>InvoiceService</c>'s bill-to logic (see the AddContactsModel migration's doc comment for why
/// a full cutover of that billing path is out of scope for this task).
/// </summary>
public class Person : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string FullName => $"{FirstName} {LastName}".Trim();

    public string? Phone { get; set; }
    public string? Mobile { get; set; }
    public string? Email { get; set; }

    // "Address-lite" per CONTACT-01's brief — a single free-text line plus AU
    // suburb/state/postcode, not the fuller structured breakdown INTAKE-06 gave the participant.
    public string? AddressLine { get; set; }
    public string? Suburb { get; set; }
    public string? State { get; set; }
    public string? Postcode { get; set; }

    public string? Organisation { get; set; }

    /// <summary>
    /// Optional — research §5 notes this "for verifying child-rep -> 18th-birthday transitions
    /// etc." (a person's own DOB, e.g. a guardian's, is occasionally relevant to eligibility
    /// checks distinct from the participant's own DOB used by CONTACT-02's age gating). Not
    /// required at entry.
    /// </summary>
    public DateOnly? DateOfBirth { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<ParticipantContactRole> ContactRoles { get; set; } = new List<ParticipantContactRole>();
}
