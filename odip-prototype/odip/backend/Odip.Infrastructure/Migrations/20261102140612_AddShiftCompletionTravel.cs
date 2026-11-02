using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddShiftCompletionTravel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Provider travel, two legs (travel PR-A1). Expand-only: nullable, no default, no backfill, so a rollback to the previous image just ignores them.
            migrationBuilder.AddColumn<int>(
                name: "PreShiftTravelMinutes",
                table: "ShiftCompletions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "PreShiftTravelKilometres",
                table: "ShiftCompletions",
                type: "numeric(6,1)",
                precision: 6,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PostShiftTravelMinutes",
                table: "ShiftCompletions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "PostShiftTravelKilometres",
                table: "ShiftCompletions",
                type: "numeric(6,1)",
                precision: 6,
                scale: 1,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PreShiftTravelMinutes",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "PreShiftTravelKilometres",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "PostShiftTravelMinutes",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "PostShiftTravelKilometres",
                table: "ShiftCompletions");
        }
    }
}
