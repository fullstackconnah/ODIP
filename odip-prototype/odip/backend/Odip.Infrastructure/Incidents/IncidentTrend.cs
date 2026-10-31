using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Incidents;

/// <summary>Non-Draft incident reports per calendar month (N7); archiving stores Status = Closed, so archived reports count. Tenant scoping is the IncidentReport query filter, as on the list.</summary>
public static class IncidentTrend
{
    public const int Months = 6;

    /// <summary>
    /// The <see cref="Months"/> months ending in <paramref name="today"/>'s, oldest first; empty ones as zeros. IncidentDateTime is wall clock
    /// (as typed, stored verbatim), so each row is bucketed by its own month with no zone conversion.
    /// </summary>
    public static async Task<List<IncidentTrendMonthDto>> MonthsAsync(OdipDbContext db, DateOnly today, CancellationToken ct)
    {
        var first = new DateTime(today.Year, today.Month, 1).AddMonths(-(Months - 1));
        var end = first.AddMonths(Months);
        var rows = await db.IncidentReports
            .Where(i => i.IsActive && i.Status != IncidentStatus.Draft && i.IncidentDateTime >= first && i.IncidentDateTime < end)
            .GroupBy(i => new { i.IncidentDateTime.Year, i.IncidentDateTime.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, Incidents = g.Count(), RpUses = g.Count(i => i.IncidentType == IncidentType.RestrictivePracticeUse) })
            .ToListAsync(ct);

        return Enumerable.Range(0, Months).Select(k => first.AddMonths(k)).Select(m =>
        {
            var row = rows.FirstOrDefault(r => r.Year == m.Year && r.Month == m.Month);
            var incidents = row?.Incidents ?? 0;
            var rp = row?.RpUses ?? 0;
            return new IncidentTrendMonthDto { Month = m.ToString("yyyy-MM", CultureInfo.InvariantCulture), Incidents = incidents, RpUses = rp, OtherIncidents = incidents - rp };
        }).ToList();
    }
}
