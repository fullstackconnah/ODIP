using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddIncidentSourceLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "MedicationAdministrationId",
                table: "IncidentReports",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ShiftId",
                table: "IncidentReports",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ShiftNoteId",
                table: "IncidentReports",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_MedicationAdministrationId",
                table: "IncidentReports",
                column: "MedicationAdministrationId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_ShiftId",
                table: "IncidentReports",
                column: "ShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_ShiftNoteId",
                table: "IncidentReports",
                column: "ShiftNoteId");

            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_MedicationAdministrations_MedicationAdminis~",
                table: "IncidentReports",
                column: "MedicationAdministrationId",
                principalTable: "MedicationAdministrations",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_ShiftNotes_ShiftNoteId",
                table: "IncidentReports",
                column: "ShiftNoteId",
                principalTable: "ShiftNotes",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_Shifts_ShiftId",
                table: "IncidentReports",
                column: "ShiftId",
                principalTable: "Shifts",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_IncidentReports_MedicationAdministrations_MedicationAdminis~",
                table: "IncidentReports");

            migrationBuilder.DropForeignKey(
                name: "FK_IncidentReports_ShiftNotes_ShiftNoteId",
                table: "IncidentReports");

            migrationBuilder.DropForeignKey(
                name: "FK_IncidentReports_Shifts_ShiftId",
                table: "IncidentReports");

            migrationBuilder.DropIndex(
                name: "IX_IncidentReports_MedicationAdministrationId",
                table: "IncidentReports");

            migrationBuilder.DropIndex(
                name: "IX_IncidentReports_ShiftId",
                table: "IncidentReports");

            migrationBuilder.DropIndex(
                name: "IX_IncidentReports_ShiftNoteId",
                table: "IncidentReports");

            migrationBuilder.DropColumn(
                name: "MedicationAdministrationId",
                table: "IncidentReports");

            migrationBuilder.DropColumn(
                name: "ShiftId",
                table: "IncidentReports");

            migrationBuilder.DropColumn(
                name: "ShiftNoteId",
                table: "IncidentReports");
        }
    }
}
