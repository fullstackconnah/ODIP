using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ClaimTenantId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "TripClaims",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "ClaimLineItems",
                type: "uuid",
                nullable: true);

            // Each claim takes the organisation of its trip (a Trip claim) or its participant (a Shift claim); each line takes its claim's. The columns stay nullable (expand): the previous image's
            // INSERTs leave them out, so a rollback keeps working; ClaimTenantHeal stamps those rows at the next start, and the contract migration makes the columns NOT NULL.
            migrationBuilder.Sql("""
                UPDATE "TripClaims" c SET "TenantId" = COALESCE(
                    (SELECT t."TenantId" FROM "TripInstances" t WHERE t."Id" = c."TripInstanceId"),
                    (SELECT p."TenantId" FROM "Participants" p WHERE p."Id" = c."ParticipantId"))
                WHERE c."TenantId" IS NULL;
                """);
            migrationBuilder.Sql("""
                UPDATE "ClaimLineItems" l SET "TenantId" = c."TenantId"
                FROM "TripClaims" c WHERE c."Id" = l."TripClaimId" AND l."TenantId" IS NULL;
                """);
            // Stop, naming the claims, rather than leave one with no organisation (neither parent) or guess between two (a trip and a participant of different organisations).
            // The migration is one transaction, so a stop changes nothing. The WHERE reads the parents only, so the same text is the owner's read-only pre-merge check on live.
            migrationBuilder.Sql("""
                DO $$
                DECLARE conflicts text;
                BEGIN
                    SELECT string_agg(c."Id"::text, ', ') INTO conflicts
                    FROM "TripClaims" c
                    LEFT JOIN "TripInstances" t ON t."Id" = c."TripInstanceId"
                    LEFT JOIN "Participants" p ON p."Id" = c."ParticipantId"
                    WHERE COALESCE(t."TenantId", p."TenantId") IS NULL OR t."TenantId" <> p."TenantId";
                    IF conflicts IS NOT NULL THEN
                        RAISE EXCEPTION 'ClaimTenantId: no single organisation for claims (no trip or participant, or both of different organisations): %', conflicts;
                    END IF;
                END $$;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_TripClaims_TenantId",
                table: "TripClaims",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_ClaimLineItems_TenantId",
                table: "ClaimLineItems",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_TripClaims_TenantId",
                table: "TripClaims");

            migrationBuilder.DropIndex(
                name: "IX_ClaimLineItems_TenantId",
                table: "ClaimLineItems");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "TripClaims");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "ClaimLineItems");
        }
    }
}
