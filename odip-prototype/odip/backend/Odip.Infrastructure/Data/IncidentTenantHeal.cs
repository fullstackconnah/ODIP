namespace Odip.Infrastructure.Data;

/// <summary>
/// Startup statement shared by Program.cs and its test: gives an incident filed without a TenantId (by an image rolled back to before the column) its reporter's organisation.
/// </summary>
public static class IncidentTenantHeal
{
    // shortcut: heals the rollback window only; delete once the contract PR makes IncidentReports.TenantId required.
    public const string Sql = """
        UPDATE "IncidentReports" i SET "TenantId" = u."TenantId"
        FROM "Users" u WHERE u."Id" = i."ReportedByUserId" AND i."TenantId" IS NULL;
        """;
}
