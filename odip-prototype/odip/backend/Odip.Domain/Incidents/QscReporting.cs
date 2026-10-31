using System.Linq.Expressions;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Incidents;

/// <summary>
/// The single definition of "NDIS Commission report overdue" for an <see cref="IncidentReport"/> — extracted
/// so <c>TasksDashboardController.GetSummary</c>'s <c>QscOverdueCount</c>,
/// <c>IncidentsController.GetOverdueQsc</c> and its <c>isOverdueQsc</c> filter, every incident list's
/// <c>IsOverdue24h</c> flag (<c>IncidentProjections</c>), and <c>ParticipantAlertsService</c>'s
/// qsc-report-overdue rule all agree on the same predicate and cannot drift apart. Overdue means:
/// active, reporting <see cref="QscReportingStatus.Required"/>, not yet reported
/// (<see cref="IncidentReport.QscReportedAt"/> null), and past the stored <see cref="IncidentReport.NotifyDueAt"/>
/// (24 hours, or 5 business days, after the provider became aware). A null due is never overdue.
/// </summary>
public static class QscReporting
{
    /// <summary>The 24-hour notify window.</summary>
    public const int OverdueHours = 24;

    /// <summary>Incident types that are reportable within 24 hours whatever the severity.</summary>
    public static readonly IncidentType[] RequiredTypes =
    {
        IncidentType.Abuse, IncidentType.Neglect, IncidentType.Death,
        IncidentType.RestrictivePracticeUse, IncidentType.MissingPerson
    };

    /// <summary>The class an incident starts with: Within24h for a critical incident, a required type or an unauthorised restrictive practice, else None.</summary>
    public static ReportableClass DefaultClass(IncidentSeverity severity, IncidentType type, bool? isRestrictivePracticeAuthorised) =>
        severity == IncidentSeverity.Critical || RequiredTypes.Contains(type) || isRestrictivePracticeAuthorised == false
            ? ReportableClass.Within24h : ReportableClass.None;

    /// <summary>The status follows the class and the report date; nobody sets it by hand. Class None is NotRequired even with a voluntary report date.</summary>
    public static QscReportingStatus DeriveStatus(ReportableClass reportableClass, DateTime? reportedUtc, DateTime? notifyDueAt) =>
        reportableClass == ReportableClass.None ? QscReportingStatus.NotRequired
        : reportedUtc == null ? QscReportingStatus.Required
        : notifyDueAt != null && reportedUtc <= notifyDueAt ? QscReportingStatus.ReportedWithin24h
        : QscReportingStatus.ReportedLate;

    /// <summary>
    /// Plain-value form usable once fields have already been loaded/projected (e.g. from an
    /// in-memory list or a narrow EF projection) — not itself translatable by EF Core when called
    /// against an <see cref="IQueryable{T}"/> of <see cref="IncidentReport"/>; use
    /// <see cref="IsOverdueExpr"/> for that.
    /// </summary>
    public static bool IsOverdue(bool isActive, QscReportingStatus qscReportingStatus, DateTime? qscReportedAt, DateTime? notifyDueAt, DateTime now) =>
        isActive
        && qscReportingStatus == QscReportingStatus.Required
        && qscReportedAt == null
        && notifyDueAt != null
        && notifyDueAt < now;

    /// <summary>Convenience overload taking the entity directly.</summary>
    public static bool IsOverdue(IncidentReport incident, DateTime now) =>
        IsOverdue(incident.IsActive, incident.QscReportingStatus, incident.QscReportedAt, incident.NotifyDueAt, now);

    /// <summary>
    /// EF-translatable predicate for use directly inside a LINQ-to-Entities query, e.g.
    /// <c>_db.IncidentReports.Where(QscReporting.IsOverdueExpr(DateTime.UtcNow))</c> or
    /// <c>.CountAsync(QscReporting.IsOverdueExpr(DateTime.UtcNow), ct)</c>.
    /// </summary>
    public static Expression<Func<IncidentReport, bool>> IsOverdueExpr(DateTime now) =>
        i => i.IsActive
            && i.QscReportingStatus == QscReportingStatus.Required
            && i.QscReportedAt == null
            && i.NotifyDueAt != null
            && i.NotifyDueAt < now;
}
