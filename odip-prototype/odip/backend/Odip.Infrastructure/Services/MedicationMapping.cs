using Odip.Application.DTOs;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Medication DTO mapping shared by the controllers and <see cref="MedicationAdministrationRecorder"/>
/// (moved out of <c>MedicationsController</c> unchanged so the recorder can return the same
/// <see cref="AdministrationDto"/> the endpoints always have).
/// </summary>
public static class MedicationMapping
{
    /// <summary>Preferred name when set, else first name, then last name — the MAR's participant label.</summary>
    public static string ParticipantName(Participant? p) =>
        p == null ? string.Empty
        : string.IsNullOrEmpty(p.PreferredName) ? p.FirstName + " " + p.LastName : p.PreferredName + " " + p.LastName;

    public static AdministrationDto ToAdministrationDto(
        MedicationAdministration a, string participantName, string medicationName, string doseDescription, Guid? incidentId = null) => new()
    {
        Id = a.Id,
        ParticipantMedicationId = a.ParticipantMedicationId,
        ParticipantId = a.ParticipantId,
        ParticipantName = participantName,
        MedicationName = medicationName,
        DoseDescription = doseDescription,
        TripInstanceId = a.TripInstanceId,
        ScheduledAt = a.ScheduledAt,
        AdministeredAt = a.AdministeredAt,
        AdministeredAtTimeZone = a.AdministeredAtTimeZone,
        Status = a.Status,
        DoseGiven = a.DoseGiven,
        RecordedByName = a.RecordedByName,
        RecordedByUserId = a.RecordedByUserId,
        WitnessName = a.WitnessName,
        WitnessStaffId = a.WitnessUserId,
        WitnessStatus = a.WitnessStatus,
        WitnessRequestedAt = a.WitnessRequestedAt,
        WitnessRespondedAt = a.WitnessRespondedAt,
        Reason = a.Reason,
        PrnReason = a.PrnReason,
        PrnOutcome = a.PrnOutcome,
        PrnOutcomeAt = a.PrnOutcomeAt,
        LimitBreachAcknowledged = a.LimitBreachAcknowledged,
        Notes = a.Notes,
        CreatedAt = a.CreatedAt,
        IncidentId = incidentId,
        RecordedWithoutCompetency = a.RecordedWithoutCompetency,
    };
}
