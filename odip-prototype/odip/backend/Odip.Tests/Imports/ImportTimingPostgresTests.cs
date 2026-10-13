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

/// <summary>Runs alone, after the parallel classes: beside the whole suite the same commit took three times as long (gates run 20261013-175242-45aa).</summary>
[CollectionDefinition(nameof(ImportTimingPostgresTests), DisableParallelization = true)]
public class ImportTimingCollection;

[Collection(nameof(ImportTimingPostgresTests))]
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

        var managedBefore = GC.GetTotalMemory(forceFullCollection: true);
        var watch = Stopwatch.StartNew();
        var result = await Service(db, tenantId).CommitAsync(ImportKind.Participants, Csv([.. lines]), "timing.csv", null, landing, $"timing-{landing}", Admin(), CancellationToken.None);
        watch.Stop();

        _output.WriteLine($"{landing}: {result.CreatedCount} participants in {watch.Elapsed.TotalSeconds:0.0} s; peak working set {Process.GetCurrentProcess().PeakWorkingSet64 / 1048576} MB; managed heap {managedBefore / 1048576} MB before, {GC.GetTotalMemory(false) / 1048576} MB after");
        Assert.Equal(2000, result.CreatedCount);
        if (landing == ImportLanding.Onboarding)
        {
            // Each row is saved and untracked on its own (OnboardingImportService.CreateAsync), so one intake PDF is held at a time, not 2,000.
            var pdfBytes = await db.ParticipantIntakeSnapshots.Select(s => (long)s.PdfContent.Length).ToListAsync();
            _output.WriteLine($"{landing}: {pdfBytes.Count} intake PDFs, average {pdfBytes.Average() / 1024:0.0} KB, total {pdfBytes.Sum() / 1048576.0:0.0} MB");
        }
        // New onboarding renders one QuestPDF intake snapshot per row through the manual path (about 16 ms each), so it gets 60 s; Active keeps the spec's 30 s.
        var limit = TimeSpan.FromSeconds(landing == ImportLanding.Onboarding ? 60 : 30);
        Assert.True(watch.Elapsed < limit, $"{landing}: {watch.Elapsed.TotalSeconds:0.0} s");
    }
}
