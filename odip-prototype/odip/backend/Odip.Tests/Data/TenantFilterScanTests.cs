using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Tests.Imports;
using Xunit;

namespace Odip.Tests.Data;

/// <summary>
/// The tenant filter is named "Tenant", and every bypass names it (<c>IgnoreQueryFilters(["Tenant"])</c>). With one filter per entity an argument-less
/// <c>IgnoreQueryFilters()</c> is the same thing today; the day a second filter (archived, soft-delete) is added it would silently drop that one too.
/// This keeps a new unreviewed bypass out, and keeps a new tenant entity from forgetting its filter. Like the other source scans, it skips where the
/// source tree is not next to the test assembly.
/// </summary>
public class TenantFilterScanTests
{
    /// <summary>Files (relative to the backend folder) that may call IgnoreQueryFilters() with no names. Empty on purpose: a reviewer reads any addition.</summary>
    private static readonly string[] BareBypassAllowed = [];

    private static string? FindBackendRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
        {
            var parent = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
            if (parent == dir) return null;
            dir = parent;
        }
        return dir;
    }

    private static IReadOnlyList<IEntityType> Roots()
    {
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        using var db = new OdipDbContext(options, ImportTestSupport.Tenant(Guid.NewGuid()));
        return db.Model.GetEntityTypes().Where(t => t.BaseType is null).ToList();
    }

    [SkippableFact]
    public void NoProductionCode_IgnoresQueryFilters_WithoutNamingWhichOnes()
    {
        var root = FindBackendRoot();
        Skip.If(root is null, "the backend source tree is not next to the test assembly");

        var offences = new List<string>();
        var scanned = 0;
        foreach (var project in new[] { "Odip.Api", "Odip.Application", "Odip.Infrastructure" })
        {
            foreach (var path in Directory.EnumerateFiles(Path.Combine(root!, project), "*.cs", SearchOption.AllDirectories))
            {
                var rel = Path.GetRelativePath(root!, path).Replace('\\', '/');
                if (rel.Contains("/bin/") || rel.Contains("/obj/") || rel.Contains("/Migrations/")) continue;
                scanned++;
                if (BareBypassAllowed.Contains(rel)) continue;
                if (CallsIgnoreQueryFiltersWithoutNames(File.ReadAllText(path))) offences.Add(rel);
            }
        }

        Assert.True(scanned > 100, $"expected the backend sources, scanned {scanned}");
        Assert.True(offences.Count == 0, "name the filter you bypass, IgnoreQueryFilters([TenantFilter.Name]):\n" + string.Join("\n", offences));
    }

    private static bool CallsIgnoreQueryFiltersWithoutNames(string source)
    {
        // shortcut: a "//" after a space inside a string literal still hides the rest of that line, upgrade to a real lexer if a bypass ever hides there
        var code = Regex.Replace(Regex.Replace(source, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline), @"(?<!\S)//.*$", string.Empty, RegexOptions.Multiline);
        return Regex.IsMatch(code, @"\bIgnoreQueryFilters\s*(<[^()]*>)?\s*\(\s*\)");
    }

    [Theory]
    [InlineData("db.Users.IgnoreQueryFilters();", true)]
    [InlineData("db.Users.IgnoreQueryFilters<User>();", true)]
    [InlineData("db.Users.IgnoreQueryFilters([TenantFilter.Name]);", false)]
    [InlineData("var u = \"https://example.test\"; db.Users.IgnoreQueryFilters();", true)]
    public void BypassMatcher_CatchesUnnamedCalls_AndPassesNamedOnes(string line, bool expected) =>
        Assert.Equal(expected, CallsIgnoreQueryFiltersWithoutNames(line));

    [Fact]
    public void EveryTenantEntity_HasTheNamedTenantFilter()
    {
        var missing = Roots()
            .Where(t => typeof(ITenantEntity).IsAssignableFrom(t.ClrType))
            .Where(t => !t.GetDeclaredQueryFilters().Any(f => f.Key == "Tenant"))
            .Select(t => t.ClrType.Name)
            .ToList();

        Assert.True(missing.Count == 0, "tenant entities with no \"Tenant\" query filter: " + string.Join(", ", missing));
    }

    [Fact]
    public void NoEntity_HasAnAnonymousQueryFilter()
    {
        var anonymous = Roots()
            .Where(t => t.GetDeclaredQueryFilters().Any(f => f.Key is null))
            .Select(t => t.ClrType.Name)
            .ToList();

        Assert.True(anonymous.Count == 0, "name the filter, HasQueryFilter(TenantFilter.Name, ...): " + string.Join(", ", anonymous));
    }
}
