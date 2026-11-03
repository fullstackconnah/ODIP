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
        ("IncidentReports", "AmbulanceOfficerName", "character varying(100)"),
        ("IncidentReports", "AmbulanceReference", "character varying(50)"),
        ("IncidentReports", "EmergencyServices", "integer NOT NULL DEFAULT 0"),
        ("IncidentReports", "FireOfficerName", "character varying(100)"),
        ("IncidentReports", "FireReference", "character varying(50)"),
        ("IncidentReports", "PoliceOfficerName", "character varying(100)"),
        ("IncidentReports", "PoliceReference", "character varying(50)"),
        ("RestrictivePractices", "CommissionReference", "character varying(50)"),
        ("Participants", "MmLevel", "integer"),
        ("FundingPlans", "MyProvider", "integer"),
        ("FundingPlans", "MyProviderOn", "date"),
        ("FundingPlans", "MyProviderSetBy", "character varying(100)"),
        ("Participants", "ServicesStartedAt", "timestamp without time zone"),
        ("ProviderSettings", "ContactEmail", "character varying(254)"),
        ("ProviderSettings", "ContactPhone", "character varying(30)"),
        ("ProviderSettings", "CreditNotePrefix", "character varying(10)"),
        ("ProviderSettings", "InvoiceNumberPrefix", "character varying(10)"),
        ("ProviderSettings", "InvoiceStartNumber", "integer"),
        ("ProviderSettings", "PaymentTermsDays", "integer"),
        ("ProviderSettings", "TimeZoneId", "character varying(64)"),
        ("ProviderSettings", "TradingName", "character varying(200)"),
        ("ProviderSettings", "UpdatedAt", "timestamp without time zone"),
        ("ProviderSettings", "Website", "character varying(500)"),
        ("ServiceAgreementDrafts", "IsOngoing", "boolean"),
        ("ServiceAgreementDrafts", "OriginalAgreementEndDate", "date"),
        ("ShiftBreaks", "WithParticipant", "boolean"),
        ("Shifts", "CancelledAt", "timestamp without time zone"),
        ("StaffParticipantCompatibilities", "Rank", "integer"),
        ("Users", "EmploymentType", "integer"),
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
