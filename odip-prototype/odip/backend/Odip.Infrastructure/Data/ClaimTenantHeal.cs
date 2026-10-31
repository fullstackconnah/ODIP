namespace Odip.Infrastructure.Data;

/// <summary>
/// Startup statements shared by Program.cs and its test: give a claim filed without a TenantId (by an image rolled back to before the column) its trip's or participant's organisation, and its lines their claim's.
/// </summary>
public static class ClaimTenantHeal
{
    // shortcut: heals the rollback window only; delete in tenant isolation PR 4 (the contract PR makes TripClaims/ClaimLineItems.TenantId required).
    public const string Sql = """
        UPDATE "TripClaims" c SET "TenantId" = COALESCE(
            (SELECT t."TenantId" FROM "TripInstances" t WHERE t."Id" = c."TripInstanceId"),
            (SELECT p."TenantId" FROM "Participants" p WHERE p."Id" = c."ParticipantId"))
        WHERE c."TenantId" IS NULL AND (c."TripInstanceId" IS NOT NULL OR c."ParticipantId" IS NOT NULL);
        UPDATE "ClaimLineItems" l SET "TenantId" = c."TenantId"
        FROM "TripClaims" c WHERE c."Id" = l."TripClaimId" AND l."TenantId" IS NULL AND c."TenantId" IS NOT NULL;
        """;
}
