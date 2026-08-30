namespace Odip.Infrastructure.Data;

/// <summary>
/// Pure C# mirror of the two non-trivial algorithms the <c>StaffUserUnification</c> EF migration
/// implements as raw SQL (see that migration's XML doc and spec §3.3 steps 2–4):
/// <list type="bullet">
/// <item>the orphaned-Staff-row username collision-suffix loop (step 2) — <see cref="ResolveUsername"/>;</item>
/// <item>the earliest-created-User-wins tie-break used when a Staff row is linked to more than one
/// User (steps 3–4) — <see cref="ResolveEarliestUser"/>.</item>
/// </list>
///
/// Unlike <c>RestrictivePracticeBackfill</c> (which mirrors its migration as a DbContext-driven
/// backfill runnable end-to-end against EF InMemory), this class cannot take that shape: the
/// migration's source table (<c>Staff</c>) and source column (<c>User.StaffId</c>) are deleted by
/// the very same migration, so no post-migration <c>OdipDbContext</c> model can express "for each
/// Staff row, look up its linked Users" at all. What CAN be mirrored, and is here, are the two
/// algorithms in isolation — pure functions over plain inputs, with no DbContext dependency —
/// exercised directly by unit tests instead of via an InMemory database.
/// </summary>
public static class StaffUserUnificationMapping
{
    /// <summary>
    /// Mirrors the migration's username-derivation loop: lowercase "first.last" (letters/digits
    /// only — matches the DbSeeder convention of stripping punctuation, e.g. "O'Brien" →
    /// "obrien"), then append a numeric collision suffix (-2, -3, …) until the candidate isn't
    /// already present in <paramref name="existingUsernamesLowercase"/>. The first collision
    /// produces "-2", not "-1", matching the migration's raw SQL exactly.
    /// </summary>
    /// <param name="firstName">The Staff row's FirstName.</param>
    /// <param name="lastName">The Staff row's LastName.</param>
    /// <param name="existingUsernamesLowercase">
    /// Every username already in use, already lower-cased by the caller — mirrors the migration's
    /// <c>lower("Username")</c> comparison. Must include usernames created earlier in the same
    /// orphan-auto-create pass, not just pre-existing rows, for the loop to behave identically to
    /// the migration's row-by-row PL/pgSQL loop (which re-queries "Users" — including its own
    /// prior inserts — before every candidate check).
    /// </param>
    public static string ResolveUsername(string firstName, string lastName, IReadOnlySet<string> existingUsernamesLowercase)
    {
        ArgumentNullException.ThrowIfNull(existingUsernamesLowercase);

        var baseUsername = $"{StripToLettersAndDigits(firstName)}.{StripToLettersAndDigits(lastName)}".ToLowerInvariant();
        var candidate = baseUsername;
        var suffix = 1;
        while (existingUsernamesLowercase.Contains(candidate))
        {
            suffix++;
            candidate = $"{baseUsername}-{suffix}";
        }

        return candidate;
    }

    private static string StripToLettersAndDigits(string value)
    {
        var chars = value.Where(char.IsLetterOrDigit).ToArray();
        return new string(chars);
    }

    /// <summary>
    /// Mirrors the migration's <c>_staff_user_map</c> temp table: when a Staff row is linked to
    /// more than one User, the earliest-created one (tie-broken deterministically by Id) is the
    /// one every FK backfill in step 4 points at — matches
    /// <c>ORDER BY u."CreatedAt" ASC, u."Id" ASC</c> / <c>DISTINCT ON</c> exactly.
    /// </summary>
    /// <param name="linkedUsers">Every User linked to one Staff row. Must be non-empty.</param>
    public static Guid ResolveEarliestUser(IEnumerable<(Guid UserId, DateTime CreatedAt)> linkedUsers)
    {
        ArgumentNullException.ThrowIfNull(linkedUsers);

        var ordered = linkedUsers
            .OrderBy(u => u.CreatedAt)
            .ThenBy(u => u.UserId)
            .ToList();

        if (ordered.Count == 0)
            throw new ArgumentException("At least one linked user is required.", nameof(linkedUsers));

        return ordered[0].UserId;
    }
}
