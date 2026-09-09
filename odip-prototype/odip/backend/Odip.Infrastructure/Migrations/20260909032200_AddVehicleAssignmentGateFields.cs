using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddVehicleAssignmentGateFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AcknowledgedFindingCodes",
                table: "VehicleAssignments",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasConflict",
                table: "VehicleAssignments",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "OverrideReason",
                table: "VehicleAssignments",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AcknowledgedFindingCodes",
                table: "VehicleAssignments");

            migrationBuilder.DropColumn(
                name: "HasConflict",
                table: "VehicleAssignments");

            migrationBuilder.DropColumn(
                name: "OverrideReason",
                table: "VehicleAssignments");
        }
    }
}
