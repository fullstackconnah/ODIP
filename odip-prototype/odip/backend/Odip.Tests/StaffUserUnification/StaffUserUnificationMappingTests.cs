using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.StaffUserUnification;

/// <summary>
/// Covers <see cref="StaffUserUnificationMapping"/> — the pure C# mirror of the
/// StaffUserUnification EF migration's username-collision-suffix and
/// earliest-created-user-wins algorithms (spec §3.3 steps 2–4). See that class's XML doc for why
/// this is a pure-function mirror rather than a DbContext-driven one like
/// RestrictivePracticeBackfillTests (the migration deletes its own source table/column, so no
/// post-migration OdipDbContext model can express the original lookup).
/// </summary>
public class StaffUserUnificationMappingTests
{
    // ── ResolveUsername ──────────────────────────────────────────────

    [Fact]
    public void ResolveUsername_NoCollision_ReturnsPlainFirstDotLast()
    {
        var result = StaffUserUnificationMapping.ResolveUsername("Marcus", "Papadopoulos", new HashSet<string>());

        Assert.Equal("marcus.papadopoulos", result);
    }

    [Fact]
    public void ResolveUsername_StripsPunctuationAndSpaces_MatchingSeederConvention()
    {
        // "O'Brien" -> "obrien", matching the DbSeeder's existing "james.obrien" convention.
        var result = StaffUserUnificationMapping.ResolveUsername("James", "O'Brien", new HashSet<string>());

        Assert.Equal("james.obrien", result);
    }

    [Fact]
    public void ResolveUsername_SingleCollision_AppendsDash2_NotDash1()
    {
        var existing = new HashSet<string> { "priya.sharma" };

        var result = StaffUserUnificationMapping.ResolveUsername("Priya", "Sharma", existing);

        Assert.Equal("priya.sharma-2", result);
    }

    [Fact]
    public void ResolveUsername_MultipleCollisions_IncrementsToFirstFreeSuffix()
    {
        var existing = new HashSet<string> { "lachlan.robertson", "lachlan.robertson-2", "lachlan.robertson-3" };

        var result = StaffUserUnificationMapping.ResolveUsername("Lachlan", "Robertson", existing);

        Assert.Equal("lachlan.robertson-4", result);
    }

    [Fact]
    public void ResolveUsername_ComparesCaseInsensitively_ViaCallerSuppliedLowercaseSet()
    {
        // Mirrors the migration's lower("Username") comparison — caller is responsible for
        // lower-casing the existing set; the candidate is always compared/produced lowercase.
        var existing = new HashSet<string> { "jade.watkins" };

        var result = StaffUserUnificationMapping.ResolveUsername("JADE", "Watkins", existing);

        Assert.Equal("jade.watkins-2", result);
    }

    [Fact]
    public void ResolveUsername_AccountsForUsernamesCreatedEarlierInTheSamePass()
    {
        // Simulates two orphaned Staff rows with the same derived base username processed in the
        // same migration pass — the second must see the first's freshly-inserted username.
        var existing = new HashSet<string>();
        var first = StaffUserUnificationMapping.ResolveUsername("Brendan", "Nguyen", existing);
        existing.Add(first);

        var second = StaffUserUnificationMapping.ResolveUsername("Brendan", "Nguyen", existing);

        Assert.Equal("brendan.nguyen", first);
        Assert.Equal("brendan.nguyen-2", second);
    }

    // ── ResolveEarliestUser ──────────────────────────────────────────

    [Fact]
    public void ResolveEarliestUser_SingleLinkedUser_ReturnsThatUser()
    {
        var userId = Guid.NewGuid();
        var result = StaffUserUnificationMapping.ResolveEarliestUser(new[] { (userId, DateTime.UtcNow) });

        Assert.Equal(userId, result);
    }

    [Fact]
    public void ResolveEarliestUser_TwoLinkedUsers_PicksTheEarlierCreatedAt()
    {
        var earlier = (UserId: Guid.NewGuid(), CreatedAt: new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        var later = (UserId: Guid.NewGuid(), CreatedAt: new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc));

        var result = StaffUserUnificationMapping.ResolveEarliestUser(new[] { later, earlier });

        Assert.Equal(earlier.UserId, result);
    }

    [Fact]
    public void ResolveEarliestUser_IdenticalCreatedAt_TieBreaksByIdDeterministically()
    {
        var sameInstant = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc);
        var lowerId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var higherId = Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff");

        var result = StaffUserUnificationMapping.ResolveEarliestUser(new[]
        {
            (higherId, sameInstant),
            (lowerId, sameInstant),
        });

        Assert.Equal(lowerId, result);
    }

    [Fact]
    public void ResolveEarliestUser_ThreeOrMoreLinkedUsers_StillPicksTheOverallEarliest()
    {
        var earliest = (UserId: Guid.NewGuid(), CreatedAt: new DateTime(2025, 12, 1, 0, 0, 0, DateTimeKind.Utc));
        var middle = (UserId: Guid.NewGuid(), CreatedAt: new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        var latest = (UserId: Guid.NewGuid(), CreatedAt: new DateTime(2026, 2, 1, 0, 0, 0, DateTimeKind.Utc));

        var result = StaffUserUnificationMapping.ResolveEarliestUser(new[] { latest, earliest, middle });

        Assert.Equal(earliest.UserId, result);
    }

    [Fact]
    public void ResolveEarliestUser_EmptyList_Throws()
    {
        Assert.Throws<ArgumentException>(() =>
            StaffUserUnificationMapping.ResolveEarliestUser(Array.Empty<(Guid, DateTime)>()));
    }
}
