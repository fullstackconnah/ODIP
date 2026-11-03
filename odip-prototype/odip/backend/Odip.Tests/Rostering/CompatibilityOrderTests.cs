using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>The one staff order R7 and the GET read: Preferred, Backup, Emergency, unlisted, Excluded last; rank then name inside a tier.</summary>
public class CompatibilityOrderTests
{
    private static List<string> Sorted(params (string Name, CompatibilityLevel? Level, int Rank)[] rows) =>
        rows.OrderBy(r => CompatibilityOrder.Key(r.Level, r.Rank, r.Name), CompatibilityOrder.Comparer).Select(r => r.Name).ToList();

    [Fact]
    public void Tiers_RunPreferredBackupEmergencyUnlistedExcluded_NotByTheStoredInt()
    {
        var order = Sorted(
            ("excluded", CompatibilityLevel.Excluded, 0),
            ("allowed", CompatibilityLevel.Allowed, 0),
            ("norow", null, 0),
            ("emergency", CompatibilityLevel.Emergency, 1),
            ("backup", CompatibilityLevel.Backup, 1),
            ("preferred", CompatibilityLevel.Preferred, 1));

        Assert.Equal(new[] { "preferred", "backup", "emergency" }, order.Take(3));
        Assert.Equal(new[] { "allowed", "norow" }, order.Skip(3).Take(2));
        Assert.Equal("excluded", order[^1]);
    }

    [Fact]
    public void InsideATier_RankDecides_ThenName()
    {
        var order = Sorted(
            ("Zed", CompatibilityLevel.Backup, 1),
            ("Amy", CompatibilityLevel.Backup, 2),
            ("Bea", CompatibilityLevel.Backup, 2));

        Assert.Equal(new[] { "Zed", "Amy", "Bea" }, order);
    }

    [Fact]
    public void ARankOfZeroOrLess_GoesLastInItsTier()
    {
        var order = Sorted(
            ("Unranked", CompatibilityLevel.Preferred, 0),
            ("Negative", CompatibilityLevel.Preferred, -1),
            ("Second", CompatibilityLevel.Preferred, 2),
            ("First", CompatibilityLevel.Preferred, 1),
            ("Backup", CompatibilityLevel.Backup, 1));

        Assert.Equal(new[] { "First", "Second", "Negative", "Unranked", "Backup" }, order);
    }
}
