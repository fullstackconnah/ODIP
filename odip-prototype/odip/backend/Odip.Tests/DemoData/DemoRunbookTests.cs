using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Domain.Entities;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Odip.Tests.EarlyAccess;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The runbook (<c>docs/runbooks/demo-data.md</c>) is the owner's only way to clear the top-up out, and it is written for a moment when nothing else is at
/// hand, so it is held to the code: it lists the packs the maintainer runs, in order, and its purge names every table the packs may write, children before
/// parents, against the EF model's foreign keys (PR 2 review M1). The compose file passes the two switches it describes to the API.
///
/// These read the repository, so they skip where it is not there (the Docker image build's context is the backend folder alone): a skip is never a failure.
/// </summary>
public class DemoRunbookTests
{
    private static string? RepositoryRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
        {
            var parent = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
            if (parent == dir) return null;
            dir = parent;
        }
        return dir is null ? null : Path.GetFullPath(Path.Combine(dir, "..", "..", ".."));        // backend, odip, odip-prototype, the repository
    }

    private static string ReadOrSkip(params string[] relative)
    {
        var root = RepositoryRoot();
        var path = root is null ? null : Path.Combine(new[] { root }.Concat(relative).ToArray());
        Skip.If(path is null || !File.Exists(path), "the repository's " + string.Join('/', relative) + " is not next to the test assembly");
        return File.ReadAllText(path!);
    }

    private static string Runbook() => ReadOrSkip("docs", "runbooks", "demo-data.md");

    [SkippableFact]
    public void TheRunbooksPackTable_ListsEveryPackTheMaintainerRuns_InTheOrderItRunsThem()
    {
        var runbook = Runbook();
        var section = Regex.Match(runbook, "## The packs, in the order they run(?<body>.*?)(\\r?\\n## |$)", RegexOptions.Singleline | RegexOptions.CultureInvariant);
        Assert.True(section.Success, "the runbook has no pack table");

        var listed = Regex.Matches(section.Groups["body"].Value, "^\\| `(?<name>[a-z-]+)` \\|", RegexOptions.Multiline | RegexOptions.CultureInvariant)
            .Select(m => m.Groups["name"].Value).ToList();

        Assert.Equal(DemoPacks.Names, listed);
    }

    [SkippableFact]
    public void ThePurgeInTheRunbook_NamesEveryTableThePacksMayWrite_ChildrenBeforeParents_AndAnyOtherTableThatPointsAtThem()
    {
        var runbook = Runbook();
        var fence = Regex.Match(runbook, "```sql\\r?\\n(?<sql>.*?)```", RegexOptions.Singleline | RegexOptions.CultureInvariant);
        Assert.True(fence.Success, "the runbook has no sql block");
        var statements = fence.Groups["sql"].Value.Split('\n').Select(line => line.Trim()).Where(line => !line.StartsWith("--", StringComparison.Ordinal)).ToList();
        var deletes = statements.Select(line => Regex.Match(line, "^DELETE FROM \"(?<table>\\w+)\"", RegexOptions.CultureInvariant))
            .Where(m => m.Success).Select(m => m.Groups["table"].Value).ToList();

        // The model as PostgreSQL has it (table names are the provider's, not InMemory's): no connection is made to read it.
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql("Host=localhost;Database=model;Username=u;Password=p").Options;
        using var db = new OdipDbContext(options, DemoDataPostgresFixture.SuperAdmin());
        var written = DemoTenantGuard.AdditionTypes.Concat(DemoTenantGuard.NonTenantParents.Keys).Append(typeof(AuditLog)).Distinct()
            .Select(type => db.Model.FindEntityType(type)!).ToList();
        var tableOf = written.ToDictionary(entity => entity, entity => entity.GetTableName()!);

        // Every table, once, and nothing else (no Tenants, Users or Participants, which the top-up never owns).
        Assert.Equal(tableOf.Values.OrderBy(t => t, StringComparer.Ordinal).ToList(), deletes.OrderBy(t => t, StringComparer.Ordinal).ToList());
        Assert.Equal(deletes.Count, deletes.Distinct(StringComparer.Ordinal).Count());

        // A table that points at another is deleted from before the one it points at.
        foreach (var dependent in written)
        {
            foreach (var key in dependent.GetForeignKeys().Where(k => tableOf.ContainsKey(k.PrincipalEntityType) && k.PrincipalEntityType != dependent))
            {
                var (child, parent) = (tableOf[dependent], tableOf[key.PrincipalEntityType]);
                Assert.True(deletes.IndexOf(child) < deletes.IndexOf(parent), $"{child} ({string.Join("+", key.Properties.Select(p => p.Name))}) must be deleted before {parent}");
            }
        }

        // A table outside the list that points at one of them blocks the delete (or nulls the column): the runbook has to say so, by name.
        foreach (var other in db.Model.GetEntityTypes().Where(entity => !tableOf.ContainsKey(entity)))
        {
            foreach (var key in other.GetForeignKeys().Where(k => tableOf.ContainsKey(k.PrincipalEntityType)))
                Assert.True(runbook.Contains(other.GetTableName()!, StringComparison.Ordinal), $"the runbook does not mention {other.GetTableName()}, which points at {tableOf[key.PrincipalEntityType]}");
        }
    }

    /// <summary>
    /// Independent review S2: "exactly one row, or stop" was a SELECT that only printed, so with no tenant matched the deletes of the tables that have no tenant column
    /// (incidents, staff availability) still removed every version-8 row. The purge now fails at the guard, and each of those tables is scoped through the tenant.
    /// </summary>
    [SkippableFact]
    public void ThePurge_FailsUnlessExactlyOneDemoTenantIsFound_AndScopesEveryTableWithoutATenantColumnThroughIt()
    {
        var runbook = Runbook();
        var fence = Regex.Match(runbook, "```sql\\r?\\n(?<sql>.*?)```", RegexOptions.Singleline | RegexOptions.CultureInvariant);
        Assert.True(fence.Success, "the runbook has no sql block");
        var sql = fence.Groups["sql"].Value;

        var guard = sql.IndexOf("RAISE EXCEPTION", StringComparison.Ordinal);
        var firstDelete = sql.IndexOf("DELETE FROM", StringComparison.Ordinal);
        Assert.True(guard > sql.IndexOf("CREATE TEMP TABLE demo_tenant", StringComparison.Ordinal), "no guard after the tenant is found");
        Assert.True(guard < firstDelete, "the guard must come before the first DELETE");
        Assert.Contains("<> 1", sql[..guard], StringComparison.Ordinal);

        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql("Host=localhost;Database=model;Username=u;Password=p").Options, DemoDataPostgresFixture.SuperAdmin());
        var withoutTenantColumn = DemoTenantGuard.NonTenantParents.Keys.Select(type => db.Model.FindEntityType(type)!).Where(entity => entity.FindProperty("TenantId") is null)
            .Select(entity => entity.GetTableName()!).ToList();
        Assert.NotEmpty(withoutTenantColumn);
        foreach (var table in withoutTenantColumn)
        {
            var statement = Regex.Match(sql, "DELETE FROM \"" + table + "\"[^;]*;", RegexOptions.CultureInvariant).Value;
            Assert.True(statement.Length > 0, table + " has no DELETE");
            Assert.True(statement.Contains("demo_tenant", StringComparison.Ordinal) || statement.Contains("demo_incident", StringComparison.Ordinal), table + " is not scoped through the Demo tenant: " + statement);
        }
    }

    /// <summary>
    /// PR 2 verification F1 and F6: the runbook says what the startup log says about the pack list (the line that lists the packs that will run, and the warning beside it
    /// that names a name that is not a pack and lists what will run and what stays off), and it said the opposite of what the code did. It is held to the text the service
    /// logs: each fragment it quotes has to be in the line the service writes.
    /// </summary>
    [SkippableFact]
    public async Task TheRunbook_QuotesTheStartupLineAndTheWarning_AsTheServiceLogsThem()
    {
        var runbook = Runbook();
        var log = new CapturingLogger<DemoDataHostedService>();
        var options = DemoDataOptions.FromConfiguration(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [DemoDataOptions.ScenariosKey] = "On", [DemoDataOptions.PacksKey] = "provider-settings,live-sett", [DemoDataOptions.FirstRunDelaySecondsKey] = "3600",
        }).Build());
        var maintainer = new DemoDataMaintainer(options, TimeProvider.System, new CapturingLogger<DemoDataMaintainer>(), Array.Empty<IDemoPack>(), new InProcessTickLock());
        var service = new DemoDataHostedService(Mock.Of<IServiceScopeFactory>(), maintainer, options, log);

        await service.StartAsync(CancellationToken.None);
        await service.StopAsync(CancellationToken.None);

        var startup = Assert.Single(log.Entries, e => e.Level == LogLevel.Information).Message;
        var warning = Assert.Single(log.Entries, e => e.Level == LogLevel.Warning).Message;
        foreach (var fragment in new[] { "Demo data top-up is On", "packs that will run," })
        {
            Assert.Contains(fragment, startup, StringComparison.Ordinal);
            Assert.Contains(fragment, runbook, StringComparison.Ordinal);
        }
        foreach (var fragment in new[] { "is not a pack and matches nothing", "will run", "stay off", "names no pack" })
        {
            Assert.Contains(fragment, runbook, StringComparison.Ordinal);
            if (fragment != "names no pack") Assert.Contains(fragment, warning, StringComparison.Ordinal);                  // the last is the warning for a list that is set but names nothing
        }
    }

    /// <summary>PR 2 verification F6: how to enable the six packs PR 2 adds, from the plan the verification set out: the census first, the hours, the order, the restart, the checks.</summary>
    [SkippableFact]
    public void TheRunbooksEnablingSection_NamesEveryPr2Pack_AndTheCensusTheHoursTheRestartAndTheChecksAfterwards()
    {
        var runbook = Runbook();
        var section = Regex.Match(runbook, "## Enabling the PR 2 packs(?<body>.*?)(\\r?\\n## |$)", RegexOptions.Singleline | RegexOptions.CultureInvariant);
        Assert.True(section.Success, "the runbook has no section on enabling the PR 2 packs");
        var body = section.Groups["body"].Value;

        var pr2 = DemoPacks.Names.SkipWhile(name => name != "leave-coverage-tasks").Skip(1).ToList();                 // the packs after PR 1's last
        Assert.Equal(6, pr2.Count);
        Assert.All(pr2, name => Assert.Contains($"`{name}`", body, StringComparison.Ordinal));
        foreach (var fragment in new[] { "census", "06:30", "21:30", "clock change", "together", "restart", "0 packs failed", "skipped stories", "tz database" })
            Assert.Contains(fragment, body, StringComparison.OrdinalIgnoreCase);
    }

    [SkippableFact]
    public void TheComposeFile_PassesTheTwoSwitchesToTheApi()
    {
        var compose = ReadOrSkip("deploy", "compose.yaml");

        Assert.Contains("- DemoData__Scenarios=${DEMO_DATA_SCENARIOS:-Off}", compose, StringComparison.Ordinal);
        Assert.Contains("- DemoData__Packs=${DEMO_DATA_PACKS:-}", compose, StringComparison.Ordinal);
    }
}
