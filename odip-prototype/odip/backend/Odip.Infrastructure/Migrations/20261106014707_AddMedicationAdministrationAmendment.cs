using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261106014707_AddMedicationAdministrationAmendment")]
    public partial class AddMedicationAdministrationAmendment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "AmendedAt",
                table: "MedicationAdministrations",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AmendedByName",
                table: "MedicationAdministrations",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AmendmentNote",
                table: "MedicationAdministrations",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AmendmentReason",
                table: "MedicationAdministrations",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AmendedAt",
                table: "MedicationAdministrations");

            migrationBuilder.DropColumn(
                name: "AmendedByName",
                table: "MedicationAdministrations");

            migrationBuilder.DropColumn(
                name: "AmendmentNote",
                table: "MedicationAdministrations");

            migrationBuilder.DropColumn(
                name: "AmendmentReason",
                table: "MedicationAdministrations");
        }
    }
}
