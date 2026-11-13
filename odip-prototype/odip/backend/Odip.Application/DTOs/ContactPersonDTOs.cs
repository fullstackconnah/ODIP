using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;
namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// CONTACT DTOs
// ══════════════════════════════════════════════════════════════

public record ContactDto
{
    public Guid Id { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string? RoleRelationship { get; init; }
    public string? Organisation { get; init; }
    public string? Email { get; init; }
    public string? Mobile { get; init; }
    public string? Phone { get; init; }
    public PreferredContactMethod PreferredContactMethod { get; init; }
}

// ══════════════════════════════════════════════════════════════
// PERSON / PARTICIPANT CONTACT ROLE DTOs (CONTACT-01/02/03)
// ══════════════════════════════════════════════════════════════

public record PersonDto
{
    public Guid Id { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string? Phone { get; init; }
    public string? Mobile { get; init; }
    public string? Email { get; init; }
    public string? AddressLine { get; init; }
    public string? Suburb { get; init; }
    public string? State { get; init; }
    public string? Postcode { get; init; }
    public string? Organisation { get; init; }
    public DateOnly? DateOfBirth { get; init; }
    public string? Notes { get; init; }
    /// <summary>Count of active contact roles this person currently holds (any participant) — a
    /// quick "already in use" signal for the SearchableSelect person picker.</summary>
    public int ActiveRoleCount { get; init; }
}

public record CreatePersonDto
{
    [StringLength(100)]
    public string FirstName { get; init; } = string.Empty;
    [StringLength(100)]
    public string LastName { get; init; } = string.Empty;
    [StringLength(30)]
    public string? Phone { get; init; }
    [StringLength(30)]
    public string? Mobile { get; init; }
    [StringLength(200)]
    public string? Email { get; init; }
    [StringLength(200)]
    public string? AddressLine { get; init; }
    [StringLength(100)]
    public string? Suburb { get; init; }
    [StringLength(10)]
    public string? State { get; init; }
    [StringLength(4)]
    public string? Postcode { get; init; }
    [StringLength(200)]
    public string? Organisation { get; init; }
    public DateOnly? DateOfBirth { get; init; }
    [StringLength(2000)]
    public string? Notes { get; init; }
}

public record UpdatePersonDto : CreatePersonDto;

/// <summary>
/// Shape shared by every ParticipantContactRole write path: the nested-CRUD create endpoint
/// (ParticipantContactRolesController), the standalone update endpoint (person fields below are
/// ignored on update — see UpdateParticipantContactRoleDto), and the rows submitted transactionally
/// with a brand-new participant (CreateParticipantDto.ContactRoles). Exactly one of
/// <see cref="PersonId"/> or the <c>NewPerson*</c> fields is expected to be populated, mirroring
/// CONTACT-03's "existing person vs new person" add-contact UI choice.
/// </summary>
public record CreateParticipantContactRoleDto
{
    /// <summary>Set when adding a role to an already-known Person (CONTACT-03's "existing
    /// person" path). Null when the NewPerson* fields below should create one inline instead.</summary>
    public Guid? PersonId { get; init; }
    [StringLength(100)]
    public string? NewPersonFirstName { get; init; }
    [StringLength(100)]
    public string? NewPersonLastName { get; init; }
    [StringLength(30)]
    public string? NewPersonPhone { get; init; }
    [StringLength(30)]
    public string? NewPersonMobile { get; init; }
    [StringLength(200)]
    public string? NewPersonEmail { get; init; }
    [StringLength(200)]
    public string? NewPersonOrganisation { get; init; }
    /// <summary>PF-6 (SPEC-02): the rest of CreatePersonDto's optional fields, so a genuinely new
    /// person can be captured with more than just a name/phone/email/org on first add.</summary>
    [StringLength(200)]
    public string? NewPersonAddressLine { get; init; }
    [StringLength(100)]
    public string? NewPersonSuburb { get; init; }
    [StringLength(10)]
    public string? NewPersonState { get; init; }
    [StringLength(4)]
    public string? NewPersonPostcode { get; init; }
    public DateOnly? NewPersonDateOfBirth { get; init; }

