using Microsoft.EntityFrameworkCore;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Rostering;

/// <summary>The live regular of a shift pattern: its default worker. The one query behind the board's "Regular" marker and auto-roster's regular pass.</summary>
public static class RosterRegulars
{
    /// <summary>By pattern id, the pattern's regular (its default worker); a pattern with none is absent.</summary>
    public static async Task<Dictionary<Guid, Guid>> ByPatternAsync(OdipDbContext db, IEnumerable<Guid?> patternIds, CancellationToken ct)
    {
        var ids = patternIds.Where(id => id.HasValue).Select(id => id!.Value).Distinct().ToList();
        if (ids.Count == 0) return new();
        return await db.ShiftPatterns.AsNoTracking().Where(p => ids.Contains(p.Id) && p.DefaultUserId != null).ToDictionaryAsync(p => p.Id, p => p.DefaultUserId!.Value, ct);
    }
}
