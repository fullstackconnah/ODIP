using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// CONTACT-01/02/03 — nested CRUD for a participant's typed contact roles, the write path for the
/// Contacts detail tab (this controller) once a participant already exists. A brand-new
/// participant's initial contact rows are instead created transactionally via
/// <see cref="ParticipantsController.Create"/> (<see cref="CreateParticipantDto.ContactRoles"/>) —
/// same split as <see cref="ParticipantRiskEntriesController"/>/RiskEntries.
///
/// Route shape mirrors <see cref="ParticipantRiskEntriesController"/>: list/create nested under
/// <c>participants/{participantId}/contact-roles</c>, update/delete flat under
/// <c>participants/contact-roles/{id}</c> (a role row's id is already globally unique, so the
/// participant segment isn't needed to address it).
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class ParticipantContactRolesController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ParticipantContactRolesController(OdipDbContext db) => _db = db;

    [HttpGet("participants/{participantId:guid}/contact-roles")]
    public async Task<ActionResult<ApiResponse<List<ParticipantContactRoleDto>>>> GetForParticipant(
        Guid participantId, CancellationToken ct)
    {
        var roles = await _db.ParticipantContactRoles
            .Include(r => r.Person)
            .Where(r => r.ParticipantId == participantId)
            .OrderBy(r => r.RoleType).ThenByDescending(r => r.CreatedAt)
            .ToListAsync(ct);

        return Ok(ApiResponse<List<ParticipantContactRoleDto>>.Ok(roles.Select(ToDto).ToList()));
    }

    [HttpPost("participants/{participantId:guid}/contact-roles")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantContactRoleDto>>> Create(
        Guid participantId, [FromBody] CreateParticipantContactRoleDto dto, CancellationToken ct)
    {
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == participantId, ct);
        if (participant == null) return NotFound(ApiResponse<ParticipantContactRoleDto>.Fail("Participant not found"));

        var gateError = ContactRoleRules.Validate(dto.RoleType, participant.PlanType, participant.DateOfBirth, dto.RegisteredProviderFlag);
        if (gateError != null) return BadRequest(ApiResponse<ParticipantContactRoleDto>.Fail(gateError));

        var existingRoles = await _db.ParticipantContactRoles
            .Where(r => r.ParticipantId == participantId)
            .Select(r => new { r.RoleType, r.IsPrimary, r.Status })
            .ToListAsync(ct);
        var uniquenessError = ContactRoleRules.ValidateUniqueness(
            dto.RoleType, dto.IsPrimary, dto.Status,
            existingRoles.Select(r => (r.RoleType, r.IsPrimary, r.Status)));
        if (uniquenessError != null) return BadRequest(ApiResponse<ParticipantContactRoleDto>.Fail(uniquenessError));

        Person person;
        if (dto.PersonId.HasValue)
        {
            var existing = await _db.People.FirstOrDefaultAsync(p => p.Id == dto.PersonId.Value, ct);
            if (existing == null) return BadRequest(ApiResponse<ParticipantContactRoleDto>.Fail("Selected person not found"));
            person = existing;
        }
        else
        {
            var nameError = PersonsController.ValidateName(dto.NewPersonFirstName ?? "", dto.NewPersonLastName ?? "");
            if (nameError != null) return BadRequest(ApiResponse<ParticipantContactRoleDto>.Fail(nameError));
            person = new Person
            {
                Id = Guid.NewGuid(),
                FirstName = (dto.NewPersonFirstName ?? "").Trim(), LastName = (dto.NewPersonLastName ?? "").Trim(),
                Phone = dto.NewPersonPhone, Mobile = dto.NewPersonMobile, Email = dto.NewPersonEmail,
                Organisation = dto.NewPersonOrganisation,
            };
            _db.People.Add(person);
        }

        var role = new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = participantId, PersonId = person.Id, Person = person };
        ApplyRoleFields(role, dto);
        _db.ParticipantContactRoles.Add(role);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantContactRoleDto>.Ok(ToDto(role)));
    }

    [HttpPut("participants/contact-roles/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantContactRoleDto>>> Update(
        Guid id, [FromBody] UpdateParticipantContactRoleDto dto, CancellationToken ct)
    {
        var role = await _db.ParticipantContactRoles.Include(r => r.Person).FirstOrDefaultAsync(r => r.Id == id, ct);
        if (role == null) return NotFound(ApiResponse<ParticipantContactRoleDto>.Fail("Contact role not found"));

        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == role.ParticipantId, ct);
        if (participant == null) return NotFound(ApiResponse<ParticipantContactRoleDto>.Fail("Participant not found"));

        var gateError = ContactRoleRules.Validate(dto.RoleType, participant.PlanType, participant.DateOfBirth, dto.RegisteredProviderFlag);
        if (gateError != null) return BadRequest(ApiResponse<ParticipantContactRoleDto>.Fail(gateError));

        var otherRoles = await _db.ParticipantContactRoles
            .Where(r => r.ParticipantId == role.ParticipantId && r.Id != id)
            .Select(r => new { r.RoleType, r.IsPrimary, r.Status })
            .ToListAsync(ct);
        var uniquenessError = ContactRoleRules.ValidateUniqueness(
            dto.RoleType, dto.IsPrimary, dto.Status,
            otherRoles.Select(r => (r.RoleType, r.IsPrimary, r.Status)));
        if (uniquenessError != null) return BadRequest(ApiResponse<ParticipantContactRoleDto>.Fail(uniquenessError));

        ApplyRoleFields(role, dto);
        role.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantContactRoleDto>.Ok(ToDto(role)));
    }

    [HttpDelete("participants/contact-roles/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var role = await _db.ParticipantContactRoles.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (role == null) return NotFound(ApiResponse<bool>.Fail("Contact role not found"));

        // Hard-delete, same idiom as ParticipantRiskEntriesController — a role assignment is not
        // itself a compliance record (unlike RestrictivePractice, which archives via IsActive);
        // the underlying Person row is untouched and stays available for other roles/participants.
        _db.ParticipantContactRoles.Remove(role);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<bool>.Ok(true));
    }

    // ── Helpers ────────────────────────────────────────────────────

    /// <summary>Applies every role-specific field from either DTO shape (Create/Update share the
    /// same field set past the person-identifying fields) onto the entity — used by Create, Update,
    /// and (see ParticipantsController.Create) the wizard-transactional path. Finishes by clearing
    /// every field <see cref="ContactRoleFieldRules"/> says isn't relevant to the row's (just-set)
    /// RoleType — see that type's doc for why (fix-round finding 2).</summary>
    internal static void ApplyRoleFields(ParticipantContactRole role, CreateParticipantContactRoleDto dto)
    {
        role.RoleType = dto.RoleType;
        role.RelationshipToParticipant = dto.RelationshipToParticipant;
        role.IsPrimary = dto.IsPrimary;
        role.PriorityOrder = dto.PriorityOrder;
        role.AuthorisedForMedicalInfo = dto.AuthorisedForMedicalInfo;
        role.AppointingTribunal = dto.AppointingTribunal;
        role.OrderScopeDomains = dto.OrderScopeDomains;
        role.OrderStartDate = dto.OrderStartDate;
        role.OrderReviewDate = dto.OrderReviewDate;
        role.OrderEndDate = dto.OrderEndDate;
        role.NomineeScope = dto.NomineeScope;
        role.AppointmentDate = dto.AppointmentDate;
        role.ReasonForAppointment = dto.ReasonForAppointment;
        role.AlternateRepresentativeName = dto.AlternateRepresentativeName;
        role.FundingLineItemType = dto.FundingLineItemType;
        role.OrganisationName = dto.OrganisationName;
        role.RegistrationNumber = dto.RegistrationNumber;
        role.LastVisitDate = dto.LastVisitDate;
        role.ConsentToShare = dto.ConsentToShare;
        role.Discipline = dto.Discipline;
        role.FrequencyOfContact = dto.FrequencyOfContact;
        role.WebsterPackFlag = dto.WebsterPackFlag;
        role.RoleTitle = dto.RoleTitle;
        role.RegisteredProviderFlag = dto.RegisteredProviderFlag;
        role.ScopeNotes = dto.ScopeNotes;
        role.AuthorisationDocumentReference = dto.AuthorisationDocumentReference;
        role.PreferredLanguage = dto.PreferredLanguage;
        role.StartDate = dto.StartDate;
        role.EndDate = dto.EndDate;
        role.Status = dto.Status;
        role.Notes = dto.Notes;
        ContactRoleFieldRules.ClearIrrelevantFields(role);
    }

    /// <summary>Overload for <see cref="UpdateParticipantContactRoleDto"/>, which carries the same
    /// field set minus the person-identifying fields Create's DTO also has.</summary>
    internal static void ApplyRoleFields(ParticipantContactRole role, UpdateParticipantContactRoleDto dto)
    {
        role.RoleType = dto.RoleType;
        role.RelationshipToParticipant = dto.RelationshipToParticipant;
        role.IsPrimary = dto.IsPrimary;
        role.PriorityOrder = dto.PriorityOrder;
        role.AuthorisedForMedicalInfo = dto.AuthorisedForMedicalInfo;
        role.AppointingTribunal = dto.AppointingTribunal;
        role.OrderScopeDomains = dto.OrderScopeDomains;
        role.OrderStartDate = dto.OrderStartDate;
        role.OrderReviewDate = dto.OrderReviewDate;
        role.OrderEndDate = dto.OrderEndDate;
        role.NomineeScope = dto.NomineeScope;
        role.AppointmentDate = dto.AppointmentDate;
        role.ReasonForAppointment = dto.ReasonForAppointment;
        role.AlternateRepresentativeName = dto.AlternateRepresentativeName;
        role.FundingLineItemType = dto.FundingLineItemType;
        role.OrganisationName = dto.OrganisationName;
        role.RegistrationNumber = dto.RegistrationNumber;
        role.LastVisitDate = dto.LastVisitDate;
        role.ConsentToShare = dto.ConsentToShare;
        role.Discipline = dto.Discipline;
        role.FrequencyOfContact = dto.FrequencyOfContact;
        role.WebsterPackFlag = dto.WebsterPackFlag;
        role.RoleTitle = dto.RoleTitle;
        role.RegisteredProviderFlag = dto.RegisteredProviderFlag;
        role.ScopeNotes = dto.ScopeNotes;
        role.AuthorisationDocumentReference = dto.AuthorisationDocumentReference;
        role.PreferredLanguage = dto.PreferredLanguage;
        role.StartDate = dto.StartDate;
        role.EndDate = dto.EndDate;
        role.Status = dto.Status;
        role.Notes = dto.Notes;
        ContactRoleFieldRules.ClearIrrelevantFields(role);
    }

    internal static ParticipantContactRoleDto ToDto(ParticipantContactRole r) => new()
    {
        Id = r.Id, ParticipantId = r.ParticipantId, PersonId = r.PersonId,
        PersonFullName = r.Person?.FullName ?? string.Empty,
        PersonPhone = r.Person?.Phone, PersonMobile = r.Person?.Mobile, PersonEmail = r.Person?.Email,
        PersonOrganisation = r.Person?.Organisation,
        RoleType = r.RoleType, RelationshipToParticipant = r.RelationshipToParticipant,
        IsPrimary = r.IsPrimary, PriorityOrder = r.PriorityOrder, AuthorisedForMedicalInfo = r.AuthorisedForMedicalInfo,
        AppointingTribunal = r.AppointingTribunal, OrderScopeDomains = r.OrderScopeDomains,
        OrderStartDate = r.OrderStartDate, OrderReviewDate = r.OrderReviewDate, OrderEndDate = r.OrderEndDate,
        NomineeScope = r.NomineeScope, AppointmentDate = r.AppointmentDate, ReasonForAppointment = r.ReasonForAppointment,
        AlternateRepresentativeName = r.AlternateRepresentativeName, FundingLineItemType = r.FundingLineItemType,
        OrganisationName = r.OrganisationName, RegistrationNumber = r.RegistrationNumber,
        LastVisitDate = r.LastVisitDate, ConsentToShare = r.ConsentToShare, Discipline = r.Discipline,
        FrequencyOfContact = r.FrequencyOfContact, WebsterPackFlag = r.WebsterPackFlag, RoleTitle = r.RoleTitle,
        RegisteredProviderFlag = r.RegisteredProviderFlag, ScopeNotes = r.ScopeNotes,
        AuthorisationDocumentReference = r.AuthorisationDocumentReference, PreferredLanguage = r.PreferredLanguage,
        StartDate = r.StartDate, EndDate = r.EndDate, Status = r.Status, Notes = r.Notes,
        CreatedAt = r.CreatedAt, UpdatedAt = r.UpdatedAt,
    };
}
