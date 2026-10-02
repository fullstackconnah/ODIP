using System.Collections;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The rules PostgreSQL enforces and EF InMemory does not, checked against the rows of a full run using the model's own metadata: every
/// string fits its column (MaxLength), every NOT NULL column has a value, every foreign key points at a row that exists, and every unique
/// index holds. A value or row the real database would reject fails here, locally and in the image build, instead of as a failed tick on the
/// host; the Postgres-backed tests (DemoDataPostgresTests) are the final proof where a server is available.
/// </summary>
public class DemoRelationalRulesTests
{
    [Fact]
    public async Task EveryValueTheTopUpWrites_FitsItsColumn()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        await using (var before = env.AdminDb()) Assert.True(DemoSnapshot.Take(before).Count > 0);
        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
        Assert.Empty(result.Failures);

        await AssertValuesFitAsync(env);
    }

    /// <summary>Every string of every row fits its column and every NOT NULL column has a value (the environment has already had its tick).</summary>
    internal static async Task AssertValuesFitAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        var set = typeof(DbContext).GetMethods().First(m => m.Name == nameof(DbContext.Set) && m.IsGenericMethodDefinition && m.GetParameters().Length == 0);
        var ignoreFilters = typeof(EntityFrameworkQueryableExtensions).GetMethods().First(m => m.Name == nameof(EntityFrameworkQueryableExtensions.IgnoreQueryFilters) && m.IsGenericMethodDefinition);
        var problems = new List<string>();
        var rowsChecked = 0;

        foreach (var entityType in db.Model.GetEntityTypes().Where(t => !t.IsOwned() && !t.ClrType.IsAbstract && t.FindPrimaryKey() is not null))
        {
            var rows = (IEnumerable)ignoreFilters.MakeGenericMethod(entityType.ClrType).Invoke(null, new[] { set.MakeGenericMethod(entityType.ClrType).Invoke(db, null) })!;
            foreach (var row in rows)
            {
                rowsChecked++;
                foreach (var property in entityType.GetProperties().Where(p => p.PropertyInfo is not null))
                {
                    var value = property.PropertyInfo!.GetValue(row);
                    var where = $"{entityType.ClrType.Name}.{property.Name}";
                    if (value is null)
                    {
                        if (!property.IsNullable && !property.IsPrimaryKey())
                            problems.Add($"{where} is null but the column is NOT NULL");
                        continue;
                    }
                    if (value is string text && property.GetMaxLength() is int max && text.Length > max)
                        problems.Add($"{where} is {text.Length} characters but the column holds {max}: '{text[..Math.Min(40, text.Length)]}...'");
                }
            }
        }

        Assert.True(rowsChecked > 300, $"only {rowsChecked} rows were checked");
        Assert.True(problems.Count == 0, string.Join("\n", problems.Distinct().Take(15)));
    }

    /// <summary>
    /// InMemory does not enforce foreign keys either. After a full run, every foreign-key value of every row must point at a row that exists
    /// (single-column keys, which is every key the top-up writes), so PostgreSQL's constraints cannot reject an insert on the host.
    /// </summary>
    [Fact]
    public async Task EveryForeignKeyOfEveryRow_PointsAtARowThatExists()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
        Assert.Empty(result.Failures);

        await AssertForeignKeysAsync(env);
    }

    /// <param name="skipPrincipals">Principal tables whose rows are not in this database for a reason that is not the top-up's (the real seed's default tenant is made by a migration, which InMemory never runs).</param>
    internal static async Task AssertForeignKeysAsync(DemoTestEnv env, params Type[] skipPrincipals)
    {
        await using var db = env.AdminDb();
        var set = typeof(DbContext).GetMethods().First(m => m.Name == nameof(DbContext.Set) && m.IsGenericMethodDefinition && m.GetParameters().Length == 0);
        var ignoreFilters = typeof(EntityFrameworkQueryableExtensions).GetMethods().First(m => m.Name == nameof(EntityFrameworkQueryableExtensions.IgnoreQueryFilters) && m.IsGenericMethodDefinition);
        List<object> RowsOf(IEntityType type) => ((IEnumerable)ignoreFilters.MakeGenericMethod(type.ClrType).Invoke(null, new[] { set.MakeGenericMethod(type.ClrType).Invoke(db, null) })!).Cast<object>().ToList();

        var entityTypes = db.Model.GetEntityTypes().Where(t => !t.IsOwned() && !t.ClrType.IsAbstract && t.FindPrimaryKey() is not null).ToList();
        var existing = new Dictionary<IEntityType, HashSet<object>>();
        HashSet<object> KeysOf(IEntityType principal, IProperty keyProperty)
        {
            if (!existing.TryGetValue(principal, out var keys))
                existing[principal] = keys = RowsOf(principal).Select(r => keyProperty.PropertyInfo!.GetValue(r)).Where(v => v is not null).Select(v => v!).ToHashSet();
            return keys;
        }

        var problems = new List<string>();
        var checkedKeys = 0;
        foreach (var entityType in entityTypes)
        {
            foreach (var foreignKey in entityType.GetForeignKeys().Where(f => f.Properties.Count == 1 && f.Properties[0].PropertyInfo is not null && f.PrincipalKey.Properties.Count == 1
                                                                              && !skipPrincipals.Contains(f.PrincipalEntityType.ClrType)))
            {
                var dependent = foreignKey.Properties[0];
                var principalKey = foreignKey.PrincipalKey.Properties[0];
                if (principalKey.PropertyInfo is null) continue;
                var principals = KeysOf(foreignKey.PrincipalEntityType, principalKey);
                foreach (var row in RowsOf(entityType))
                {
                    var value = dependent.PropertyInfo!.GetValue(row);
                    if (value is null) continue;
                    checkedKeys++;
                    if (!principals.Contains(value))
                        problems.Add($"{entityType.ClrType.Name}.{dependent.Name} = {value} has no {foreignKey.PrincipalEntityType.ClrType.Name}");
                }
            }
        }

        Assert.True(checkedKeys > 300, $"only {checkedKeys} foreign-key values were checked");
        Assert.True(problems.Count == 0, string.Join(Environment.NewLine, problems.Distinct().Take(15)));
    }

    /// <summary>
    /// InMemory does not enforce unique indexes. After a full run, every unique index the model declares holds across the rows (a duplicate
    /// compatibility cell, a second active completion for a shift, a repeated obligation SourceKey would be rejected by PostgreSQL).
    /// Partial indexes with the three filter shapes in this model ("IsActive", "X IS NOT NULL", "X IS NULL") are evaluated; any other filter fails the test
    /// loudly so a new one gets a rule here instead of being skipped.
    /// </summary>
    [Fact]
    public async Task EveryUniqueIndex_HoldsAcrossAllTheRows()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
        Assert.Empty(result.Failures);

        await AssertUniqueIndexesAsync(env);
    }

    internal static async Task AssertUniqueIndexesAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        var set = typeof(DbContext).GetMethods().First(m => m.Name == nameof(DbContext.Set) && m.IsGenericMethodDefinition && m.GetParameters().Length == 0);
        var ignoreFilters = typeof(EntityFrameworkQueryableExtensions).GetMethods().First(m => m.Name == nameof(EntityFrameworkQueryableExtensions.IgnoreQueryFilters) && m.IsGenericMethodDefinition);
        var problems = new List<string>();
        var indexesChecked = 0;

        // Only the tables the top-up may write (the guard's allow-list): other tables' indexes are other people's, and may use filter shapes this test does not know.
        var writable = DemoTenantGuard.AdditionTypes.Concat(DemoTenantGuard.NonTenantParents.Keys).ToHashSet();
        foreach (var entityType in db.Model.GetEntityTypes().Where(t => writable.Contains(t.ClrType) && t.FindPrimaryKey() is not null))
        {
            var unique = entityType.GetIndexes().Where(i => i.IsUnique && i.Properties.All(p => p.PropertyInfo is not null)).ToList();
            if (unique.Count == 0) continue;
            var rows = ((IEnumerable)ignoreFilters.MakeGenericMethod(entityType.ClrType).Invoke(null, new[] { set.MakeGenericMethod(entityType.ClrType).Invoke(db, null) })!).Cast<object>().ToList();

            foreach (var index in unique)
            {
                var filter = index.GetFilter()?.Trim();
                Func<object, bool> applies = _ => true;
                if (filter is not null)
                {
                    var match = System.Text.RegularExpressions.Regex.Match(filter, "^\"(?<name>\\w+)\"( IS (?<not>NOT )?NULL)?$");
                    Assert.True(match.Success, $"{entityType.ClrType.Name}: unique index filter '{filter}' has no rule in this test");
                    var column = entityType.GetProperties().Single(p => p.Name == match.Groups["name"].Value).PropertyInfo!;
                    applies = !match.Groups[2].Success ? (row => column.GetValue(row) is true)
                        : match.Groups["not"].Success ? (row => column.GetValue(row) is not null)
                        : (row => column.GetValue(row) is null);
                }

                var groups = rows.Where(applies)
                    .Select(row => (Row: row, Key: string.Join("|", index.Properties.Select(p => p.PropertyInfo!.GetValue(row)?.ToString() ?? "-"))))
                    .Where(x => !index.Properties.Any(p => p.PropertyInfo!.GetValue(x.Row) is null))
                    .GroupBy(x => x.Key).Where(g => g.Count() > 1).ToList();
                indexesChecked++;
                foreach (var duplicate in groups.Take(3))
                    problems.Add($"{entityType.ClrType.Name} ({string.Join(",", index.Properties.Select(p => p.Name))}) has {duplicate.Count()} rows with {duplicate.Key}");
            }
        }

        Assert.True(indexesChecked >= 3, $"only {indexesChecked} unique indexes were checked");
        Assert.True(problems.Count == 0, string.Join(Environment.NewLine, problems));
    }
}
