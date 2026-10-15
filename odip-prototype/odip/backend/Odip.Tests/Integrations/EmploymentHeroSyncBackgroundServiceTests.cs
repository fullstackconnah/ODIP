using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Integrations.EhFixture;
using static Odip.Tests.Integrations.StubHttpHandler;

namespace Odip.Tests.Integrations;

/// <summary>Every 30 minutes, each connected organisation in its own context. One failing organisation never stops the others, and the kill switch stops the loop.</summary>
public class EmploymentHeroSyncBackgroundServiceTests
{
    /// <summary>Records each line with its exception, so a test can see whether an exception's own text (a PostgresException's Detail) reached the log.</summary>
    private sealed class ExceptionLogger : ILogger<EmploymentHeroSyncBackgroundService>
    {
        public List<string> Lines { get; } = new();
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Lines.Add($"{formatter(state, exception)} {exception}");
    }

    private static EmploymentHeroSyncBackgroundService Build(string dbName, StubHttpHandler eh, Dictionary<string, string?>? config = null, ILogger<EmploymentHeroSyncBackgroundService>? logger = null)
    {
        var services = new ServiceCollection();
        services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(dbName).AddInterceptors(new AuditInterceptor(new HttpContextAccessor())));
        services.AddScoped(_ => Sync(eh));
        var provider = services.BuildServiceProvider();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(config ?? new Dictionary<string, string?>()).Build();
        return new EmploymentHeroSyncBackgroundService(provider.GetRequiredService<IServiceScopeFactory>(), configuration, logger ?? NullLogger<EmploymentHeroSyncBackgroundService>.Instance);
    }

    [Fact]
    public async Task One_organisation_failing_does_not_stop_the_others()
    {
        var name = Guid.NewGuid().ToString();
        Guid unreadable = Guid.NewGuid(), good = Guid.NewGuid();
        // The first organisation's key was saved under another master key, so its run fails; the second is synced all the same.
        await using (var setup = Db(name, unreadable)) await ConnectAsync(setup, unreadable, IntegrationKeyProtectorTests.Protector(IntegrationKeyProtectorTests.NewMasterKey()));
        await using (var setup = Db(name, good)) await ConnectAsync(setup, good);
        var eh = Eh(Employee(101, "Ana", "Ruiz", "ana@gmail.com"));

        var tick = await Build(name, eh).RunTickAsync(CancellationToken.None);

        Assert.Equal(new EmploymentHeroSyncTick(2, 1), tick);
        await using var check = TestDb.Create(name);
        Assert.True(await check.Users.AnyAsync(u => u.TenantId == good && u.ExternalPayrollId == "101"));
        Assert.Equal(EmploymentHeroStaffSync.KeyUnreadableMessage, (await check.EmploymentHeroConnections.SingleAsync(c => c.TenantId == unreadable)).LastSyncError);
        Assert.Equal(2, await check.EmploymentHeroSyncLogs.CountAsync());
    }

    [Fact]
    public async Task An_unexpected_failure_is_logged_by_its_type_without_its_details()
    {
        var name = Guid.NewGuid().ToString();
        var tenant = Guid.NewGuid();
        await using (var setup = Db(name, tenant)) await ConnectAsync(setup, tenant);
        // Something the sync does not expect, whose message carries a person's details (as a PostgresException's Detail does).
        var eh = new StubHttpHandler().OnThrow(EmployeesPage(Business), new InvalidOperationException("Key (Email)=(jane@gmail.com) already exists."));
        var logger = new ExceptionLogger();

        var tick = await Build(name, eh, logger: logger).RunTickAsync(CancellationToken.None);

        Assert.Equal(new EmploymentHeroSyncTick(1, 1), tick);
        Assert.Contains(logger.Lines, l => l.Contains(nameof(InvalidOperationException)));
        Assert.DoesNotContain(logger.Lines, l => l.Contains("jane@gmail.com"));
    }

    [Fact]
    public async Task The_kill_switch_stops_the_loop_before_it_runs()
    {
        var eh = Eh();
        var service = Build(Guid.NewGuid().ToString(), eh, new() { ["EmploymentHero:Enabled"] = "false" });

        await service.StartAsync(CancellationToken.None);

        Assert.True(service.ExecuteTask!.IsCompleted);
        Assert.Empty(eh.Requests);
        await service.StopAsync(CancellationToken.None);
    }
}
