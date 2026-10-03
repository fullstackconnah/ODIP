using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Metadata;
using Npgsql;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;

namespace Odip.Tests.DemoData;

/// <summary>
/// Makes EF InMemory refuse what PostgreSQL would: a row that breaks one of the model's unique indexes. InMemory enforces none of them, so a demo test
/// could pass while a pack inserts a second handover acknowledgement, a second running break or a second tick for a pair that already has one (a person's
/// own row, with a random id, beside the script's, with a deterministic one), and the first anyone would hear of it was a pack that rolls back for good on
/// the host (PR 2 review finding H1). Every <see cref="DemoTestEnv"/> carries one, so every demo test now meets the indexes.
///
/// It follows the database's rules for what the model declares: a key with a NULL part never conflicts (NULLs are distinct), a filtered index only holds
/// the rows its filter selects ("X" IS NULL, "X" IS NOT NULL, a boolean column, "X" IN (...) are understood; anything else throws, so a new kind of filter
/// is noticed rather than ignored), text compares case-sensitively, and a row being replaced or deleted by the same save frees its key. The violation is
/// the one Npgsql raises, a DbUpdateException around a PostgresException with state 23505 and the index's name, so the maintainer classifies it as it
/// would on the server.
///
/// It reads the stored rows through a second context on the same database, because a query on the context that is saving would be a second operation on it.
/// </summary>
internal sealed class UniqueIndexEmulator : SaveChangesInterceptor
{
    /// <summary>The options of the database the interceptor guards (set once they exist: the interceptor is part of building them).</summary>
    public DbContextOptions<OdipDbContext>? Options { get; set; }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is { } context) Check(context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } context) Check(context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private void Check(DbContext context)
    {
        if (Options is null) return;

        var changed = context.ChangeTracker.Entries().Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted).ToList();
        foreach (var ofType in changed.GroupBy(e => e.Metadata))
        {
            var entityType = ofType.Key;
            var indexes = entityType.GetIndexes().Where(i => i.IsUnique).ToList();
            if (indexes.Count == 0) continue;

            var deleted = ofType.Where(e => e.State == EntityState.Deleted).Select(PrimaryKey).ToHashSet(StringComparer.Ordinal);
            var written = ofType.Where(e => e.State != EntityState.Deleted).ToList();
            var writtenKeys = written.Select(PrimaryKey).ToHashSet(StringComparer.Ordinal);
            List<object>? stored = null;

            foreach (var index in indexes)
            {
                // Only a row that is new, or one whose indexed columns (or the columns its filter looks at) change, can break the index.
                var columns = index.Properties.Select(p => p.Name).Concat(FilterColumns(index)).ToHashSet(StringComparer.Ordinal);
                var checking = written.Where(e => e.State == EntityState.Added || columns.Any(c => e.Property(c).IsModified)).ToList();
                if (checking.Count == 0) continue;
                stored ??= LoadRows(entityType);

                var holders = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var row in stored)
                {
                    var rowKey = PrimaryKey(entityType, row);
                    if (deleted.Contains(rowKey) || writtenKeys.Contains(rowKey)) continue;                  // this save replaces or removes it
                    if (IndexKey(index, p => p.GetGetter().GetClrValue(row)) is { } key) holders[key] = rowKey;
                }
                foreach (var entry in written)
                {
                    if (IndexKey(index, p => entry.Property(p.Name).CurrentValue) is not { } key) continue;
                    var own = PrimaryKey(entry);
                    if (holders.TryGetValue(key, out var holder) && holder != own) throw Violation(entityType, index, key);
                    holders[key] = own;
                }
            }
        }
    }

    // ── what an index holds ──

    /// <summary>The key a row has in the index, or null when it is not in it (its filter excludes it, or a part is NULL).</summary>
    internal static string? IndexKey(IIndex index, Func<IProperty, object?> valueOf)
    {
        if (!HoldsRow(index, valueOf)) return null;
        var parts = new List<string>();
        foreach (var property in index.Properties)
        {
            if (Text(valueOf(property)) is not { } part) return null;
            parts.Add(part);
        }
        return string.Join("\u001f", parts);
    }

    private static IEnumerable<string> FilterColumns(IIndex index) =>
        index.GetFilter() is { } filter ? Regex.Matches(filter, "\"(?<c>\\w+)\"").Select(m => m.Groups["c"].Value) : Enumerable.Empty<string>();

    private static readonly Regex NotNull = new("^\"(?<c>\\w+)\" IS NOT NULL$", RegexOptions.CultureInvariant);
    private static readonly Regex IsNull = new("^\"(?<c>\\w+)\" IS NULL$", RegexOptions.CultureInvariant);
    private static readonly Regex Flag = new("^\"(?<c>\\w+)\"$", RegexOptions.CultureInvariant);
    private static readonly Regex OneOf = new("^\"(?<c>\\w+)\" IN \\((?<v>[0-9, ]+)\\)$", RegexOptions.CultureInvariant);

    private static bool HoldsRow(IIndex index, Func<IProperty, object?> valueOf)
    {
        if (index.GetFilter() is not { } filter) return true;
        filter = Regex.Replace(filter.Trim(), "\\s+", " ");

        object? Column(string name) => valueOf(index.DeclaringEntityType.FindProperty(name)
            ?? throw new NotSupportedException($"The filter of {index.DeclaringEntityType.DisplayName()}'s unique index names a column ({name}) that is not a property."));

        if (NotNull.Match(filter) is { Success: true } notNull) return Column(notNull.Groups["c"].Value) is not null;
        if (IsNull.Match(filter) is { Success: true } isNull) return Column(isNull.Groups["c"].Value) is null;
        if (Flag.Match(filter) is { Success: true } flag) return Column(flag.Groups["c"].Value) is true;
        if (OneOf.Match(filter) is { Success: true } oneOf)
        {
            var value = Column(oneOf.Groups["c"].Value);
            var allowed = oneOf.Groups["v"].Value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(v => long.Parse(v, CultureInfo.InvariantCulture));
            return value is not null && allowed.Contains(Convert.ToInt64(value, CultureInfo.InvariantCulture));
        }
        throw new NotSupportedException($"The unique-index emulator does not understand the filter {filter} on {index.DeclaringEntityType.DisplayName()}: teach it before relying on it.");
    }

    private static string? Text(object? value) => value switch
    {
        null => null,
        DateTime moment => moment.Ticks.ToString(CultureInfo.InvariantCulture),
        DateTimeOffset moment => moment.UtcTicks.ToString(CultureInfo.InvariantCulture),
        Enum choice => Convert.ToInt64(choice, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString(),
    };

    private static string PrimaryKey(EntityEntry entry) =>
        string.Join("\u001f", entry.Metadata.FindPrimaryKey()!.Properties.Select(p => Text(entry.Property(p.Name).CurrentValue) ?? string.Empty));

    private static string PrimaryKey(IEntityType entityType, object row) =>
        string.Join("\u001f", entityType.FindPrimaryKey()!.Properties.Select(p => Text(p.GetGetter().GetClrValue(row)) ?? string.Empty));

    // ── the stored rows ──

    private List<object> LoadRows(IEntityType entityType) =>
        (List<object>)typeof(UniqueIndexEmulator).GetMethod(nameof(LoadRowsOf), BindingFlags.Instance | BindingFlags.NonPublic)!
            .MakeGenericMethod(entityType.ClrType).Invoke(this, null)!;

    private List<object> LoadRowsOf<T>() where T : class
    {
        using var db = new OdipDbContext(Options!, new ScopedTenantOverride { IsSuperAdmin = true });
        return db.Set<T>().IgnoreQueryFilters().AsNoTracking().Cast<object>().ToList();
    }

    // ── the refusal ──

    private static DbUpdateException Violation(IEntityType entityType, IIndex index, string key)
    {
        var name = NameOf(index);
        var message = $"duplicate key value violates unique constraint \"{name}\" ({entityType.DisplayName()}, key {key.Replace('\u001f', '/')})";
        var columns = string.Join(", ", index.Properties.Select(p => p.Name));
        var inner = new PostgresException(message, "ERROR", "ERROR", PostgresErrorCodes.UniqueViolation, detail: $"Key ({columns})=({key.Replace('\u001f', ',')}) already exists.",
            constraintName: name, tableName: entityType.GetTableName());
        return new DbUpdateException("An error occurred while saving the entity changes. See the inner exception for details.", inner);
    }

    /// <summary>The index's name in the database: the one the model gives it, or the default Npgsql would create.</summary>
    internal static string NameOf(IIndex index)
    {
        try
        {
            return index.GetDatabaseName() ?? Default(index);
        }
        catch (InvalidOperationException)
        {
            return Default(index);
        }

        static string Default(IIndex index) =>
            "IX_" + (index.DeclaringEntityType.GetTableName() ?? index.DeclaringEntityType.ShortName()) + "_" + string.Join("_", index.Properties.Select(p => p.Name));
    }
}
