using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261107224004_AddGroupActivities")]
    public partial class AddGroupActivities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "GroupActivitiesEnabled",
                table: "AppSettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "GroupActivityId",
                table: "Shifts",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "GroupActivities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ServiceDate = table.Column<DateOnly>(type: "date", nullable: false),
                    StartTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EndTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EndsNextDay = table.Column<bool>(type: "boolean", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ActivityId = table.Column<Guid>(type: "uuid", nullable: true),
                    Location = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ServiceLocationId = table.Column<Guid>(type: "uuid", nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    MinStaffRequired = table.Column<int>(type: "integer", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    CancelledAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupActivities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GroupActivities_Activities_ActivityId",
                        column: x => x.ActivityId,
                        principalTable: "Activities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GroupActivities_ServiceLocations_ServiceLocationId",
                        column: x => x.ServiceLocationId,
                        principalTable: "ServiceLocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GroupActivityStaff",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupActivityId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EndTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EndsNextDay = table.Column<bool>(type: "boolean", nullable: false),
                    Role = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    OverrideReason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    AcknowledgedFindingCodes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupActivityStaff", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GroupActivityStaff_GroupActivities_GroupActivityId",
                        column: x => x.GroupActivityId,
                        principalTable: "GroupActivities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupActivityStaff_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Shifts_GroupActivityId",
                table: "Shifts",
                column: "GroupActivityId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupActivities_ActivityId",
                table: "GroupActivities",
                column: "ActivityId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupActivities_ServiceLocationId",
                table: "GroupActivities",
                column: "ServiceLocationId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupActivities_TenantId_ServiceDate",
                table: "GroupActivities",
                columns: new[] { "TenantId", "ServiceDate" });

            migrationBuilder.CreateIndex(
                name: "IX_GroupActivityStaff_GroupActivityId_UserId",
                table: "GroupActivityStaff",
                columns: new[] { "GroupActivityId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GroupActivityStaff_TenantId_UserId",
                table: "GroupActivityStaff",
                columns: new[] { "TenantId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_GroupActivityStaff_UserId",
                table: "GroupActivityStaff",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Shifts_GroupActivities_GroupActivityId",
                table: "Shifts",
                column: "GroupActivityId",
                principalTable: "GroupActivities",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Shifts_GroupActivities_GroupActivityId",
                table: "Shifts");

            migrationBuilder.DropTable(
                name: "GroupActivityStaff");

            migrationBuilder.DropTable(
                name: "GroupActivities");

            migrationBuilder.DropIndex(
                name: "IX_Shifts_GroupActivityId",
                table: "Shifts");

            migrationBuilder.DropColumn(
                name: "GroupActivityId",
                table: "Shifts");

            migrationBuilder.DropColumn(
                name: "GroupActivitiesEnabled",
                table: "AppSettings");
        }
    }
}
