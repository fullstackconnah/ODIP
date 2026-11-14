using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20260830185846_AddMedicationAdministrationRecordedByUserAndTimeZone")]
    public partial class AddMedicationAdministrationRecordedByUserAndTimeZone : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AdministeredAtTimeZone",
                table: "MedicationAdministrations",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "RecordedByUserId",
                table: "MedicationAdministrations",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_MedicationAdministrations_RecordedByUserId",
                table: "MedicationAdministrations",
                column: "RecordedByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_MedicationAdministrations_Users_RecordedByUserId",
                table: "MedicationAdministrations",
                column: "RecordedByUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_MedicationAdministrations_Users_RecordedByUserId",
                table: "MedicationAdministrations");

            migrationBuilder.DropIndex(
                name: "IX_MedicationAdministrations_RecordedByUserId",
                table: "MedicationAdministrations");

            migrationBuilder.DropColumn(
                name: "AdministeredAtTimeZone",
                table: "MedicationAdministrations");

            migrationBuilder.DropColumn(
                name: "RecordedByUserId",
                table: "MedicationAdministrations");
        }
    }
}
