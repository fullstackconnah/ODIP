using Microsoft.EntityFrameworkCore;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// An organisation's rostering and alert thresholds (Settings > Rostering rules, Alert windows). The defaults are the values that used to be fixed, so an organisation
/// that never saved a setting behaves as before.
/// </summary>
public sealed record OrganisationRules(int VarianceReviewMinutes, int PlanExpiryWarningDays)
{
    /// <summary>Bounds of the shift review minutes (critique M6): 0 would flag every non-zero variance, and past 4 hours the signal is no longer useful for any shift this domain schedules.</summary>
    public const int MinVarianceReviewMinutes = 1;
    public const int MaxVarianceReviewMinutes = 240;

    public static readonly OrganisationRules Default = new(15, 30);

    /// <summary>
    /// Each organisation's rules by tenant id, read by explicit id rather than the ambient filter so a SuperAdmin's mixed page judges each row by its own organisation.
    /// An organisation with no settings row is absent: use <see cref="For"/>. Two rows for one organisation: the lowest Id wins, as everywhere else.
    /// </summary>
    public static async Task<IReadOnlyDictionary<Guid, OrganisationRules>> ForAsync(OdipDbContext db, IEnumerable<Guid> tenantIds, CancellationToken ct)
    {
        var ids = tenantIds.Distinct().ToList();
        var rows = await db.AppSettings.IgnoreQueryFilters([TenantFilter.Name]).Where(s => ids.Contains(s.TenantId)).OrderBy(s => s.Id)
            .Select(s => new { s.TenantId, s.VarianceReviewMinutes, s.PlanExpiryWarningDays }).ToListAsync(ct);
        return rows.GroupBy(r => r.TenantId).ToDictionary(g => g.Key, g => new OrganisationRules(
            Math.Clamp(g.First().VarianceReviewMinutes, MinVarianceReviewMinutes, MaxVarianceReviewMinutes), g.First().PlanExpiryWarningDays));
    }

    public static OrganisationRules For(IReadOnlyDictionary<Guid, OrganisationRules> byTenant, Guid tenantId) =>
        byTenant.TryGetValue(tenantId, out var rules) ? rules : Default;
}
