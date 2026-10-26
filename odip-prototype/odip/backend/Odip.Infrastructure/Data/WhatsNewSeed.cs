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
            "Draft shifts on the roster board now have an amber background and the word Draft, so you can tell them from published shifts at a glance.\n\nTo publish a single shift, open its menu and choose Publish. Publishing the whole week works as before.",
            Staff, false),
        new Item("2026-10-rp-authorisation-badge", "Restrictive practices show whether they're authorised",
            "On a participant's Restrictive Practices tab, every active practice now shows Authorised or Not authorised, the same badge you see when reporting an incident.\n\nWhen a practice isn't authorised, the line under it says what's missing, such as the authorisation date or the authoriser.",
            Staff, false),
        new Item("2026-10-dark-mode", "Dark mode is here",
            "Bunya Support now has a dark theme. Go to Settings, then Appearance, and choose Light, Dark or System under Theme.\n\nYour choice is saved on this device, so another computer or phone keeps its own.",
            WhatsNewAudience.All, true),
        new Item("2026-10-participant-tabs", "Participant pages are now split into tabs",
            "Open a participant to see their page in tabs, with Overview first.\n\nOverview starts with Before you start: the things to know before a shift, such as allergies and choking risk. Select one to go straight to its details in Health & safety.",
            WhatsNewAudience.All, true),
        new Item("2026-10-caregiver-accept-keeps-edits", "Accepting a caregiver's form keeps your team's newer edits",
            "Accepting a caregiver's form now applies only what the caregiver changed. Details your team edited after the caregiver opened the form are kept.\n\nIf your team and the caregiver changed the same detail, the caregiver's value is applied and the review screen flags that row.",
            Staff, false),
        new Item("2026-10-participant-page-tidy", "Participant pages are easier to scan",
            "Each card now shows only what has been recorded. Anything missing is listed in one short Not recorded line at the bottom of the card.\n\nLong lists show the first five, with Show all to see the rest. Use Jump to at the top of a tab to go straight to a section.",
            WhatsNewAudience.All, false),
        new Item("2026-10-caregiver-form-keeps-typing", "Caregiver forms keep what you type while saving",
            "If a caregiver keeps typing while their form is saving, what they typed is now kept instead of being cleared when the save finishes.",
            Staff, false),
        new Item("2026-10-forms-keep-typing", "Intake and task forms keep what you type",
            "If the participant or task you are editing refreshes in the background, for example when you come back to the browser tab, what you have typed now stays.\n\nWhen you open a task again after saving it, it shows its latest details.",
            Staff, false),
        new Item("2026-10-caregiver-review-readable", "Caregiver form reviews are easier to read",
            "When you review a caregiver's form, each section now has the same name the caregiver saw, and the Field, Current and Caregiver's value columns line up from one section to the next.",
            Staff, false),
        new Item("2026-10-wizard-footer-focus", "Save and Submit keep your place while they work",
            "When you use Save and continue later, Save as draft or Submit, the keyboard focus now stays on that button while it saves, so you do not lose your place.\n\nOn small phones the buttons also fit: Back and Next stay together, and the save button sits on its own line below.",
            Staff, false),
        new Item("2026-10-intake-review-labels", "Intake review shows plan details in words",
            "On the last step of an intake, the review now shows funding source, plan type, service streams, support ratio and overnight support in plain words instead of internal names.",
            Staff, false),
        new Item("2026-10-section-save-conflict", "A section save now tells you when someone else saved it first",
            "If someone else saves the same section of a participant's profile while you are editing it, your save is stopped instead of quietly replacing theirs. What you typed stays in the form, and their version is shown beside it as Latest saved. Compare the two, then save again to replace their version, or cancel to keep it.",
            Staff, false),
        new Item("2026-10-get-set-up", "Get set up from the dashboard",
            "A new organisation now sees Get set up at the top of the dashboard: six steps, from your organisation details to your first invoice, each with its status and what to do next.\n\nStaff imports now email each new staff member a sign-in invite straight after the import. Keep the tab open until the invites finish.\n\nHide the steps on a device, and show them again from Settings, Organisation setup.",
            WhatsNewAudience.Admin, false),
        new Item("2026-10-upcoming-shifts-import", "Import your upcoming shifts",
            "Go to Settings, then Import data, to bring in your next weeks of shifts: an export from your old platform, or a weekly pattern repeated for up to 12 weeks. Every shift is checked against the roster rules and added as a draft, and each week is ready to publish. Nobody is told until you publish.",
            WhatsNewAudience.Admin, false),
        new Item("2026-10-bunya-support-name", "Bunya Support, everywhere",
            "Messages from the app and its downloads now use the Bunya Support name. Data exports are called bunya-support-export, and the import templates are called bunya-support-…-template.",
            WhatsNewAudience.Admin, false),
        new Item("2026-10-tenant-pace-removed", "Tenant screens no longer show PACE",
            "The PACE Provider tick box and badge are gone from the tenant screens. Nothing used them.",
            WhatsNewAudience.Admin, false),
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
