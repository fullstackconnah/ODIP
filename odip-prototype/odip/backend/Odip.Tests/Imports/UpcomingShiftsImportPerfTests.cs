using System.Diagnostics;
using System.Globalization;
using System.Security.Claims;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;
using Xunit.Abstractions;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

/// <summary>What the per-shift roster check costs at the cap: 40 participants, 20 staff and a 12 week pattern making 4,992 shifts, on a real PostgreSQL. The figures go in the PR; the bound is loose on purpose.</summary>
public class UpcomingShiftsImportPerfTests : IClassFixture<PostgresFixture>
{
    private static readonly string[] Days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    private readonly PostgresFixture _pg;
    private readonly ITestOutputHelper _output;
    public UpcomingShiftsImportPerfTests(PostgresFixture pg, ITestOutputHelper output) { _pg = pg; _output = output; }

    [SkippableFact]
    public async Task Preview_AndCommit_Of5000Shifts_AreTimed()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, State = "NSW" });
        var people = Enumerable.Range(0, 40).Select(i => db.Participants.Add(new Participant
            { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = $"P{i}", LastName = "Test", NdisNumber = $"43{7_000_000 + i}", IsActive = true }).Entity).ToList();
        var staff = Enumerable.Range(0, 20).Select(i => db.Users.Add(new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = $"S{i}", LastName = "Staff", Username = Guid.NewGuid().ToString(), Email = $"s{i}.{Guid.NewGuid():N}@example.com", Role = UserRole.SupportWorker,
            Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2035, 1, 1),
        }).Entity).ToList();
        await db.SaveChangesAsync();

        // 416 distinct rows x 12 weeks = 4,992 shifts.
        var lines = new List<string> { "NDIS number,Weekday,Start time,End time,Staff email" };
        for (var i = 0; i < 416; i++)
        {
            var k = i / 40;
            var start = 6 + k / 7;
            lines.Add($"{people[i % 40].NdisNumber},{Days[k % 7]},{start}:00 am,{start + 2}:00 am,{staff[i % 20].Email}");
        }
        var file = Csv([.. lines]);
        var today = await ProviderTimeZoneResolver.TodayAsync(db, TimeProvider.System, CancellationToken.None);
        var options = new ImportShiftOptions(ImportShiftShape.Pattern, today, 12);
        var caller = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "Admin"), new Claim(ClaimTypes.NameIdentifier, staff[0].Id.ToString()), new Claim("fullName", "S0 Staff")], "Test"));

        var clock = Stopwatch.StartNew();
        var preview = await Service(db, tenantId).PreviewAsync(ImportKind.UpcomingShifts, file, "roster.csv", null, CancellationToken.None, caller, options);
        var previewMs = clock.ElapsedMilliseconds;
        clock.Restart();
        var result = await Service(db, tenantId).CommitAsync(ImportKind.UpcomingShifts, file, "roster.csv", null, null, "perf", caller, CancellationToken.None, options);
        var commitMs = clock.ElapsedMilliseconds;

        _output.WriteLine(string.Create(CultureInfo.InvariantCulture,
            $"shifts {result.CreatedCount}: preview {previewMs} ms ({(double)previewMs / result.CreatedCount:F2} ms/shift), commit {commitMs} ms ({(double)commitMs / result.CreatedCount:F2} ms/shift)"));
        Assert.Equal(4992, preview.CreateCount);
        Assert.Equal(4992, result.CreatedCount);
        Assert.InRange(previewMs, 0, 120_000);
        Assert.InRange(commitMs, 0, 120_000);
    }
}
