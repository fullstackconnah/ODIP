using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddEmploymentHeroLeave : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ExternalLeaveId",
                table: "LeaveRequests",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "SentHours",
                table: "LeaveRequests",
                type: "numeric(6,2)",
                precision: 6,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "SentHoursDefaulted",
                table: "LeaveRequests",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Source",
                table: "LeaveRequests",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "LeaveCategoryAnnual",
                table: "EmploymentHeroConnections",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LeaveCategoryOther",
                table: "EmploymentHeroConnections",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LeaveCategoryPersonal",
                table: "EmploymentHeroConnections",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LeaveCategorySick",
                table: "EmploymentHeroConnections",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_LeaveRequests_TenantId_ExternalLeaveId",
                table: "LeaveRequests",
                columns: new[] { "TenantId", "ExternalLeaveId" },
                unique: true,
                filter: "\"ExternalLeaveId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_LeaveRequests_TenantId_ExternalLeaveId",
                table: "LeaveRequests");

            migrationBuilder.DropColumn(
                name: "ExternalLeaveId",
                table: "LeaveRequests");

            migrationBuilder.DropColumn(
                name: "SentHours",
                table: "LeaveRequests");

            migrationBuilder.DropColumn(
                name: "SentHoursDefaulted",
                table: "LeaveRequests");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "LeaveRequests");

            migrationBuilder.DropColumn(
                name: "LeaveCategoryAnnual",
                table: "EmploymentHeroConnections");

            migrationBuilder.DropColumn(
                name: "LeaveCategoryOther",
                table: "EmploymentHeroConnections");

            migrationBuilder.DropColumn(
                name: "LeaveCategoryPersonal",
                table: "EmploymentHeroConnections");

            migrationBuilder.DropColumn(
                name: "LeaveCategorySick",
                table: "EmploymentHeroConnections");
        }
    }
}
