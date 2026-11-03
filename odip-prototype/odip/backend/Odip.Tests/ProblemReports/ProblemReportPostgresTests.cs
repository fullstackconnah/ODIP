using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Tests.EarlyAccess;
using Xunit;

namespace Odip.Tests.ProblemReports;

/// <summary>
/// What EF InMemory cannot show: the real migration's columns and indexes, the tenant filter on the real provider, and the
/// retention purge (ExecuteDeleteAsync is PostgreSQL-only). Skips wherever POSTGRES_CONNECTION_STRING is unset, like
/// <see cref="EarlyAccessPostgresTests"/>.
/// </summary>
public class ProblemReportPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public ProblemReportPostgresTests(PostgresFixture pg) => _pg = pg;

    private DbContextOptions<OdipDbContext> Options() =>
        new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString!).Options;

    private OdipDbContext Db(ScopedTenantOverride who) => new(Options(), who);

    private sealed class Sender : IProblemReportSender
    {
        public Task<ProblemReportSendResult> TrySendAsync(ProblemReport report, CancellationToken ct) =>
            Task.FromResult(new ProblemReportSendResult(true, 77, null));
    }

    private ProblemReportSendBackgroundService Service()
    {
        var services = new ServiceCollection();
        services.AddSingleton(Options());
        services.AddSingleton<IProblemReportSender>(new Sender());
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["WorkBoard:BaseUrl"] = "http://board.test", ["WorkBoard:Token"] = "fake-token", ["WorkBoard:ProjectId"] = "7" }).Build();
        return new ProblemReportSendBackgroundService(services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(), config, NullLogger<ProblemReportSendBackgroundService>.Instance);
    }

    private async Task<(Guid A, Guid B)> TwoTenantsAsync()
    {
        var a = new Tenant { Id = Guid.NewGuid(), Name = "Org A " + Guid.NewGuid().ToString("N") };
        var b = new Tenant { Id = Guid.NewGuid(), Name = "Org B " + Guid.NewGuid().ToString("N") };
        await using var db = Db(new ScopedTenantOverride { IsSuperAdmin = true });
        db.Tenants.AddRange(a, b);
        await db.SaveChangesAsync();
        return (a.Id, b.Id);
    }

    private static ProblemReport Row(Guid tenant, Action<ProblemReport>? edit = null) =>
        ProblemReportCardTests.Report(r =>
        {
            r.Id = Guid.NewGuid();
            r.TenantId = tenant;
            r.Status = ProblemReportStatus.Saved;
            r.NextAttemptAt = DateTime.UtcNow.AddMinutes(-1);
            r.CreatedAt = DateTime.UtcNow;
            edit?.Invoke(r);
        });

    [SkippableFact]
    public async Task Migration_CreatesTheTable_WithTheAgreedColumns_AndIndexes()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        await using var connection = _pg.OpenConnection();

        await using var columns = new NpgsqlCommand(
            "SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns " +
            "WHERE table_name = 'ProblemReports' ORDER BY column_name", connection);
        var found = new List<string>();
        await using (var reader = await columns.ExecuteReaderAsync())
            while (await reader.ReadAsync())
                found.Add($"{reader.GetString(0)}|{reader.GetString(1)}|{(reader.IsDBNull(2) ? "" : reader.GetInt32(2).ToString())}|{reader.GetString(3)}");

        Assert.Equal(new[]
        {
            "ApiVersion|character varying|64|NO",
            "AppVersion|character varying|64|NO",
            "Attempts|integer||NO",
            "CardId|bigint||YES",
            "CreatedAt|timestamp without time zone||NO",
            "Id|uuid||NO",
            "LastError|character varying|500|YES",
            "NextAttemptAt|timestamp without time zone||NO",
            "OrganisationName|character varying|200|NO",
            "PagePath|character varying|200|NO",
            "ReporterName|character varying|200|NO",
            "ReporterRole|character varying|32|NO",
            "ReporterUserId|uuid||NO",
            "SentAt|timestamp without time zone||YES",
            "Status|integer||NO",
            "TenantId|uuid||NO",
            "Text|character varying|2000|NO",
            "UserAgent|character varying|300|NO",
        }, found);

        await using var indexes = new NpgsqlCommand("SELECT indexname FROM pg_indexes WHERE tablename = 'ProblemReports' ORDER BY indexname", connection);
        var names = new List<string>();
        await using (var reader = await indexes.ExecuteReaderAsync())
            while (await reader.ReadAsync()) names.Add(reader.GetString(0));
        Assert.Contains("IX_ProblemReports_ReporterUserId_CreatedAt", names);
        Assert.Contains("IX_ProblemReports_Status_NextAttemptAt", names);
        Assert.Contains("IX_ProblemReports_TenantId", names);
    }

    [SkippableFact]
    public async Task TheSenderLoop_WritesEachRowThroughItsOwnTenant_AndATenantContextSeesOnlyItsRows()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var (a, b) = await TwoTenantsAsync();
        var rowA = Row(a);
        var rowB = Row(b);
        await using (var seed = Db(new ScopedTenantOverride { IsSuperAdmin = true }))
        {
            seed.ProblemReports.AddRange(rowA, rowB);
            await seed.SaveChangesAsync();
        }

        await Service().RunTickAsync(CancellationToken.None);

        await using var asA = Db(new ScopedTenantOverride { TenantId = a });
        var seenByA = await asA.ProblemReports.AsNoTracking().Where(r => r.Id == rowA.Id || r.Id == rowB.Id).ToListAsync();
        var onlyA = Assert.Single(seenByA);
        Assert.Equal(rowA.Id, onlyA.Id);
        Assert.Equal(ProblemReportStatus.Sent, onlyA.Status);
        Assert.Equal(77, onlyA.CardId);
        await using var asB = Db(new ScopedTenantOverride { TenantId = b });
        var theirs = await asB.ProblemReports.AsNoTracking().SingleAsync(r => r.Id == rowB.Id);
        Assert.Equal(b, theirs.TenantId);
        Assert.Equal(ProblemReportStatus.Sent, theirs.Status);
    }

    [SkippableFact]
    public async Task ThePurge_RemovesRowsOlderThan90Days_OfAnyStatus_InEveryTenant_AndKeepsTheRecentOnes()
    {
        Skip.IfNot(_pg.Available, _pg.UnavailableReason);
        var (a, b) = await TwoTenantsAsync();
        var old = DateTime.UtcNow.AddDays(-91);
        var oldSentA = Row(a, r => { r.Status = ProblemReportStatus.Sent; r.CreatedAt = old; });
        var oldFailedB = Row(b, r => { r.Status = ProblemReportStatus.Failed; r.CreatedAt = old; });
        var oldSaved = Row(a, r => { r.Status = ProblemReportStatus.Saved; r.CreatedAt = old; });
        var recentSent = Row(a, r => { r.Status = ProblemReportStatus.Sent; r.CreatedAt = DateTime.UtcNow.AddDays(-10); });
        await using (var seed = Db(new ScopedTenantOverride { IsSuperAdmin = true }))
        {
            seed.ProblemReports.AddRange(oldSentA, oldFailedB, oldSaved, recentSent);
            await seed.SaveChangesAsync();
        }

        var removed = await Service().PurgeExpiredAsync(DateTime.UtcNow, CancellationToken.None);

        Assert.True(removed >= 3);
        await using var check = Db(new ScopedTenantOverride { IsSuperAdmin = true });
        var left = await check.ProblemReports.AsNoTracking()
            .Where(r => new[] { oldSentA.Id, oldFailedB.Id, oldSaved.Id, recentSent.Id }.Contains(r.Id)).Select(r => r.Id).ToListAsync();
        Assert.Equal(new[] { recentSent.Id }, left);
    }
}
