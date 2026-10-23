using Microsoft.EntityFrameworkCore;

namespace Odip.Tests.Support;

/// <summary>
/// For a PostgreSQL test that migrates to an OLDER schema and seeds rows through the current model: the model also writes the columns
/// later migrations add to existing tables, so the save would fail with 42703. Each one the older schema lacks is added for the seed save
/// and dropped again, so the later migrations still add it. When a migration adds a column to an existing table, list it here.
/// </summary>
internal static class OlderSchemaSeeds
{
    private static readonly (string Table, string Column, string Type)[] LaterColumns =
    [
        ("Participants", "ServicesStartedAt", "timestamp without time zone"),
        ("ProviderSettings", "CreditNotePrefix", "character varying(10)"),
        ("ProviderSettings", "InvoiceNumberPrefix", "character varying(10)"),
        ("ProviderSettings", "InvoiceStartNumber", "integer"),
        ("ProviderSettings", "PaymentTermsDays", "integer"),
    ];

    public static async Task SaveWithLaterColumnsAsync(DbContext db)
    {
        var added = new List<(string Table, string Column)>();
        foreach (var (table, column, type) in LaterColumns)
        {
            var present = await db.Database.SqlQueryRaw<int>(
                "SELECT count(*)::int AS \"Value\" FROM information_schema.columns WHERE table_name = {0} AND column_name = {1}", table, column).SingleAsync();
            if (present > 0) continue;
            await db.Database.ExecuteSqlRawAsync($"ALTER TABLE IF EXISTS \"{table}\" ADD COLUMN \"{column}\" {type}");
            added.Add((table, column));
        }
        await db.SaveChangesAsync();
        foreach (var (table, column) in added)
            await db.Database.ExecuteSqlRawAsync($"ALTER TABLE IF EXISTS \"{table}\" DROP COLUMN IF EXISTS \"{column}\"");
    }
}
