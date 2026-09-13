using System.Linq.Expressions;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Incidents;

/// <summary>
/// The single definition of "QSC report overdue" for an <see cref="IncidentReport"/> — extracted
/// so <c>TasksDashboardController.GetSummary</c>'s <c>QscOverdueCount</c>,
/// <c>IncidentsController.GetOverdueQsc</c>, and <c>ParticipantAlertsService</c>'s
/// QscReportOverdue rule all agree on the same predicate and cannot drift apart. Overdue means:
/// active, QSC reporting <see cref="QscReportingStatus.Required"/>, not yet reported
/// (<see cref="IncidentReport.QscReportedAt"/> null), and created more than
/// <see cref="OverdueHours"/> hours before the reference time.
/// </summary>
public static class QscReporting
{
    /// <summary>NDIS mandatory QSC escalation window for critical incidents.</summary>
    public const int OverdueHours = 24;

    /// <summary>
    /// Plain-value form usable once fields have already been loaded/projected (e.g. from an
    /// in-memory list or a narrow EF projection) — not itself translatable by EF Core when called
    /// against an <see cref="IQueryable{T}"/> of <see cref="IncidentReport"/>; use
    /// <see cref="IsOverdueExpr"/> for that.
    /// </summary>
    public static bool IsOverdue(bool isActive, QscReportingStatus qscReportingStatus, DateTime? qscReportedAt, DateTime createdAt, DateTime now) =>
        isActive
        && qscReportingStatus == QscReportingStatus.Required
        && qscReportedAt == null
        && createdAt < now.AddHours(-OverdueHours);

    /// <summary>Convenience overload taking the entity directly.</summary>
    public static bool IsOverdue(IncidentReport incident, DateTime now) =>
        IsOverdue(incident.IsActive, incident.QscReportingStatus, incident.QscReportedAt, incident.CreatedAt, now);

    /// <summary>
    /// EF-translatable predicate for use directly inside a LINQ-to-Entities query, e.g.
    /// <c>_db.IncidentReports.Where(QscReporting.IsOverdueExpr(DateTime.UtcNow))</c> or
    /// <c>.CountAsync(QscReporting.IsOverdueExpr(DateTime.UtcNow), ct)</c>. The cutoff is computed
    /// once outside the expression tree so EF only ever sees a constant, not a
    /// not-directly-translatable <c>DateTime.AddHours</c> call over a member access.
    /// </summary>
    public static Expression<Func<IncidentReport, bool>> IsOverdueExpr(DateTime now)
    {
        var cutoff = now.AddHours(-OverdueHours);
        return i => i.IsActive
            && i.QscReportingStatus == QscReportingStatus.Required
            && i.QscReportedAt == null
            && i.CreatedAt < cutoff;
    }
}
