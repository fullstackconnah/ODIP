using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

/// <summary>
/// The What's new entries that ship in code. Append one entry per user-facing PR. Never edit or remove a shipped key: the seeder only inserts
/// missing keys, so a change here would never reach the database, and admins own the text after insert. Oldest first.
/// </summary>
public static class WhatsNewSeed
{
    public sealed record Item(string Key, string Title, string Body, WhatsNewAudience Roles, bool Important);

    private const WhatsNewAudience Staff = WhatsNewAudience.Admin | WhatsNewAudience.Coordinator;

    public static readonly IReadOnlyList<Item> All = new[]
    {
        new Item("2026-10-invoices-page", "Invoices have their own page",
            "Open Invoices in the menu to see every invoice and credit note in one list, including those for claims that were later deleted.\n\nSearch by number, participant, bill-to or claim, and filter by type, status and issue date. Select an invoice number to download its PDF.",
            Staff, false),
        new Item("2026-10-roster-draft-shifts", "Draft shifts stand out on the roster, and you can publish one at a time",
            "Draft shifts on the roster board now have an amber background and the word Draft, so you can tell them from published shifts at a glance.\n\nTo publish a single shift, open its menu and choose Publish. Publishing the whole week works as before.\n\nIf someone changed a shift's worker after you opened the board, Bunya Support now asks you to refresh the board instead of saving over their change.",
            Staff, false),
        new Item("2026-10-rp-authorisation-badge", "Restrictive practices show whether they're authorised",
            "On a participant's Restrictive Practices tab, every active practice now shows Authorised or Not authorised, the same badge you see when reporting an incident.\n\nWhen a practice isn't authorised, the line under it says what's missing, such as the authorisation date or the authoriser.",
            Staff, false),
        new Item("2026-10-dark-mode", "Dark mode is here",
            "Bunya Support now has a dark theme. Go to Settings, then Appearance, and choose Light, Dark or System under Theme. System follows your device's own setting and is where everyone starts.\n\nYour choice is saved on this device, so another computer or phone keeps its own.",
            WhatsNewAudience.All, true),
    };

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
