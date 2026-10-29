using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class LinkRestraintMedicinesToRegister : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "RequiresReporting",
                table: "RestrictivePractices",
                type: "boolean",
                nullable: true);

            // Dedupe BEFORE the unique index, or migrate throws and the API crash-loops on boot. Per medicine the winner is
            // authorised-latest, then active, then oldest, then Id; losers are unlinked and deactivated, never deleted.
            migrationBuilder.Sql(@"
UPDATE ""RestrictivePractices"" rp
SET ""IsActive"" = false, ""RelatedMedicationId"" = NULL, ""UpdatedAt"" = NOW()
FROM (
    SELECT ""Id"", ROW_NUMBER() OVER (
        PARTITION BY ""RelatedMedicationId""
        ORDER BY (""AuthorisedBy"" IS NOT NULL AND ""AuthorisationDate"" IS NOT NULL) DESC,
                 CASE WHEN ""AuthorisedBy"" IS NOT NULL AND ""AuthorisationDate"" IS NOT NULL THEN ""AuthorisationDate"" END DESC NULLS LAST,
                 ""IsActive"" DESC, ""CreatedAt"" ASC, ""Id"" ASC) AS rn
    FROM ""RestrictivePractices""
    WHERE ""RelatedMedicationId"" IS NOT NULL
) ranked
WHERE rp.""Id"" = ranked.""Id"" AND ranked.rn > 1;");

            // The demo Risperidone entry was seeded without an authoriser; heal it only while both fields are still empty.
            migrationBuilder.Sql(@"
UPDATE ""RestrictivePractices""
SET ""AuthorisedBy"" = 'QLD Senior Practitioner', ""AuthorisationDate"" = (""CreatedAt"")::date
WHERE ""Id"" = '75000000-0000-0000-0000-000000000003' AND ""AuthorisedBy"" IS NULL AND ""AuthorisationDate"" IS NULL;");

            migrationBuilder.DropIndex(
                name: "IX_RestrictivePractices_RelatedMedicationId",
                table: "RestrictivePractices");

            migrationBuilder.CreateIndex(
                name: "IX_RestrictivePractices_RelatedMedicationId",
                table: "RestrictivePractices",
                column: "RelatedMedicationId",
                unique: true,
                filter: "\"RelatedMedicationId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RestrictivePractices_RelatedMedicationId",
                table: "RestrictivePractices");

            migrationBuilder.CreateIndex(
                name: "IX_RestrictivePractices_RelatedMedicationId",
                table: "RestrictivePractices",
                column: "RelatedMedicationId");

            migrationBuilder.DropColumn(
                name: "RequiresReporting",
                table: "RestrictivePractices");
        }
    }
}
