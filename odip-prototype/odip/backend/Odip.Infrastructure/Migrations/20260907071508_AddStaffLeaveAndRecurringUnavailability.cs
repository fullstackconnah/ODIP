using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddStaffLeaveAndRecurringUnavailability : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AcknowledgedFindingCodes",
                table: "StaffAssignments",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OverrideReason",
                table: "StaffAssignments",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "LeaveRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LeaveType = table.Column<int>(type: "integer", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    RequestedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    DecidedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DecidedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    DecisionNote = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LeaveRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LeaveRequests_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RecurringUnavailabilities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    DayOfWeek = table.Column<int>(type: "integer", nullable: false),
                    StartTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EndTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EffectiveFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    EffectiveTo = table.Column<DateOnly>(type: "date", nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    RequestedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    DecidedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DecidedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    DecisionNote = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecurringUnavailabilities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RecurringUnavailabilities_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LeaveRequests_TenantId",
                table: "LeaveRequests",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_LeaveRequests_TenantId_StartDate_EndDate",
                table: "LeaveRequests",
                columns: new[] { "TenantId", "StartDate", "EndDate" });

            migrationBuilder.CreateIndex(
                name: "IX_LeaveRequests_TenantId_UserId_Status",
                table: "LeaveRequests",
                columns: new[] { "TenantId", "UserId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_LeaveRequests_UserId",
                table: "LeaveRequests",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_RecurringUnavailabilities_TenantId",
                table: "RecurringUnavailabilities",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_RecurringUnavailabilities_TenantId_UserId_Status",
                table: "RecurringUnavailabilities",
                columns: new[] { "TenantId", "UserId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_RecurringUnavailabilities_UserId",
                table: "RecurringUnavailabilities",
                column: "UserId");

            // ── Data step (hand-added, not generated): migrate legacy Leave-type
            // StaffAvailability rows into LeaveRequest, then delete the source rows. Approved
            // (LeaveStatus = 1), LeaveType.Other (3) — a coordinator-entered legacy row carries
            // no distinction finer than "leave", and Other is the correct bucket for that.
            // TenantId comes from the row's User (StaffAvailability itself is not tenant-scoped).
            // RequestedAt/RequestedByUserId are backfilled from the row itself (CreatedAt, UserId)
            // since there is no real "who requested this" data pre-migration — every legacy row
            // was coordinator-entered, so the staff member "requesting" their own past entry is
            // the closest available fact. AvailabilityType = 2 is Leave (Available=0, Unavailable=1,
            // Leave=2, Training=3, Preferred=4, Tentative=5 — Odip.Domain.Enums.AvailabilityType).
            migrationBuilder.Sql(
                """
                INSERT INTO "LeaveRequests"
                    ("Id", "TenantId", "UserId", "LeaveType", "StartDate", "EndDate", "Status",
                     "Reason", "RequestedByUserId", "RequestedAt", "DecidedByUserId", "DecidedAt",
                     "DecisionNote", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), u."TenantId", sa."UserId", 3,
                       sa."StartDateTime"::date, sa."EndDateTime"::date, 1,
                       sa."Notes", sa."UserId", sa."CreatedAt", NULL, NULL, NULL,
                       sa."CreatedAt", sa."UpdatedAt"
                FROM "StaffAvailabilities" sa
                JOIN "Users" u ON u."Id" = sa."UserId"
                WHERE sa."AvailabilityType" = 2;

                DELETE FROM "StaffAvailabilities" WHERE "AvailabilityType" = 2;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Data step reversal: re-create the StaffAvailability rows this migration deleted,
            // sourced from the LeaveRequest rows it just inserted. Identifying those rows needs
            // FOUR conditions, not three: LeaveType = 3/Other AND Status = 1/Approved (Up() always
            // writes both) AND DecidedByUserId IS NULL AND DecisionNote IS NULL. Status = 1 is
            // load-bearing — without it this filter also matches a staff member's own Pending
            // "Other" leave request submitted through PortalController.CreateMyLeaveRequest (Task
            // 8) after this migration ran, since a fresh portal submission carries the identical
            // LeaveType/DecidedByUserId/DecisionNote signature (Pending, undecided, no note) as a
            // migrated row. Without Status = 1, running this Down() against a database that has
            // taken real staff leave submissions since Up() ran would silently vacuum any such
            // pending request back into the legacy StaffAvailability table as a fabricated
            // historical Unavailable row, with no error. A real coordinator-entered Other leave
            // request via LeaveController also carries a DecidedByUserId (on-behalf entries land
            // Approved with the coordinator recorded as decider), so it is excluded by the
            // DecidedByUserId check regardless. This is still a best-effort reversal for local/dev
            // rollback, not a guarantee for a database that has taken live writes since — same
            // caveat as every other one-way data migration in this codebase (see
            // BackfillParticipantIntakeCompletedAt's Down()).
            migrationBuilder.Sql(
                """
                INSERT INTO "StaffAvailabilities"
                    ("Id", "UserId", "StartDateTime", "EndDateTime", "AvailabilityType",
                     "IsRecurring", "RecurrenceNotes", "Notes", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), "UserId", "StartDate"::timestamp, "EndDate"::timestamp, 2,
                       false, NULL, "Reason", "CreatedAt", "UpdatedAt"
                FROM "LeaveRequests"
                WHERE "LeaveType" = 3 AND "Status" = 1 AND "DecidedByUserId" IS NULL AND "DecisionNote" IS NULL;
                """);

            migrationBuilder.DropTable(
                name: "LeaveRequests");

            migrationBuilder.DropTable(
                name: "RecurringUnavailabilities");

            migrationBuilder.DropColumn(
                name: "AcknowledgedFindingCodes",
                table: "StaffAssignments");

            migrationBuilder.DropColumn(
                name: "OverrideReason",
                table: "StaffAssignments");
        }
    }
}
