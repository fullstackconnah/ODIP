using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddServiceAgreementDraftBlocks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PricingJson",
                table: "ServiceAgreementDrafts",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Band",
                table: "ServiceAgreementDraftLines",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BlockKey",
                table: "ServiceAgreementDraftLines",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Flags",
                table: "ServiceAgreementDraftLines",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Occurrences",
                table: "ServiceAgreementDraftLines",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Position",
                table: "ServiceAgreementDraftLines",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<decimal>(
                name: "Total",
                table: "ServiceAgreementDraftLines",
                type: "numeric(14,2)",
                precision: 14,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Unit",
                table: "ServiceAgreementDraftLines",
                type: "character varying(1)",
                maxLength: 1,
                nullable: false,
                defaultValue: "H");

            migrationBuilder.CreateTable(
                name: "ServiceAgreementDraftBlocks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DraftId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    BlockKey = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    BlockJson = table.Column<string>(type: "jsonb", nullable: false),
                    RequirementsJson = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceAgreementDraftBlocks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceAgreementDraftBlocks_ServiceAgreementDrafts_DraftId",
                        column: x => x.DraftId,
                        principalTable: "ServiceAgreementDrafts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceAgreementDraftBlocks_DraftId_BlockKey",
                table: "ServiceAgreementDraftBlocks",
                columns: new[] { "DraftId", "BlockKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ServiceAgreementDraftBlocks_DraftId_Position",
                table: "ServiceAgreementDraftBlocks",
                columns: new[] { "DraftId", "Position" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ServiceAgreementDraftBlocks");

            migrationBuilder.DropColumn(
                name: "PricingJson",
                table: "ServiceAgreementDrafts");

            migrationBuilder.DropColumn(
                name: "Band",
                table: "ServiceAgreementDraftLines");

            migrationBuilder.DropColumn(
                name: "BlockKey",
                table: "ServiceAgreementDraftLines");

            migrationBuilder.DropColumn(
                name: "Flags",
                table: "ServiceAgreementDraftLines");

            migrationBuilder.DropColumn(
                name: "Occurrences",
                table: "ServiceAgreementDraftLines");

            migrationBuilder.DropColumn(
                name: "Position",
                table: "ServiceAgreementDraftLines");

            migrationBuilder.DropColumn(
                name: "Total",
                table: "ServiceAgreementDraftLines");

            migrationBuilder.DropColumn(
                name: "Unit",
                table: "ServiceAgreementDraftLines");
        }
    }
}
