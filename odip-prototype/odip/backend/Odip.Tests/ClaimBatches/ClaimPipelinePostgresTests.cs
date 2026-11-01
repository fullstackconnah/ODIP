using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.ClaimBatches;

/// <summary>[PG] The claims pipeline aggregate on a real PostgreSQL: the Any() over the file lines, the lifted claim-line filter and the week buckets translate and add up. Skipped, never failed, without POSTGRES_CONNECTION_STRING.</summary>
public class ClaimPipelinePostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public ClaimPipelinePostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact(DisplayName = "Postgres: the pipeline sums sent, paid and the snapshot, and a paid line with no TenantId still counts for its organisation")]
    public async Task The_aggregate_translates_and_adds_up()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        using var f = new BatchFixture(db, tenantId);
        var (_, lines, _) = f.AddClaim(lines: 2, shiftLines: true);
        var built = await f.BuildAsync(lines[0].Id, lines[1].Id);
        Assert.True(built.Ok, string.Join("; ", built.Errors ?? []));
        f.Clock.Utc = new DateTime(2026, 10, 27, 1, 0, 0, DateTimeKind.Utc);
        Assert.True((await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, built.Value!.Id, default)).Ok);
        f.Clock.Utc = BatchFixture.Now;
        lines[0].Status = ClaimLineItemStatus.Paid;
        lines[0].PaidAmount = 120m;
        lines[0].PaidAt = new DateTime(2026, 10, 28, 3, 0, 0, DateTimeKind.Utc);
        lines[0].TenantId = null; // an older image's INSERT leaves it null
        await f.Db.SaveChangesAsync();

        var p = await f.Service.PipelineAsync(f.TenantId, default);

        var week = p.Weeks[^1];
        Assert.Equal((built.Value.TotalAmount, 120m), (week.Sent, week.Paid));
        Assert.Equal((built.Value.TotalAmount - lines[0].TotalAmount, 0m), (p.WithNdia, p.UndatedPaid));
    }
}
