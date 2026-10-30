using System.Text.RegularExpressions;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.WhatsNew;

public class WhatsNewSeedTests
{
    private static string Norm(string s) => s.Replace("\r\n", "\n").Trim();

    [Fact]
    public void EveryItem_FitsTheLimits_AndHasAnAudience()
    {
        foreach (var i in WhatsNewSeed.All)
        {
            Assert.InRange(Norm(i.Title).Length, 1, 80);
            Assert.InRange(Norm(i.Body).Length, 1, 600);
            Assert.NotEqual(WhatsNewAudience.None, i.Roles);
        }
    }

    [Fact]
    public void Keys_AreUnique_WellFormed_AndNeverAdminPrefixed()
    {
        Assert.Equal(WhatsNewSeed.All.Count, WhatsNewSeed.All.Select(i => i.Key).Distinct().Count());
        foreach (var i in WhatsNewSeed.All)
        {
            Assert.InRange(i.Key.Length, 1, 64); // the Key column is HasMaxLength(64)
            Assert.Matches(new Regex("^[0-9]{4}-[0-9]{2}-[a-z0-9-]+$"), i.Key);
            Assert.False(i.Key.StartsWith("admin-", StringComparison.Ordinal));
        }
    }

    [Fact]
    public void TheOtherFundedClaimsItem_FollowsTheKeyPattern_ForStaff()
    {
        var item = WhatsNewSeed.All.Single(i => i.Key == "2026-10-other-funded-claims");
        Assert.Equal(WhatsNewAudience.Admin | WhatsNewAudience.Coordinator, item.Roles);
    }

    [Fact]
    public void Copy_NeverSaysOdip()
    {
        foreach (var i in WhatsNewSeed.All)
        {
            Assert.DoesNotContain("ODIP", i.Title, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("ODIP", i.Body, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void ImportantEntries_AreTheFiveFlaggedOnes()
    {
        var important = WhatsNewSeed.All.Where(i => i.Important).ToList();
        Assert.Equal(new[] { "2026-10-dark-mode", "2026-10-ndia-claims-hub", "2026-10-participant-tabs", "2026-10-restraint-medicines-register", "2026-10-screening-missing-counts" }, important.Select(i => i.Key).Order(StringComparer.Ordinal));
        // The other three are staff-only, so they do not reach support workers.
        Assert.All(important.Where(i => i.Key is "2026-10-dark-mode" or "2026-10-participant-tabs"), i => Assert.Equal(WhatsNewAudience.All, i.Roles));
    }

    // Walk up to Odip.sln, not [CallerFilePath], which a path-mapped CI build rewrites.
    private static string ItemsFolder()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
            dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
        if (dir is null) throw new InvalidOperationException($"Could not locate Odip.sln above {AppContext.BaseDirectory}");
        return Path.Combine(dir, "Odip.Infrastructure", "Data", "WhatsNewItems");
    }

    [Fact]
    public void EveryItemLivesInItsOwnFile_AndAllIsInTheDecidedOrder()
    {
        var folder = ItemsFolder();
        Assert.True(Directory.Exists(folder), folder);
        Assert.Equal(Directory.GetFiles(folder, "*.cs").Length, WhatsNewSeed.All.Count);

        // the 44 shipped items keep their shipped order (it fixes their published times); later items follow, sorted by key
        string[] shipped =
        {
            "2026-10-invoices-page",
            "2026-10-roster-draft-shifts",
            "2026-10-rp-authorisation-badge",
            "2026-10-dark-mode",
            "2026-10-participant-tabs",
            "2026-10-caregiver-accept-keeps-edits",
            "2026-10-participant-page-tidy",
            "2026-10-caregiver-form-keeps-typing",
            "2026-10-forms-keep-typing",
            "2026-10-caregiver-review-readable",
            "2026-10-wizard-footer-focus",
            "2026-10-intake-review-labels",
            "2026-10-section-save-conflict",
            "2026-10-get-set-up",
            "2026-10-upcoming-shifts-import",
            "2026-10-bunya-support-name",
            "2026-10-bunya-support-screens",
            "2026-10-participant-adl-columns",
            "2026-10-adl-notes-in-full",
            "2026-10-leave-approvals-1024",
            "2026-10-unsaved-prompt-clear-of-nav",
            "2026-10-notices-one-look",
            "2026-10-portal-call-buttons",
            "2026-10-row-buttons-one-look",
            "2026-10-sidebar-motion",
            "2026-10-trip-form-labels",
            "2026-10-theme-in-top-bar",
            "2026-10-participant-subtabs",
            "2026-10-install-app",
            "2026-10-logo-mark",
            "2026-10-logo-icons",
            "2026-10-other-funded-claims",
            "2026-10-double-booking-block",
            "2026-10-rp-authorised-checkbox",
            "2026-10-agreements-page",
            "2026-10-offline-shifts",
            "2026-10-offline-review-marker",
            "2026-10-other-funded-budgets",
            "2026-10-agreements-bulk",
            "2026-10-back-goes-back",
            "2026-10-roster-needs-staff",
            "2026-10-release-period-required",
            "2026-10-list-badges-tidy",
            "2026-10-budget-graph",
        };
        var keys = WhatsNewSeed.All.Select(i => i.Key).ToList();
        Assert.Equal(shipped, keys.Take(shipped.Length));
        var rest = keys.Skip(shipped.Length).ToList();
        Assert.Equal(rest.OrderBy(k => k, StringComparer.Ordinal), rest);
    }
}
