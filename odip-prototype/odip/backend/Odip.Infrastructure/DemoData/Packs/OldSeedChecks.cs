using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// Plan 4.5: the old seed guards some tables with <c>Any()</c> (a future re-seed must still find them empty on a database it never touched), so
/// the top-up never writes the FIRST row of such a table: it writes only beside rows the old seed itself made.
/// </summary>
internal static class OldSeedChecks
{
    /// <summary>
    /// True when at least one of the old seed's own six shift notes (fixed ids 78..01 to 78..06, DbSeeder.SeedShiftNotesAsync) is there. When none
    /// is, <paramref name="story"/> is skipped with the reason, so a note would not be the first row of the table.
    /// </summary>
    public static async Task<bool> ShiftNotesThereAsync(DemoRun run, string story, CancellationToken ct)
    {
        var ids = Enumerable.Range(1, 6).Select(n => Guid.Parse($"78000000-0000-0000-0000-{n:x12}")).ToList();
        var there = (await run.ExistingIdsAsync<ShiftNote>(ids, ct)).Count > 0;
        if (!there) run.Skipped(story, "none of the old seed's shift notes is there, so a note would be the first row of a guarded table");
        return there;
    }
}
