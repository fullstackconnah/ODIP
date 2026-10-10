using System.Linq.Expressions;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Incidents;

namespace Odip.Api.Services;

/// <summary>
/// The one way an <see cref="IncidentReport"/> becomes an <see cref="IncidentListDto"/>: every incident
/// list, and the item Create and Update return, select through <see cref="ToListDto"/>, so a new list
/// field is added once. The overdue flag is <c>QscReporting.IsOverdue</c>, which EF runs on the
/// materialised row (allowed in the last Select); the filters use <see cref="QscReporting.IsOverdueExpr"/>.
/// </summary>
public static class IncidentProjections
{
    public static Expression<Func<IncidentReport, IncidentListDto>> ToListDto(DateTime now) => i => new IncidentListDto
    {
        Id = i.Id,
        ServiceType = i.ServiceType,
        TripInstanceId = i.TripInstanceId,
        TripName = i.TripInstance != null ? i.TripInstance.TripName : null,
        IncidentType = i.IncidentType,
        OtherTypeSpecify = i.OtherTypeSpecify,
        Severity = i.Severity,
        Status = i.Status,
        Title = i.Title,
        IncidentDateTime = i.IncidentDateTime,
        Location = i.Location,
        ReportedByName = i.ReportedByUser.FirstName + " " + i.ReportedByUser.LastName,
        InvolvedParticipantId = i.InvolvedParticipantId,
        InvolvedParticipantName = i.InvolvedParticipant != null
            ? i.InvolvedParticipant.FirstName + " " + i.InvolvedParticipant.LastName : null,
        QscReportingStatus = i.QscReportingStatus,
        IsOverdue24h = QscReporting.IsOverdue(i.IsActive, i.QscReportingStatus, i.QscReportedAt, i.CreatedAt, now),
        CreatedAt = i.CreatedAt,
        MedicationAdministrationId = i.MedicationAdministrationId,
        ShiftId = i.ShiftId,
        ShiftNoteId = i.ShiftNoteId
    };
}
