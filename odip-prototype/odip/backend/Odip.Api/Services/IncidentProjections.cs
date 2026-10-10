using System.Linq.Expressions;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Incidents;

namespace Odip.Api.Services;

/// <summary>
/// The one way an <see cref="IncidentReport"/> becomes an <see cref="IncidentListDto"/>: every incident
/// list, and the item Create and Update return, select through <see cref="ToListDto"/>, so a new list
/// field is added once. The overdue flag is always <see cref="QscReporting.IsOverdueExpr"/>.
/// </summary>
public static class IncidentProjections
{
    public static Expression<Func<IncidentReport, IncidentListDto>> ToListDto(DateTime now) => WithOverdueRule<IncidentListDto>(i => new IncidentListDto
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
        IsOverdue24h = IsOverdue(i),
        CreatedAt = i.CreatedAt,
        MedicationAdministrationId = i.MedicationAdministrationId,
        ShiftId = i.ShiftId,
        ShiftNoteId = i.ShiftNoteId
    }, now);

    /// <summary>Written inside a projection where the overdue test belongs; <see cref="WithOverdueRule"/> swaps in the rule. Never called.</summary>
    public static bool IsOverdue(IncidentReport incident) => throw new NotSupportedException("Only valid inside IncidentProjections.WithOverdueRule.");

    /// <summary>
    /// EF cannot call a rule held in another expression (<c>Compile()(i)</c> is silently evaluated client-side on
    /// Npgsql, pulling whole rows), so the rule's body is spliced into the projection in place of <see cref="IsOverdue"/>.
    /// </summary>
    public static Expression<Func<IncidentReport, T>> WithOverdueRule<T>(Expression<Func<IncidentReport, T>> projection, DateTime now)
    {
        var rule = QscReporting.IsOverdueExpr(now);
        return Expression.Lambda<Func<IncidentReport, T>>(new Splice(projection.Parameters[0], rule).Visit(projection.Body), rule.Parameters[0]);
    }

    private sealed class Splice(ParameterExpression item, Expression<Func<IncidentReport, bool>> rule) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == item ? rule.Parameters[0] : node;

        protected override Expression VisitMethodCall(MethodCallExpression node) =>
            node.Method.DeclaringType == typeof(IncidentProjections) && node.Method.Name == nameof(IsOverdue) ? rule.Body : base.VisitMethodCall(node);
    }
}
