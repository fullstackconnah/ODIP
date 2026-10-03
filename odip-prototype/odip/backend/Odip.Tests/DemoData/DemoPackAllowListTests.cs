using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Odip.Infrastructure.DemoData;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// PR 2 review M1: a pack writes into a live tenant every hour and nothing it writes is ever deleted, so a new pack has to be able to ship Off.
/// <c>DemoData:Packs</c> is the allow-list that does it: empty (the default) is every pack, a list names the ones that may run.
/// </summary>
public class DemoPackAllowListTests
{
    private static DemoDataOptions From(string? packs, string scenarios = "On")
    {
        var data = new Dictionary<string, string?> { [DemoDataOptions.ScenariosKey] = scenarios };
        if (packs is not null) data[DemoDataOptions.PacksKey] = packs;
        return DemoDataOptions.FromConfiguration(new ConfigurationBuilder().AddInMemoryCollection(data).Build());
    }

    [Fact]
    public void WithNothingSet_EveryPackMayRun_AndNothingIsReported()
    {
        foreach (var options in new[] { From(null), From(""), From("   "), From(" , ,") })
        {
            Assert.Empty(options.Packs);
            Assert.All(DemoPacks.Names, name => Assert.True(options.Allows(name), name));
            Assert.Null(options.Warning);
        }
    }

    [Theory]
    [InlineData("live-set", "live-set")]
    [InlineData(" Live-Set , incidents ,, LIVE-SET ", "live-set|incidents")]
    [InlineData("incidents,notifications,live-set", "incidents|notifications|live-set")]
    public void TheList_IsTrimmed_LowerCased_AndHasNoDuplicates(string configured, string expected)
    {
        var options = From(configured);

        Assert.Equal(expected, string.Join("|", options.Packs));
        Assert.Null(options.Warning);
        Assert.All(DemoPacks.Names, name => Assert.Equal(expected.Split('|').Contains(name), options.Allows(name)));
    }

    [Fact]
    public void EveryPackInTheProductionList_HasAUniqueNameTheListCanTake()
    {
        var names = DemoPacks.Default().Select(p => p.Name).ToList();

        Assert.Equal(names, DemoPacks.Names);
        Assert.Equal(names.Count, names.Distinct(StringComparer.Ordinal).Count());
        Assert.All(names, name => Assert.Matches("^[a-z]+(-[a-z]+)*$", name));                          // lower-case words, as the list is lower-cased
    }

    [Fact]
    public void AMistypedName_IsReported_AndMatchesNothing_SoThePackItWasMeantForStaysOff()
    {
        var typo = From("live-sett,incidents");

        Assert.Contains("'live-sett'", typo.Warning, StringComparison.Ordinal);
        Assert.Contains(DemoDataOptions.PacksKey, typo.Warning, StringComparison.Ordinal);
        Assert.Contains("live-set", typo.Warning, StringComparison.Ordinal);                             // the warning lists the real names
        Assert.DoesNotContain("no pack will run", typo.Warning, StringComparison.Ordinal);
        Assert.True(typo.Allows("incidents"));
        Assert.False(typo.Allows("live-set"));                                                          // a typo never switches a pack on by guesswork
        Assert.True(typo.Enabled);                                                                      // and never changes the flag

        var onlyTypos = From("live-sett, incident");
        Assert.Contains("no pack will run", onlyTypos.Warning, StringComparison.Ordinal);
        Assert.DoesNotContain(DemoPacks.Names, onlyTypos.Allows);
    }

    [Fact]
    public void ThePacksThatRun_AreWhatTheFilterLetsThrough_InTheOrderTheCodeRunsThem()
    {
        Assert.Equal(DemoPacks.Names, From(null).PacksThatRun);
        Assert.Equal(new[] { "live-set", "incidents" }, From("incidents, LIVE-SET").PacksThatRun);          // the code's order, not the typed one
        Assert.Equal(new[] { "incidents" }, From("live-sett,incidents").PacksThatRun);                      // a name that is not a pack is not one that runs
        Assert.Empty(From("live-sett").PacksThatRun);
    }

