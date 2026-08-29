using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddRestrictivePractices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RestrictivePractices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    AuthorisedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    AuthorisationDate = table.Column<DateOnly>(type: "date", nullable: true),
                    ReviewDate = table.Column<DateOnly>(type: "date", nullable: true),
                    RelatedMedicationId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RestrictivePractices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RestrictivePractices_ParticipantMedications_RelatedMedicati~",
                        column: x => x.RelatedMedicationId,
                        principalTable: "ParticipantMedications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_RestrictivePractices_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RestrictivePractices_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RestrictivePractices_ParticipantId",
                table: "RestrictivePractices",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_RestrictivePractices_RelatedMedicationId",
                table: "RestrictivePractices",
                column: "RelatedMedicationId");

            migrationBuilder.CreateIndex(
                name: "IX_RestrictivePractices_TenantId",
                table: "RestrictivePractices",
                column: "TenantId");

            // gen_random_uuid() was folded into Postgres core in v13, but pre-13 databases only
            // have it via pgcrypto — creating the extension is a harmless no-op on 13+ (the core
            // function takes precedence) and makes the backfill below work on either version.
            migrationBuilder.Sql("""CREATE EXTENSION IF NOT EXISTS pgcrypto;""");

            // Data backfill (a): one Unclassified register row per participant whose
            // SupportProfile.RestrictivePracticeDetails is non-empty legacy free text.
            // RestrictivePracticeType.Unclassified = 5 (see its declaration order in Enums.cs) —
            // enums in this database are stored as their plain integer ordinal, same idiom as the
            // AddPackagingAndNotes/AddParticipantMobilityOvernightEquipment migrations.
            migrationBuilder.Sql(
                """
                INSERT INTO "RestrictivePractices"
                    ("Id", "TenantId", "ParticipantId", "Type", "Description", "AuthorisedBy",
                     "AuthorisationDate", "ReviewDate", "RelatedMedicationId", "IsActive", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), p."TenantId", p."Id", 5, sp."RestrictivePracticeDetails",
                       NULL, NULL, NULL, NULL, TRUE, NOW(), NOW()
                FROM "SupportProfiles" sp
                JOIN "Participants" p ON p."Id" = sp."ParticipantId"
                WHERE sp."RestrictivePracticeDetails" IS NOT NULL
                  AND trim(sp."RestrictivePracticeDetails") <> '';
                """);

            // Data backfill (b): one ChemicalRestraint register row per ParticipantMedication
            // with IsChemicalRestraint = TRUE, linked back via RelatedMedicationId.
            // RestrictivePracticeType.ChemicalRestraint = 1 (see its declaration order in Enums.cs).
            migrationBuilder.Sql(
                """
                INSERT INTO "RestrictivePractices"
                    ("Id", "TenantId", "ParticipantId", "Type", "Description", "AuthorisedBy",
                     "AuthorisationDate", "ReviewDate", "RelatedMedicationId", "IsActive", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), m."TenantId", m."ParticipantId", 1, m."Name",
                       NULL, NULL, NULL, m."Id", TRUE, NOW(), NOW()
                FROM "ParticipantMedications" m
                WHERE m."IsChemicalRestraint" = TRUE;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RestrictivePractices");
        }
    }
}
