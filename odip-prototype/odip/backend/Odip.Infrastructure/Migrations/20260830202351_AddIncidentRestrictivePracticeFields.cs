using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddIncidentRestrictivePracticeFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsRestrictivePracticeAuthorised",
                table: "IncidentReports",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "RestrictivePracticeId",
                table: "IncidentReports",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RestrictivePracticeType",
                table: "IncidentReports",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_RestrictivePracticeId",
                table: "IncidentReports",
                column: "RestrictivePracticeId");

            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_RestrictivePractices_RestrictivePracticeId",
                table: "IncidentReports",
                column: "RestrictivePracticeId",
                principalTable: "RestrictivePractices",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_IncidentReports_RestrictivePractices_RestrictivePracticeId",
                table: "IncidentReports");

            migrationBuilder.DropIndex(
                name: "IX_IncidentReports_RestrictivePracticeId",
                table: "IncidentReports");

            migrationBuilder.DropColumn(
                name: "IsRestrictivePracticeAuthorised",
                table: "IncidentReports");

            migrationBuilder.DropColumn(
                name: "RestrictivePracticeId",
                table: "IncidentReports");

            migrationBuilder.DropColumn(
                name: "RestrictivePracticeType",
                table: "IncidentReports");
        }
    }
}