    [Fact]
    public void WhenOn_TheTypoWarning_SaysWhatWillRunAndWhatStaysOff_AndWhenOff_WhatThePacksAre()
    {
        var text = From("live-sett,incidents").Warning!;
        Assert.Contains($"will run (1 of {DemoPacks.Names.Count}): incidents.", text, StringComparison.Ordinal);
        Assert.Contains("stay off", text, StringComparison.Ordinal);
        Assert.Contains("live-set", text[text.IndexOf("stay off", StringComparison.Ordinal)..], StringComparison.Ordinal);                  // the pack the typo was meant for is among those that stay off

        var off = From("live-sett,incidents", scenarios: "Off");                                            // nothing will run while it is Off, so it says what the packs are
        Assert.Contains("(the packs are", off.Warning, StringComparison.Ordinal);
        Assert.DoesNotContain("will run", off.Warning, StringComparison.Ordinal);
    }

    [Fact]
    public void ABadFlagAndAMistypedPack_AreBothReported()
    {
        var both = From("live-sett", scenarios: "true");

        Assert.False(both.Enabled);
        Assert.Contains(DemoDataOptions.ScenariosKey, both.Warning, StringComparison.Ordinal);
        Assert.Contains(DemoDataOptions.PacksKey, both.Warning, StringComparison.Ordinal);
    }

    [Fact]
    public async Task APackLeftOffTheList_DoesNotRun_AndTheOthersDo_AndEmptyingTheListBringsItUp()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env, true);
        await env.SetProviderStateAsync("NSW");
        var allButIncidents = new DemoDataOptions { Scenarios = DemoScenarioMode.On, Packs = DemoPacks.Names.Where(n => n != "incidents").ToList() };

        var withoutIncidents = await env.Maintainer(DemoPacks.Default(), allButIncidents).RunAsync(env.Options, CancellationToken.None);

        Assert.Equal(DemoTickStatus.Ran, withoutIncidents.Status);
        Assert.Empty(withoutIncidents.Failures);
        Assert.Contains(withoutIncidents.RowsAdded.Keys, k => k.StartsWith("live-set/", StringComparison.Ordinal));          // the others ran
        Assert.Contains(withoutIncidents.RowsAdded.Keys, k => k.StartsWith("notifications/", StringComparison.Ordinal));
        Assert.DoesNotContain(withoutIncidents.RowsAdded.Keys, k => k.StartsWith("incidents/", StringComparison.Ordinal));  // the one left off did not
        await using (var db = env.AdminDb())
        {
            Assert.Empty(await db.IncidentReports.ToListAsync());
            Assert.NotEmpty(await db.Shifts.ToListAsync());
        }

        // The same database with the list emptied: the pack was held back by the list and by nothing else.
        var everything = await env.Maintainer(DemoPacks.Default(), new DemoDataOptions { Scenarios = DemoScenarioMode.On }).RunAsync(env.Options, CancellationToken.None);

        Assert.Empty(everything.Failures);
        Assert.Contains(everything.RowsAdded.Keys, k => k.StartsWith("incidents/", StringComparison.Ordinal));
        await using var after = env.AdminDb();
        Assert.NotEmpty(await after.IncidentReports.ToListAsync());
    }

    [Fact]
    public async Task AListThatNamesNoPack_RunsNoPack_AndWritesNothing()
    {
        var env = new DemoTestEnv(Friday1030);
        await DemoFixture.SeedPeopleAsync(env, true);
        await env.SetProviderStateAsync("NSW");
        DemoSnapshot before;
        await using (var db = env.AdminDb()) before = DemoSnapshot.Take(db);

        var result = await env.Maintainer(DemoPacks.Default(), From("not-a-pack")).RunAsync(env.Options, CancellationToken.None);

        Assert.Equal(DemoTickStatus.Ran, result.Status);
        Assert.Empty(result.RowsAdded);
        Assert.Empty(result.RowsChanged);
        await using var after = env.AdminDb();
        var changes = before.Diff(DemoSnapshot.Take(after));
        Assert.True(changes.Count == 0, "wrote: " + DemoSnapshot.Describe(changes));
    }
}
