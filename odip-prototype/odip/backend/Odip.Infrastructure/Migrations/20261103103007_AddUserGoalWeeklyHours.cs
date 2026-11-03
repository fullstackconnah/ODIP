using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddUserGoalWeeklyHours : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The hours a week a person aims to work, which auto-roster (R7) balances towards. Expand-only: nullable, no default, no backfill, so a rollback to the previous image just ignores it.
            migrationBuilder.AddColumn<decimal>(
                name: "GoalWeeklyHours",
                table: "Users",
                type: "numeric",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "GoalWeeklyHours",
                table: "Users");
        }
    }
}
