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
        new Item("2026-10-bunya-support-screens", "Screens now say Bunya Support",
            "Settings, payslips and other screens now use the Bunya Support name too.",
            WhatsNewAudience.Admin, false),
        new Item("2026-10-participant-adl-columns", "Tidier ADL tables",
            "The personal and community ADL tables on a participant's page now line up, and Medications says Add medication everywhere.",
            WhatsNewAudience.All, false),
        new Item("2026-10-adl-notes-in-full", "ADL notes show in full",
            "Long ADL notes and \"how to help me\" text now wrap on a participant's page instead of being cut off.",
            WhatsNewAudience.All, false),
        new Item("2026-10-leave-approvals-1024", "Leave fits smaller screens",
            "On a laptop-sized screen the leave table now shows each person with their leave type, and the dates with who asked, so nothing scrolls sideways.",
            Staff, false),
        new Item("2026-10-unsaved-prompt-clear-of-nav", "Unsaved changes prompt fits phones",
            "On a phone, the \"unsaved changes\" prompt no longer sits under the bottom menu.",
            WhatsNewAudience.All, false),
        new Item("2026-10-notices-one-look", "Warnings look the same everywhere",
            "Warning and error notices on participant pages, intake, the caregiver form and the roster panels now share one look, with an icon.",
            WhatsNewAudience.All, false),
        new Item("2026-10-portal-call-buttons", "Call buttons and shift notices look the same as the rest of the app",
            "In the support worker portal, the call buttons on a shift and the notices about flagged notes and shift problems now use the same style as the rest of Bunya Support.",
            WhatsNewAudience.All, false),
        new Item("2026-10-row-buttons-one-look", "Add and remove buttons match",
            "The add and remove buttons on intake contacts and risks, incident witnesses and restrictive practices now look and work like the rest of the app, and the witness choice works with arrow keys.",
            WhatsNewAudience.All, false),
        new Item("2026-10-sidebar-motion", "The side menu folds away more smoothly",
            "When you collapse or expand the side menu, the labels fade and the icons glide into place instead of jumping.",
            WhatsNewAudience.All, false),
        new Item("2026-10-trip-form-labels", "Trip forms read better with screen readers",
            "On a trip, the Edit trip, accommodation, bookings, staff, activity, vehicle and claim forms now label every field the same way as the rest of Bunya Support, and accommodation costs show dollars and cents.",
            Staff, false),
        new Item("2026-10-theme-in-top-bar", "Change the theme from the top bar",
            "Use the sun, moon or screen icon at the top of any page to switch between Light, Dark and System. Settings, Appearance still works too, and your choice is saved on this device.",
            WhatsNewAudience.All, false),
        new Item("2026-10-participant-subtabs", "Each section has its own tab",
            "On a participant's page, the sections of a tab are now listed as small tabs under the main ones. Choose one to see just that section. Risks, routines, contacts and notes show how many there are.\n\nLinks, flags and alerts still open the right section.",
            WhatsNewAudience.All, false),
        new Item("2026-10-install-app", "Add Bunya Support to your phone",
            "On your phone, you can add Bunya Support to your home screen and open it like an app. After you sign in, look for the card above the menu bar.",
            WhatsNewAudience.All, false),
        new Item("2026-10-logo-mark", "A new Bunya Support logo",
            "The small logo in the side menu is now the \"b\" from the Bunya Support name. When you fold the side menu away, the name folds into it.",
            WhatsNewAudience.All, false),
        new Item("2026-10-logo-icons", "The new logo on your tab and home screen",
            "Your browser tab and the Bunya Support app on your phone now show the same \"b\" logo as the side menu. If you added Bunya Support to your home screen before today and it still shows the old logo, remove it and add it again.",
            WhatsNewAudience.All, false),
        new Item("2026-10-other-funded-claims", "Participants funded another way are left out of claims",
            "A participant who is funded another way is no longer included in NDIS claims, even if an old NDIS number is still on their profile. The claim lists them as left out and says to invoice them directly.",
            Staff, false),
        new Item("2026-10-double-booking-block", "Coordinators can't double-book a worker",
            "When a worker already has a shift at that time, a coordinator can no longer put them on another shift from the roster board or the shift panel. An admin still can, after giving a reason. Shifts that already overlap can still be edited or cancelled.",
            Staff, false),
        new Item("2026-10-rp-authorised-checkbox", "Mark a restrictive practice as authorised",
            "When you add or edit a restrictive practice, tick \"This restrictive practice is authorised\" to fill in who authorised it and when. Leave it unticked if it isn't authorised.",
            Staff, false),
        new Item("2026-10-agreements-page", "Agreements page",
            "A new Agreements page in the menu lists every participant's service agreement with its dates, total and price list. Where your organisation lets your role approve agreements, you can tick the ones with a draft waiting and approve them together. The Agreements ending view from Participants now lives here too.",
            Staff, false),
        new Item("2026-10-offline-shifts", "Your shifts work without signal",
            "Today's shifts in My shifts keep working if you lose signal: you can start the shift, write notes, take breaks, tick routines and finish. Bunya Support saves them on your phone and sends them when you're back online. Recording a dose still needs a connection.",
            WhatsNewAudience.SupportWorker, false),
        new Item("2026-10-offline-review-marker", "See which shifts were sent from offline",
            "On Completions, a shift a support worker finished without signal shows \"Sent from offline\" and when it reached Bunya Support. Its times are the ones the worker recorded on their phone.",
            Staff, false),
        new Item("2026-10-other-funded-budgets", "Other-funded participants leave the NDIS budget",
            "A participant who is funded another way no longer counts against an NDIS budget. Their shifts stop showing as pending NDIS money on the Budgets page and on their Funding tab, and their Claims tab now says to invoice their funder directly.",
            Staff, false),
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
