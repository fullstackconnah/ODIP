using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
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

    [SkippableFact]
    public void TheComposeFile_PassesTheTwoSwitchesToTheApi()
    {
        var compose = ReadOrSkip("deploy", "compose.yaml");

        Assert.Contains("- DemoData__Scenarios=${DEMO_DATA_SCENARIOS:-Off}", compose, StringComparison.Ordinal);
        Assert.Contains("- DemoData__Packs=${DEMO_DATA_PACKS:-}", compose, StringComparison.Ordinal);
    }
}
