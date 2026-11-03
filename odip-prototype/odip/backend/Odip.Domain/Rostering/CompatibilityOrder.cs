namespace Odip.Domain.Rostering;

/// <summary>
/// The one order of staff for a participant (R7 auto-rostering reads it too): Preferred, Backup, Emergency, then unlisted
/// (Allowed, or no row), then Excluded last. Inside a ranked tier the order is the rank, then the staff name; a rank of 0
/// or less (never ranked) goes last in its tier. The stored int of <see cref="CompatibilityLevel"/> is never used to order.
/// </summary>
public static class CompatibilityOrder
{
    public static readonly IComparer<(int Tier, int Rank, string Name)> Comparer = new KeyComparer();

    public static bool IsRanked(CompatibilityLevel level) =>
        level is CompatibilityLevel.Preferred or CompatibilityLevel.Backup or CompatibilityLevel.Emergency;

    /// <summary>0 Preferred, 1 Backup, 2 Emergency, 3 unlisted (null = no row), 4 Excluded.</summary>
    public static int Tier(CompatibilityLevel? level) => level switch
    {
        CompatibilityLevel.Preferred => 0,
        CompatibilityLevel.Backup => 1,
        CompatibilityLevel.Emergency => 2,
        CompatibilityLevel.Excluded => 4,
        _ => 3,
    };

    public static (int Tier, int Rank, string Name) Key(CompatibilityLevel? level, int rank, string? name) =>
        (Tier(level), rank <= 0 ? int.MaxValue : rank, name ?? string.Empty);

    private sealed class KeyComparer : IComparer<(int Tier, int Rank, string Name)>
    {
        public int Compare((int Tier, int Rank, string Name) x, (int Tier, int Rank, string Name) y)
        {
            var c = x.Tier.CompareTo(y.Tier);
            if (c != 0) return c;
            c = x.Rank.CompareTo(y.Rank);
            return c != 0 ? c : StringComparer.OrdinalIgnoreCase.Compare(x.Name, y.Name);
        }
    }
}
