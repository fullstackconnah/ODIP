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
            Assert.Matches(new Regex("^[0-9]{4}-[0-9]{2}-[a-z0-9-]+$"), i.Key);
            Assert.False(i.Key.StartsWith("admin-", StringComparison.Ordinal));
        }
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
    public void ExactlyOneImportantEntry_DarkMode_ForEveryone()
    {
        var important = Assert.Single(WhatsNewSeed.All, i => i.Important);
        Assert.Equal("2026-10-dark-mode", important.Key);
        Assert.Equal(WhatsNewAudience.All, important.Roles);
    }
}
