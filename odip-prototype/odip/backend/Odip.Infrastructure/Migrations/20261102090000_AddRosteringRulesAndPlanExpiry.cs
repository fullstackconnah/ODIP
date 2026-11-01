using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddRosteringRulesAndPlanExpiry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Existing organisations get 15 and 30, the values that used to be fixed.
            migrationBuilder.AddColumn<int>(
                name: "PlanExpiryWarningDays",
                table: "AppSettings",
                type: "integer",
                nullable: false,
                defaultValue: 30);

            migrationBuilder.AddColumn<int>(
                name: "VarianceReviewMinutes",
                table: "AppSettings",
                type: "integer",
                nullable: false,
                defaultValue: 15);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PlanExpiryWarningDays",
                table: "AppSettings");

            migrationBuilder.DropColumn(
                name: "VarianceReviewMinutes",
                table: "AppSettings");
        }
    }
}
