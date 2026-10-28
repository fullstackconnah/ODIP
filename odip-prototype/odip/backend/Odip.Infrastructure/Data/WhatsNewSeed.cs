using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

/// <summary>
/// The What's new entries that ship in code. Add one file per user-facing PR in WhatsNewItems/. Never edit or remove a shipped key: the seeder only inserts
/// missing keys, so a change here would never reach the database, and admins own the text after insert. Oldest first: the shipped items by Order, later ones by key.
/// </summary>
public static partial class WhatsNewSeed
{
    public sealed record Item(string Key, string Title, string Body, WhatsNewAudience Roles, bool Important);

    private const WhatsNewAudience Staff = WhatsNewAudience.Admin | WhatsNewAudience.Coordinator;

    /// <summary>An item and where it sits in the list. The shipped items have 1..44; a new item leaves Order out and goes after them, by key.</summary>
    private sealed record Entry(int Order, Item Item)
    {
        public Entry(Item item) : this(Later, item) { }
    }

    private const int Later = 1000;

    public static readonly IReadOnlyList<Item> All;

    // Items are one static field each in WhatsNewItems/. A static constructor runs after every field initialiser in every part of the class.
    static WhatsNewSeed() =>
        All = typeof(WhatsNewSeed).GetFields(BindingFlags.Static | BindingFlags.NonPublic)
            .Where(f => f.FieldType == typeof(Entry)).Select(f => (Entry)f.GetValue(null)!)
            .OrderBy(e => e.Order).ThenBy(e => e.Item.Key, StringComparer.Ordinal).Select(e => e.Item).ToList();

    /// <summary>Inserts the keys the table lacks, one save each, so a key another instance inserted first costs only that row.</summary>
    public static async Task SeedWhatsNewAsync(OdipDbContext db, DateTime utcNow, CancellationToken ct = default)
    {
        db.AuditActorName = "Bunya Support release"; // named system actor on the audit rows; the last seeder, so no reset needed
        var have = (await db.WhatsNewEntries.Select(e => e.Key).ToListAsync(ct)).ToHashSet(StringComparer.Ordinal);
        var missing = All.Where(i => !have.Contains(i.Key)).ToList();
        for (var j = 0; j < missing.Count; j++)
        {
            var i = missing[j];
            db.WhatsNewEntries.Add(new WhatsNewEntry
            {
                Id = Guid.NewGuid(), Key = i.Key, Title = i.Title, Body = i.Body, Roles = i.Roles, Important = i.Important,
                CreatedAt = utcNow, UpdatedAt = utcNow,
                // oldest first in All, so the last one is newest; 1 ms apart keeps the list order stable
                PublishedAtUtc = utcNow.AddMilliseconds(j - (missing.Count - 1)),
            });
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            { db.ChangeTracker.Clear(); } // another instance inserted this key first; Clear also drops the audit row queued for it
        }
    }
}
