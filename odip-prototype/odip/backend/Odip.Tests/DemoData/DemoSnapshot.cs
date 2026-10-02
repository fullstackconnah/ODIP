using System.Collections;
using System.Globalization;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Odip.Infrastructure.Data;

namespace Odip.Tests.DemoData;

/// <summary>
/// Every row of every table, as "Type|primary key" to a property-by-property rendering, so a test can say "nothing else changed" and
/// name what did. It reads with query filters off (every tenant, every global table) and without tracking. Used by the idempotency
/// test (T1: a hash over every column of every row is unchanged), the old-seed test (T3), tenant isolation (T5) and owner edits (T12).
/// </summary>
internal sealed class DemoSnapshot
{
    private readonly Dictionary<string, Dictionary<string, string>> _rows;

    private DemoSnapshot(Dictionary<string, Dictionary<string, string>> rows) => _rows = rows;

    public int Count => _rows.Count;

    public IEnumerable<string> Keys => _rows.Keys;

    public IReadOnlyDictionary<string, string>? Row(string key) => _rows.GetValueOrDefault(key);

    public int CountOf(string typeName) => _rows.Keys.Count(k => k.StartsWith(typeName + "|", StringComparison.Ordinal));

    public static string TypeOf(string key) => key[..key.IndexOf('|')];

    public static string KeyOf(Type type, Guid id) => $"{type.Name}|{id:D}";

    public static DemoSnapshot Take(OdipDbContext db)
    {
        var rows = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
        var set = typeof(DbContext).GetMethods().First(m => m.Name == nameof(DbContext.Set) && m.IsGenericMethodDefinition && m.GetParameters().Length == 0);
        var ignoreFilters = typeof(EntityFrameworkQueryableExtensions).GetMethods()
            .First(m => m.Name == nameof(EntityFrameworkQueryableExtensions.IgnoreQueryFilters) && m.IsGenericMethodDefinition);
        var asNoTracking = typeof(EntityFrameworkQueryableExtensions).GetMethods()
            .First(m => m.Name == nameof(EntityFrameworkQueryableExtensions.AsNoTracking) && m.IsGenericMethodDefinition && m.GetParameters().Length == 1);

        foreach (var entityType in db.Model.GetEntityTypes())
        {
            var key = entityType.FindPrimaryKey();
            if (key is null || entityType.IsOwned() || entityType.ClrType.IsAbstract) continue;
            if (!entityType.GetProperties().Any()) continue;

            var query = (IEnumerable)asNoTracking.MakeGenericMethod(entityType.ClrType).Invoke(null,
                new[] { ignoreFilters.MakeGenericMethod(entityType.ClrType).Invoke(null, new[] { set.MakeGenericMethod(entityType.ClrType).Invoke(db, null) }) })!;
            foreach (var row in query)
            {
                var id = string.Join("+", key.Properties.Select(p => Render(p.PropertyInfo?.GetValue(row))));
                var values = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var property in entityType.GetProperties().Where(p => p.PropertyInfo is not null))
                    values[property.Name] = Render(property.PropertyInfo!.GetValue(row));
                rows[$"{entityType.ClrType.Name}|{id}"] = values;
            }
        }
        return new DemoSnapshot(rows);
    }

    /// <summary>The rows whose key passes <paramref name="keep"/>.</summary>
    public DemoSnapshot Where(Func<string, bool> keep) =>
        new(_rows.Where(kv => keep(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal));

    public sealed record Change(string Key, string Kind, IReadOnlyList<string> Properties);

    /// <summary>What happened between this snapshot and <paramref name="after"/>: rows added, rows removed, and the properties that changed on rows present in both.</summary>
    public List<Change> Diff(DemoSnapshot after)
    {
        var changes = new List<Change>();
        foreach (var (key, values) in _rows)
        {
            if (!after._rows.TryGetValue(key, out var next))
            {
                changes.Add(new Change(key, "removed", Array.Empty<string>()));
                continue;
            }
            var changed = values.Where(kv => !next.TryGetValue(kv.Key, out var v) || v != kv.Value).Select(kv => kv.Key).OrderBy(n => n, StringComparer.Ordinal).ToList();
            if (changed.Count > 0) changes.Add(new Change(key, "changed", changed));
        }
        foreach (var key in after._rows.Keys.Where(k => !_rows.ContainsKey(k)))
            changes.Add(new Change(key, "added", Array.Empty<string>()));
        return changes;
    }

    public static string Describe(IEnumerable<Change> changes, int max = 8) =>
        string.Join("; ", changes.Take(max).Select(c => $"{c.Key} {c.Kind}{(c.Properties.Count > 0 ? " [" + string.Join(",", c.Properties) + "]" : string.Empty)}"));

    private static string Render(object? value) => value switch
    {
        null => "∅",
        DateTime dt => dt.ToString("O", CultureInfo.InvariantCulture),
        DateTimeOffset dto => dto.ToString("O", CultureInfo.InvariantCulture),
        DateOnly d => d.ToString("O", CultureInfo.InvariantCulture),
        TimeOnly t => t.ToString("O", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        IEnumerable e and not string => "[" + string.Join(",", e.Cast<object?>().Select(Render)) + "]",
        _ => value.ToString() ?? string.Empty,
    };
}