    public ContactRoleType RoleType { get; init; }
    [StringLength(100)]
    public string? RelationshipToParticipant { get; init; }
    public bool IsPrimary { get; init; }
    public int? PriorityOrder { get; init; }
    public bool? AuthorisedForMedicalInfo { get; init; }
    [StringLength(50)]
    public string? AppointingTribunal { get; init; }
    public List<string> OrderScopeDomains { get; init; } = new();
    public DateOnly? OrderStartDate { get; init; }
    public DateOnly? OrderReviewDate { get; init; }
    public DateOnly? OrderEndDate { get; init; }
    public NomineeScope? NomineeScope { get; init; }
    public DateOnly? AppointmentDate { get; init; }
    [StringLength(500)]
    public string? ReasonForAppointment { get; init; }
    [StringLength(200)]
    public string? AlternateRepresentativeName { get; init; }
    [StringLength(100)]
    public string? FundingLineItemType { get; init; }
    [StringLength(200)]
    public string? OrganisationName { get; init; }
    [StringLength(100)]
    public string? RegistrationNumber { get; init; }
    public DateOnly? LastVisitDate { get; init; }
    public bool? ConsentToShare { get; init; }
    [StringLength(100)]
    public string? Discipline { get; init; }
    [StringLength(200)]
    public string? FrequencyOfContact { get; init; }
    public bool? WebsterPackFlag { get; init; }
    [StringLength(100)]
    public string? RoleTitle { get; init; }
    public bool? RegisteredProviderFlag { get; init; }
    [StringLength(500)]
    public string? ScopeNotes { get; init; }
    [StringLength(200)]
    public string? AuthorisationDocumentReference { get; init; }
    [StringLength(100)]
    public string? PreferredLanguage { get; init; }
    public DateOnly? StartDate { get; init; }
    public DateOnly? EndDate { get; init; }
    public ContactRoleStatus Status { get; init; } = ContactRoleStatus.Active;
    [StringLength(2000)]
    public string? Notes { get; init; }
}

/// <summary>
/// Same role-specific field set as <see cref="CreateParticipantContactRoleDto"/>, minus the
/// person-identifying fields — CONTACT-03: "adding a role to an existing person reuses their
/// Person row", and a role's Person is likewise fixed after creation (edit the Person's own
/// details via PersonsController instead).
/// </summary>
public record UpdateParticipantContactRoleDto
{
    public ContactRoleType RoleType { get; init; }
    [StringLength(100)]
    public string? RelationshipToParticipant { get; init; }
    public bool IsPrimary { get; init; }
    public int? PriorityOrder { get; init; }
    public bool? AuthorisedForMedicalInfo { get; init; }
    [StringLength(50)]
    public string? AppointingTribunal { get; init; }
    public List<string> OrderScopeDomains { get; init; } = new();
    public DateOnly? OrderStartDate { get; init; }
    public DateOnly? OrderReviewDate { get; init; }
    public DateOnly? OrderEndDate { get; init; }
    public NomineeScope? NomineeScope { get; init; }
    public DateOnly? AppointmentDate { get; init; }
    [StringLength(500)]
    public string? ReasonForAppointment { get; init; }
    [StringLength(200)]
    public string? AlternateRepresentativeName { get; init; }
    [StringLength(100)]
    public string? FundingLineItemType { get; init; }
    [StringLength(200)]
    public string? OrganisationName { get; init; }
    [StringLength(100)]
    public string? RegistrationNumber { get; init; }
    public DateOnly? LastVisitDate { get; init; }
    public bool? ConsentToShare { get; init; }
    [StringLength(100)]
    public string? Discipline { get; init; }
    [StringLength(200)]
    public string? FrequencyOfContact { get; init; }
    public bool? WebsterPackFlag { get; init; }
    [StringLength(100)]
    public string? RoleTitle { get; init; }
    public bool? RegisteredProviderFlag { get; init; }
    [StringLength(500)]
    public string? ScopeNotes { get; init; }
    [StringLength(200)]
    public string? AuthorisationDocumentReference { get; init; }
    [StringLength(100)]
    public string? PreferredLanguage { get; init; }
    public DateOnly? StartDate { get; init; }
    public DateOnly? EndDate { get; init; }
    public ContactRoleStatus Status { get; init; } = ContactRoleStatus.Active;
    [StringLength(2000)]
    public string? Notes { get; init; }
}

public record ParticipantContactRoleDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public Guid PersonId { get; init; }
    public string PersonFullName { get; init; } = string.Empty;
    public string? PersonPhone { get; init; }
    public string? PersonMobile { get; init; }
    public string? PersonEmail { get; init; }
    public string? PersonOrganisation { get; init; }
    public ContactRoleType RoleType { get; init; }
    public string? RelationshipToParticipant { get; init; }
    public bool IsPrimary { get; init; }
    public int? PriorityOrder { get; init; }
    public bool? AuthorisedForMedicalInfo { get; init; }
    public string? AppointingTribunal { get; init; }
    public List<string> OrderScopeDomains { get; init; } = new();
    public DateOnly? OrderStartDate { get; init; }
    public DateOnly? OrderReviewDate { get; init; }
    public DateOnly? OrderEndDate { get; init; }
    public NomineeScope? NomineeScope { get; init; }
    public DateOnly? AppointmentDate { get; init; }
    public string? ReasonForAppointment { get; init; }
    public string? AlternateRepresentativeName { get; init; }
    public string? FundingLineItemType { get; init; }
    public string? OrganisationName { get; init; }
    public string? RegistrationNumber { get; init; }
    public DateOnly? LastVisitDate { get; init; }
    public bool? ConsentToShare { get; init; }
    public string? Discipline { get; init; }
    public string? FrequencyOfContact { get; init; }
    public bool? WebsterPackFlag { get; init; }
    public string? RoleTitle { get; init; }
    public bool? RegisteredProviderFlag { get; init; }
    public string? ScopeNotes { get; init; }
    public string? AuthorisationDocumentReference { get; init; }
    public string? PreferredLanguage { get; init; }
    public DateOnly? StartDate { get; init; }
    public DateOnly? EndDate { get; init; }
    public ContactRoleStatus Status { get; init; }
    public string? Notes { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}
