using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddReferralSources : Migration
    {
        /// <summary>
        /// Gives every organisation that exists when the migration runs the nine starter sources. Idempotent (ON CONFLICT on the unique name), so a re-run adds nothing.
        /// The ids come from the database, the stamps are UTC as EF stores them, and the names match StarterReferralSources (a migration keeps its own copy: it must never change).
        /// </summary>
        public const string SeedStarterSql = """
            INSERT INTO "ReferralSources" ("Id", "TenantId", "Name", "IsActive", "CreatedAt", "UpdatedAt")
            SELECT gen_random_uuid(), t."Id", n."Name", true, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
            FROM "Tenants" t
            CROSS JOIN (VALUES ('Support Coordinator'), ('Local Area Coordinator (LAC)'), ('NDIA planner'), ('GP or health professional'), ('Hospital'), ('Another provider'), ('Family or friend'), ('Self-referral'), ('Website or search')) AS n("Name")
            ON CONFLICT ("TenantId", "Name") DO NOTHING;
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReferralSources",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReferralSources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReferralSources_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReferralSources_TenantId",
                table: "ReferralSources",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_ReferralSources_TenantId_Name",
                table: "ReferralSources",
                columns: new[] { "TenantId", "Name" },
                unique: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ReferralSourceId",
                table: "ParticipantInquiries",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantInquiries_ReferralSourceId",
                table: "ParticipantInquiries",
                column: "ReferralSourceId");

            migrationBuilder.AddForeignKey(
                name: "FK_ParticipantInquiries_ReferralSources_ReferralSourceId",
                table: "ParticipantInquiries",
                column: "ReferralSourceId",
                principalTable: "ReferralSources",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // After the table and its unique index exist, so ON CONFLICT has an index to conflict on.
            migrationBuilder.Sql(SeedStarterSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ParticipantInquiries_ReferralSources_ReferralSourceId",
                table: "ParticipantInquiries");

            migrationBuilder.DropIndex(
                name: "IX_ParticipantInquiries_ReferralSourceId",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "ReferralSourceId",
                table: "ParticipantInquiries");

            migrationBuilder.DropTable(
                name: "ReferralSources");
        }
    }
}
