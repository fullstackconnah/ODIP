using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddScheduledActivityTrackingFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BookingReference",
                table: "ScheduledActivities",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "EstimatedCost",
                table: "ScheduledActivities",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProviderEmail",
                table: "ScheduledActivities",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProviderName",
                table: "ScheduledActivities",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProviderPhone",
                table: "ScheduledActivities",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProviderWebsite",
                table: "ScheduledActivities",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Status",
                table: "ScheduledActivities",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledActivities_Status",
                table: "ScheduledActivities",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ScheduledActivities_Status",
                table: "ScheduledActivities");

            migrationBuilder.DropColumn(
                name: "BookingReference",
                table: "ScheduledActivities");

            migrationBuilder.DropColumn(
                name: "EstimatedCost",
                table: "ScheduledActivities");

            migrationBuilder.DropColumn(
                name: "ProviderEmail",
                table: "ScheduledActivities");

            migrationBuilder.DropColumn(
                name: "ProviderName",
                table: "ScheduledActivities");

            migrationBuilder.DropColumn(
                name: "ProviderPhone",
                table: "ScheduledActivities");

            migrationBuilder.DropColumn(
                name: "ProviderWebsite",
                table: "ScheduledActivities");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "ScheduledActivities");
        }
    }
}
