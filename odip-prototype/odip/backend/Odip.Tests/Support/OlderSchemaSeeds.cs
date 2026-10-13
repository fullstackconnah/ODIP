using Microsoft.EntityFrameworkCore;

namespace Odip.Tests.Support;

/// <summary>
/// For a PostgreSQL test that migrates to an OLDER schema and seeds rows through the current model: the model also writes the Participant columns
/// later migrations add, so the save would fail with 42703. They are added for the seed save and dropped again, so the later migrations still add them.
/// When a migration adds a column to Participants, list it here.
/// </summary>
internal static class OlderSchemaSeeds
{
    private static readonly string[] LaterParticipantColumns = ["\"ServicesStartedAt\" timestamp without time zone"];

    public static async Task SaveWithLaterParticipantColumnsAsync(DbContext db)
    {
        foreach (var column in LaterParticipantColumns)
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Participants\" ADD COLUMN " + column);
        await db.SaveChangesAsync();
        foreach (var column in LaterParticipantColumns)
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Participants\" DROP COLUMN " + column.Split(" ")[0]);
    }
}
