using Microsoft.EntityFrameworkCore;

namespace Odip.Tests.Support;

/// <summary>
/// For a PostgreSQL test that migrates to an OLDER schema and seeds rows through the current model: the model also writes the Participant and
/// ProviderSettings columns later migrations add, so the save would fail with 42703. They are added for the seed save and dropped again, so the later
/// migrations still add them. When a migration adds a column to either table, list it here.
/// </summary>
internal static class OlderSchemaSeeds
{
    private static readonly string[] LaterParticipantColumns = ["\"ServicesStartedAt\" timestamp without time zone"];
    private static readonly string[] LaterProviderSettingsColumns = ["\"UpdatedAt\" timestamp without time zone"];

    public static async Task SaveWithLaterColumnsAsync(DbContext db)
    {
        await AlterAsync(db, "Participants", "ADD COLUMN ", LaterParticipantColumns, column => column);
        await AlterAsync(db, "ProviderSettings", "ADD COLUMN ", LaterProviderSettingsColumns, column => column);
        await db.SaveChangesAsync();
        await AlterAsync(db, "Participants", "DROP COLUMN ", LaterParticipantColumns, column => column.Split(" ")[0]);
        await AlterAsync(db, "ProviderSettings", "DROP COLUMN ", LaterProviderSettingsColumns, column => column.Split(" ")[0]);
    }

    private static async Task AlterAsync(DbContext db, string table, string action, string[] columns, Func<string, string> clause)
    {
        foreach (var column in columns)
            await db.Database.ExecuteSqlRawAsync($"ALTER TABLE \"{table}\" {action}{clause(column)}");
    }
}
