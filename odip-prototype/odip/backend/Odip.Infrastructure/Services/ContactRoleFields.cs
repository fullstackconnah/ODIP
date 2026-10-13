using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Copies every role-specific field from either contact-role DTO onto the entity, then clears the fields its role type does not use
/// (<see cref="ContactRoleFieldRules"/>). Used by the contact-role routes, the participant create (ParticipantCreateService) and the import.
/// Moved from ParticipantContactRolesController so Infrastructure can reach it (Infrastructure cannot reference Odip.Api).
/// </summary>
public static class ContactRoleFields
{
    public static void Apply(ParticipantContactRole role, CreateParticipantContactRoleDto dto)
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

    /// <summary>The same for an update, whose DTO lacks the person-identifying fields.</summary>
    public static void Apply(ParticipantContactRole role, UpdateParticipantContactRoleDto dto)
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
}
