using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPackagingAndNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Add the new column first (default 0 = WebsterPack is just a scaffold value —
            // every existing row gets overwritten by the data-migration UPDATE immediately below).
            migrationBuilder.AddColumn<int>(
                name: "Packaging",
                table: "ParticipantMedications",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Data migration: enums in this database are stored as their plain integer ordinal
            // (see the Form/Route/Type/Status/DrugSchedule/SupportLevel columns added by
            // 20260823033203_AddMedications, all `type: "integer"`) — so PackagingType.WebsterPack
            // (0) and PackagingType.OriginalPackaging (2), per the declaration order in
            // Odip.Domain/Enums/Enums.cs, are the literal values written here.
            migrationBuilder.Sql(
                """
                UPDATE "ParticipantMedications"
                SET "Packaging" = CASE WHEN "IsDoseAidPacked" = TRUE THEN 0 ELSE 2 END;
                """);

            migrationBuilder.DropColumn(
                name: "IsDoseAidPacked",
                table: "ParticipantMedications");

            migrationBuilder.CreateTable(
                name: "ParticipantNotes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    IsPinned = table.Column<bool>(type: "boolean", nullable: false),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParticipantNotes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ParticipantNotes_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ParticipantNotes_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantNotes_ParticipantId",
                table: "ParticipantNotes",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantNotes_TenantId",
                table: "ParticipantNotes",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ParticipantNotes");

            migrationBuilder.DropColumn(
                name: "Packaging",
                table: "ParticipantMedications");

            migrationBuilder.AddColumn<bool>(
                name: "IsDoseAidPacked",
                table: "ParticipantMedications",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }
    }
}
