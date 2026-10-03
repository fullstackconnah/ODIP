using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The idle tick is cheap (plan 6, T8): a tick with nothing to do runs the same few queries however much history the demo has, because every pack asks
/// the database for what could need moving (a status, a date, a handful of ids) and never walks the rows it has already written. The Postgres-backed
/// T8 measures the commands on a server, where CI has one; this is the same property counted on EF InMemory, where it can be checked anywhere: the
/// number of queries an idle tick runs, on a day-old demo and on a two-month-old one, and that it does not grow.
/// </summary>
public class DemoIdleTickTests
{
    private static async Task<int> IdleQueriesAsync(DemoTestEnv env, DateTimeOffset utc)
    {
        env.Clock.Set(utc);
        var packs = DemoPacks.Default();
        await env.Maintainer(packs).RunAsync(env.Options, CancellationToken.None);                 // brings the demo up to this moment
        CountingQueryProvider.Reset();
        var idle = await env.Maintainer(packs).RunAsync(env.Options, CancellationToken.None);       // and now there is nothing to do
        Assert.Equal(0, idle.RowsAdded.Values.Sum() + idle.RowsChanged.Values.Sum());
        return CountingQueryProvider.Count;
    }

    [Fact]
    public async Task AnIdleTick_RunsTheSameQueries_OnADayOldDemoAsOnATwoMonthOldOne_AndFewerThanTheBudget()
    {
        var first = new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero);                      // Fri 10:30 AEST, the worked example
        var env = new DemoTestEnv(first, countQueries: true);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");

        var dayOld = await IdleQueriesAsync(env, first);
        for (var day = 3; day <= 60; day += 3)
        {
            env.Clock.Set(first.AddDays(day));
            await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
        }
        var twoMonths = await IdleQueriesAsync(env, first.AddDays(60));

        // About 76 on this clock (82 before an event whose row is already there by id stopped asking for it by key too): ~22 for the roster packs of PR 1 and ~54 for
        // the live set (a handover source for each shift in progress), the medication chart, the shift package and the incidents.
        // The budget is a tripwire for a query that runs per row (hundreds), not a design limit: the 500 ms of the Postgres test is the one that matters.
        Assert.InRange(dayOld, 40, 90);
        Assert.True(Math.Abs(twoMonths - dayOld) <= 6, $"an idle tick ran {dayOld} queries on a day-old demo and {twoMonths} on a two-month-old one");
    }
}
