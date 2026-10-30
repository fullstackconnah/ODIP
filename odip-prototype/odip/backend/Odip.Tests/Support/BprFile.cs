using Microsoft.EntityFrameworkCore;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Tests.Support;

internal static class BprFile
{
    /// <summary>The file's bytes for a claim's NDIA-managed lines, without the checks a real build runs: for tests of what the writer does with a row, not of who may send it.</summary>
    public static async Task<byte[]> OfClaimAsync(OdipDbContext db, Guid tenantId, Guid claimId)
    {
        var ids = await db.ClaimLineItems.Where(l => l.TripClaimId == claimId).Select(l => l.Id).ToListAsync();
        var rows = (await new BprCsvService(db).LoadRowsAsync(tenantId, ids, CancellationToken.None)).Where(r => r.PlanType == PlanType.AgencyManaged);
        return BprCsvService.Write(rows.Select(r => BprCsvService.ToOut(r, 1)));
    }
}
