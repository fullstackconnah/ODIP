using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMedicationScheduleAndWitness : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "AnchorDate",
                table: "ParticipantMedications",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DaysOfWeek",
                table: "ParticipantMedications",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Frequency",
                table: "ParticipantMedications",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "IntervalDays",
                table: "ParticipantMedications",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "WitnessRequestedAt",
                table: "MedicationAdministrations",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "WitnessRespondedAt",
                table: "MedicationAdministrations",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "WitnessStaffId",
                table: "MedicationAdministrations",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WitnessStatus",
                table: "MedicationAdministrations",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_MedicationAdministrations_WitnessStaffId_WitnessStatus",
                table: "MedicationAdministrations",
                columns: new[] { "WitnessStaffId", "WitnessStatus" });

            migrationBuilder.AddForeignKey(
                name: "FK_MedicationAdministrations_Staff_WitnessStaffId",
                table: "MedicationAdministrations",
                column: "WitnessStaffId",
                principalTable: "Staff",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_MedicationAdministrations_Staff_WitnessStaffId",
                table: "MedicationAdministrations");

            migrationBuilder.DropIndex(
                name: "IX_MedicationAdministrations_WitnessStaffId_WitnessStatus",
                table: "MedicationAdministrations");

            migrationBuilder.DropColumn(
                name: "AnchorDate",
                table: "ParticipantMedications");

            migrationBuilder.DropColumn(
                name: "DaysOfWeek",
                table: "ParticipantMedications");

            migrationBuilder.DropColumn(
                name: "Frequency",
                table: "ParticipantMedications");

            migrationBuilder.DropColumn(
                name: "IntervalDays",
                table: "ParticipantMedications");

            migrationBuilder.DropColumn(
                name: "WitnessRequestedAt",
                table: "MedicationAdministrations");

            migrationBuilder.DropColumn(
                name: "WitnessRespondedAt",
                table: "MedicationAdministrations");

            migrationBuilder.DropColumn(
                name: "WitnessStaffId",
                table: "MedicationAdministrations");

            migrationBuilder.DropColumn(
                name: "WitnessStatus",
                table: "MedicationAdministrations");
        }
    }
}
