using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;
using Xunit.Abstractions;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

public class ImportTimingPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    private readonly ITestOutputHelper _output;
    public ImportTimingPostgresTests(PostgresFixture pg, ITestOutputHelper output) => (_pg, _output) = (pg, output);

    [SkippableTheory]
    [InlineData(ImportLanding.Active)]
    [InlineData(ImportLanding.Onboarding)]
    public async Task Two_thousand_rows_commit_in_under_30_seconds(ImportLanding landing)
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await setup.DisposeAsync();
        var lines = new List<string> { "First name,Last name,Date of birth,NDIS number,Contact 1 name,Contact 1 relationship" };
        for (var i = 0; i < 2000; i++) lines.Add($"Person{i},Timing{i},01/02/1980,9{i:D8},Kin Timing{i},Next of kin");
        await using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).Options, Tenant(tenantId));

        var watch = Stopwatch.StartNew();
        var result = await Service(db, tenantId).CommitAsync(ImportKind.Participants, Csv([.. lines]), "timing.csv", null, landing, $"timing-{landing}", Admin(), CancellationToken.None);
        watch.Stop();

        _output.WriteLine($"{landing}: {result.CreatedCount} participants in {watch.Elapsed.TotalSeconds:0.0} s");
        Assert.Equal(2000, result.CreatedCount);
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(30), $"{landing}: {watch.Elapsed.TotalSeconds:0.0} s");
    }
}
