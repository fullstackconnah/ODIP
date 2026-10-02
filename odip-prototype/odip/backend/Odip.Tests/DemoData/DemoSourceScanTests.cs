using System.Text.RegularExpressions;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// Review finding L4: the guard (<c>DemoTenantGuard</c>) runs inside <c>SaveChanges</c>, so anything that writes without SaveChanges, or
/// through a context the guard is not attached to, walks straight round it. Today nothing under DemoData does. This reads the source and
/// keeps it that way: no raw SQL, no set-based update or delete, no second context, no query that ignores the tenant filter, no Remove, except
/// in the few files whose job that is. A later pack that wants one of these has to add its file here, in a PR a reviewer reads, instead of
/// quietly writing outside the guard.
///
/// It reads the source tree, so it skips where the tree is not there (it is in the Docker image build's context, but the rule is the same as
/// for the other source scans: a skip must never be a failure).
/// </summary>
public class DemoSourceScanTests
{
    /// <summary>A construct the demo top-up must not use, why, and the files (relative to Odip.Infrastructure) that may.</summary>
    private sealed record Rule(string Pattern, string Why, params string[] AllowedIn);

    private static readonly Rule[] Rules =
    {
        new(@"\bExecuteSql\w*", "raw SQL runs without SaveChanges, so the guard never sees it"),
        new(@"\bFromSql\w*", "raw SQL reads whatever it names, whatever the tenant filter says"),
        new(@"\bSqlQuery\w*", "raw SQL reads whatever it names, whatever the tenant filter says"),
        new(@"\bExecuteUpdate\w*", "a set-based UPDATE runs without SaveChanges, so the guard never sees it"),
        new(@"\bExecuteDelete\w*", "a set-based DELETE runs without SaveChanges, and the top-up never deletes"),
        // The two private dictionaries that forget a stamp / a conflict count are the only in-memory removals; name any other here.
        new(@"\bRemoveRange\b|(?<!_stamps|_conflictStreak)\.Remove\(", "the top-up never deletes anything (the guard refuses it too)"),
        new(@"\bnew\s+OdipDbContext\b", "a context the guard is not attached to can write anything; only the maintainer builds the two it needs",
            "DemoData/DemoDataMaintainer.cs"),
        new(@"\bIgnoreQueryFilters\b", "it reads every tenant's rows; only the id probe, which must see a collision wherever it is, does",
            "DemoData/DemoQueries.cs"),
        new(@"\bNpgsqlCommand\b|\bDbCommand\b", "a hand-written command is raw SQL; only the advisory lock needs one", "DemoData/DemoTickLock.cs"),
    };

    private static string? FindInfrastructureRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
        {
            var parent = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
            if (parent == dir) return null;
            dir = parent;
        }
        var root = dir is null ? null : Path.Combine(dir, "Odip.Infrastructure");
        return root is not null && Directory.Exists(Path.Combine(root, "DemoData")) ? root : null;
    }

    /// <summary>The source with comments removed, so a rule is not tripped by a sentence that names what it forbids.</summary>
    private static string WithoutComments(string source)
    {
        var withoutBlocks = Regex.Replace(source, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
        return Regex.Replace(withoutBlocks, @"//.*$", string.Empty, RegexOptions.Multiline);
    }

    private static IEnumerable<(string Path, string Code)> DemoSources(string root) =>
        Directory.EnumerateFiles(Path.Combine(root, "DemoData"), "*.cs", SearchOption.AllDirectories)
            .Append(Path.Combine(root, "BackgroundServices", "DemoDataHostedService.cs"))
            .Where(File.Exists)
            .Select(path => (Path.GetRelativePath(root, path).Replace('\\', '/'), WithoutComments(File.ReadAllText(path))));

    [SkippableFact]
    public void NothingUnderDemoData_WritesOutsideTheGuard_OrReadsAcrossTenants()
    {
        var root = FindInfrastructureRoot();
        Skip.If(root is null, "the Odip.Infrastructure source tree is not next to the test assembly");

        var sources = DemoSources(root!).ToList();
        Assert.True(sources.Count >= 20, $"expected the demo-data sources, found {sources.Count}");

        var offences = new List<string>();
        foreach (var (path, code) in sources)
        {
            foreach (var rule in Rules)
            {
                if (rule.AllowedIn.Contains(path)) continue;
                foreach (Match match in Regex.Matches(code, rule.Pattern))
                    offences.Add($"{path}: '{match.Value.Trim()}' - {rule.Why}");
            }
        }

        Assert.True(offences.Count == 0, "the demo top-up must not write or read outside its guard:\n" + string.Join("\n", offences.Distinct()));
    }

    [SkippableFact]
    public void TheAllowances_AreStillNeeded_SoTheListCannotGrowStale()
    {
        var root = FindInfrastructureRoot();
        Skip.If(root is null, "the Odip.Infrastructure source tree is not next to the test assembly");

        var sources = DemoSources(root!).ToDictionary(s => s.Path, s => s.Code);
        foreach (var rule in Rules)
        {
            foreach (var allowed in rule.AllowedIn)
            {
                Assert.True(sources.TryGetValue(allowed, out var code), $"{allowed} is allowed to use {rule.Pattern} but the file is gone");
                Assert.True(Regex.IsMatch(code!, rule.Pattern), $"{allowed} no longer uses {rule.Pattern}: take it off the allowance");
            }
        }
    }

    [Fact]
    public void TheCommentStripper_DoesNotHideCode_AndDoesNotReadProseAsCode()
    {
        var code = WithoutComments("""
            // ExecuteSql in a comment
            /* IgnoreQueryFilters in a block */ var x = db.Set<T>().IgnoreQueryFilters(); // and Remove( here
            /// <summary>new OdipDbContext</summary>
            """);

        Assert.Contains("IgnoreQueryFilters", code);
        Assert.DoesNotContain("ExecuteSql", code);
        Assert.DoesNotContain("Remove(", code);
        Assert.DoesNotContain("OdipDbContext", code);
    }
}
