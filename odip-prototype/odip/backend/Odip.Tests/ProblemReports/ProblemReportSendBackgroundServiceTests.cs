using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Tests.EarlyAccess;
using Xunit;

namespace Odip.Tests.ProblemReports;

public class ProblemReportSendBackgroundServiceTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-4000-8000-000000000002");

    private sealed class RecordingSender : IProblemReportSender
    {
        private readonly Func<ProblemReport, ProblemReportSendResult> _answer;
        public List<(Guid Id, string? LastError)> Seen { get; } = new();
        public RecordingSender(Func<ProblemReport, ProblemReportSendResult> answer) => _answer = answer;

        public Task<ProblemReportSendResult> TrySendAsync(ProblemReport report, CancellationToken ct)
        {
            Seen.Add((report.Id, report.LastError));
            return Task.FromResult(_answer(report));
        }
    }

    private static readonly ProblemReportSendResult Fails = new(false, null, "503");

    private static (ProblemReportSendBackgroundService Service, string Db) Build(RecordingSender sender, bool configured = true, string? db = null)
    {
        db ??= Guid.NewGuid().ToString();
        var services = new ServiceCollection();
        services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(db));
        services.AddSingleton<IProblemReportSender>(sender);
        var provider = services.BuildServiceProvider();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["WorkBoard:BaseUrl"] = configured ? "http://board.test" : "",
            ["WorkBoard:Token"] = configured ? "fake-token" : "",
            ["WorkBoard:ProjectId"] = configured ? "7" : "",
        }).Build();
        return (new ProblemReportSendBackgroundService(provider.GetRequiredService<IServiceScopeFactory>(), config, NullLogger<ProblemReportSendBackgroundService>.Instance), db);
    }

    private static async Task SeedAsync(string db, params Action<ProblemReport>[] edits)
    {
        await using var ctx = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(db).Options, new ScopedTenantOverride { IsSuperAdmin = true });
        foreach (var edit in edits)
        {
            ctx.ProblemReports.Add(ProblemReportCardTests.Report(r =>
            {
                r.Id = Guid.NewGuid();
                r.TenantId = TenantA;
                r.Status = ProblemReportStatus.Saved;
                r.NextAttemptAt = DateTime.UtcNow.AddMinutes(-1);
                edit(r);
            }));
        }
        await ctx.SaveChangesAsync();
    }

    private static async Task<List<ProblemReport>> RowsAsync(string db)
    {
        await using var ctx = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(db).Options, new ScopedTenantOverride { IsSuperAdmin = true });
        return await ctx.ProblemReports.AsNoTracking().OrderBy(r => r.CreatedAt).ToListAsync();
    }

    [Fact]
    public async Task ADueRowThatFails_GetsOneAttempt_AndIsRetriedInAboutAMinute()
    {
        var (service, db) = Build(new RecordingSender(_ => Fails));
        await SeedAsync(db, _ => { });

        await service.RunTickAsync(CancellationToken.None);

        var row = Assert.Single(await RowsAsync(db));
        Assert.Equal(ProblemReportStatus.Saved, row.Status);
        Assert.Equal(1, row.Attempts);
        Assert.Equal("503", row.LastError);
        Assert.InRange((row.NextAttemptAt - DateTime.UtcNow).TotalMinutes, 0.5, 1.5);
    }

    [Theory]
    [InlineData(1, 5)]
    [InlineData(2, 15)]
    [InlineData(3, 60)]
    public async Task TheBackoff_Is1_5_15_60_240Minutes(int attemptsBefore, int expectedMinutes)
    {
        var (service, db) = Build(new RecordingSender(_ => Fails));
        await SeedAsync(db, r => r.Attempts = attemptsBefore);

        await service.RunTickAsync(CancellationToken.None);

        var row = Assert.Single(await RowsAsync(db));
        Assert.InRange((row.NextAttemptAt - DateTime.UtcNow).TotalMinutes, expectedMinutes - 0.5, expectedMinutes + 0.5);
    }

    [Fact]
    public async Task TheFifthFailure_MarksTheRowFailed()
    {
        var (service, db) = Build(new RecordingSender(_ => Fails));
        await SeedAsync(db, r => r.Attempts = 4);

        await service.RunTickAsync(CancellationToken.None);

        var row = Assert.Single(await RowsAsync(db));
        Assert.Equal(ProblemReportStatus.Failed, row.Status);
        Assert.Equal(5, row.Attempts);
    }

    [Fact]
    public async Task ASuccess_MarksTheRowSent_WithTheCardId()
    {
        var (service, db) = Build(new RecordingSender(_ => new ProblemReportSendResult(true, 9, null)));
        await SeedAsync(db, r => r.LastError = "503");

        await service.RunTickAsync(CancellationToken.None);

        var row = Assert.Single(await RowsAsync(db));
        Assert.Equal(ProblemReportStatus.Sent, row.Status);
        Assert.Equal(9, row.CardId);
        Assert.NotNull(row.SentAt);
    }

    [Fact]
    public async Task ARowNotYetDue_AndSentOrFailedRows_AreLeftAlone()
    {
        var sender = new RecordingSender(_ => new ProblemReportSendResult(true, 1, null));
        var (service, db) = Build(sender);
        await SeedAsync(db,
            r => r.NextAttemptAt = DateTime.UtcNow.AddMinutes(30),
            r => r.Status = ProblemReportStatus.Sent,
            r => r.Status = ProblemReportStatus.Failed);

        await service.RunTickAsync(CancellationToken.None);

        Assert.Empty(sender.Seen);
    }

    [Fact]
    public async Task TheRetryHands_TheEarlierLastError_ToTheSender()
    {
        var sender = new RecordingSender(_ => Fails);
        var (service, db) = Build(sender);
        await SeedAsync(db, r => r.LastError = ProblemReportSendResult.UnknownOutcome);

        await service.RunTickAsync(CancellationToken.None);

        Assert.Equal(ProblemReportSendResult.UnknownOutcome, Assert.Single(sender.Seen).LastError);
    }

    [Fact]
    public async Task EveryTenantsRows_AreHandled_AndStayInTheirOwnTenant()
    {
        var (service, db) = Build(new RecordingSender(_ => new ProblemReportSendResult(true, 5, null)));
        await SeedAsync(db, r => r.TenantId = TenantA, r => r.TenantId = TenantB);

        await service.RunTickAsync(CancellationToken.None);

        var rows = await RowsAsync(db);
        Assert.Equal(2, rows.Count);
        Assert.All(rows, r => Assert.Equal(ProblemReportStatus.Sent, r.Status));
        Assert.Equal(new[] { TenantA, TenantB }.Order(), rows.Select(r => r.TenantId).Order());
    }

    [Fact]
    public async Task NotConfigured_NeverTouchesTheDatabase()
    {
        var sender = new RecordingSender(_ => Fails);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build();
        var service = new ProblemReportSendBackgroundService(new ThrowingScopeFactory(), config, NullLogger<ProblemReportSendBackgroundService>.Instance);

        await service.RunTickAsync(CancellationToken.None); // a created scope would throw

        Assert.Empty(sender.Seen);
    }

    [Fact]
    public async Task AFiveStrikeFailure_LogsOneWarning_NamingTheReportAndNotItsText()
    {
        var log = new CapturingLogger<ProblemReportSendBackgroundService>();
        var services = new ServiceCollection();
        var db = Guid.NewGuid().ToString();
        services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(db));
        services.AddSingleton<IProblemReportSender>(new RecordingSender(_ => Fails));
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["WorkBoard:BaseUrl"] = "http://board.test", ["WorkBoard:Token"] = "fake-token", ["WorkBoard:ProjectId"] = "7" }).Build();
        var service = new ProblemReportSendBackgroundService(services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(), config, log);
        Guid id = default;
        await SeedAsync(db, r => { r.Attempts = 4; r.Text = "TYPEDWORDS"; id = r.Id; });

        await service.RunTickAsync(CancellationToken.None);

        var warning = Assert.Single(log.Entries.Where(e => e.Level == Microsoft.Extensions.Logging.LogLevel.Warning));
        Assert.Contains(id.ToString(), warning.Message);
        Assert.DoesNotContain("TYPEDWORDS", warning.Message);
    }

    private sealed class ThrowingScopeFactory : IServiceScopeFactory
    {
        public IServiceScope CreateScope() => throw new InvalidOperationException("no scope may be created when the Work Board is not configured");
    }
}
