using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Domain.Integrations;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>Every minute, each connected organisation in its own context; the change check on the first tick and every 30th; the kill switch stops the loop.</summary>
public class EmploymentHeroTimesheetBackgroundServiceTests
{
    /// <summary>Throws on the first read of the time, so exactly one organisation's run fails.</summary>
    private sealed class FailsOnce(TimeProvider inner) : TimeProvider
    {
        private int _calls;
        public override DateTimeOffset GetUtcNow() => Interlocked.Increment(ref _calls) == 1 ? throw new InvalidOperationException("boom") : inner.GetUtcNow();
    }

    private static EmploymentHeroTimesheetBackgroundService Build(string dbName, StubHttpHandler eh, TimeProvider clock, Dictionary<string, string?>? config = null)
    {
        var services = new ServiceCollection();
        services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(dbName).AddInterceptors(new AuditInterceptor(new HttpContextAccessor())));
        services.AddScoped(_ => new EmploymentHeroTimesheetSender(StubHttpHandler.Client(eh), EhFixture.Keys, clock, NullLogger<EmploymentHeroTimesheetSender>.Instance, TimeSpan.Zero));
        var provider = services.BuildServiceProvider();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(config ?? new Dictionary<string, string?>()).Build();
        return new EmploymentHeroTimesheetBackgroundService(provider.GetRequiredService<IServiceScopeFactory>(), configuration, NullLogger<EmploymentHeroTimesheetBackgroundService>.Instance);
    }

    [Fact]
    public async Task One_organisation_failing_does_not_stop_the_others()
    {
        var name = Guid.NewGuid().ToString();
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        foreach (var t in new[] { a, b })
        {
            await using var setup = EhFixture.Db(name, t);
            await EhFixture.ConnectAsync(setup, t);
            var worker = await EhTimesheetFixture.WorkerAsync(setup, t);
            await EhTimesheetFixture.ApprovedShiftAsync(setup, t, worker, new DateOnly(2026, 10, 14), new TimeOnly(9, 0), new TimeOnly(15, 0));
            (await setup.EmploymentHeroConnections.SingleAsync()).WorkTypeStandard = "7";
            await setup.SaveChangesAsync();
        }
        var eh = new StubHttpHandler().On(HttpMethod.Post, "/api/v2/business/777/timesheet?enforceUniqueExternalId=true", System.Net.HttpStatusCode.OK, new { id = 9001 });

        var tick = await Build(name, eh, new FailsOnce(EhFixture.Clock())).RunTickAsync(true, CancellationToken.None);

        Assert.Equal(new EmploymentHeroTimesheetTick(2, 1), tick);
        await using var check = TestDb.Create(name);
        Assert.Equal(1, await check.EmploymentHeroOutbox.IgnoreQueryFilters().CountAsync(r => r.Status == EmploymentHeroOutboxStatus.Sent));
    }

    [Fact]
    public void The_first_tick_and_every_thirtieth_check_for_changes()
    {
        Assert.Equal([0, 30, 60], Enumerable.Range(0, 61).Where(EmploymentHeroTimesheetBackgroundService.ChecksChanges));
    }

    [Fact]
    public async Task The_kill_switch_stops_the_loop_before_it_runs()
    {
        var eh = new StubHttpHandler();
        var service = Build(Guid.NewGuid().ToString(), eh, EhFixture.Clock(), new() { ["EmploymentHero:Enabled"] = "false" });

        await service.StartAsync(CancellationToken.None);

        Assert.True(service.ExecuteTask!.IsCompleted);
        Assert.Empty(eh.Requests);
        await service.StopAsync(CancellationToken.None);
    }
}
