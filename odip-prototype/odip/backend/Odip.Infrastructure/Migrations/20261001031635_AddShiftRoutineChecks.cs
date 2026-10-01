using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddShiftRoutineChecks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ShiftRoutineChecks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ShiftCompletionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantRoutineId = table.Column<Guid>(type: "uuid", nullable: false),
                    ScheduledAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    CheckedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CheckedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShiftRoutineChecks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShiftRoutineChecks_ParticipantRoutines_ParticipantRoutineId",
                        column: x => x.ParticipantRoutineId,
                        principalTable: "ParticipantRoutines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ShiftRoutineChecks_ShiftCompletions_ShiftCompletionId",
                        column: x => x.ShiftCompletionId,
                        principalTable: "ShiftCompletions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ShiftRoutineChecks_Users_CheckedByUserId",
                        column: x => x.CheckedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ShiftRoutineChecks_CheckedByUserId",
                table: "ShiftRoutineChecks",
                column: "CheckedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftRoutineChecks_Completion_Routine_ScheduledAt",
                table: "ShiftRoutineChecks",
                columns: new[] { "ShiftCompletionId", "ParticipantRoutineId", "ScheduledAt" },
                unique: true,
                filter: "\"ScheduledAt\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftRoutineChecks_Completion_Routine_Untimed",
                table: "ShiftRoutineChecks",
                columns: new[] { "ShiftCompletionId", "ParticipantRoutineId" },
                unique: true,
                filter: "\"ScheduledAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftRoutineChecks_ParticipantRoutineId",
                table: "ShiftRoutineChecks",
                column: "ParticipantRoutineId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftRoutineChecks_TenantId",
                table: "ShiftRoutineChecks",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftRoutineChecks_TenantId_ShiftCompletionId",
                table: "ShiftRoutineChecks",
                columns: new[] { "TenantId", "ShiftCompletionId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ShiftRoutineChecks");
        }
    }
}
