using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddShiftRoutineCheckSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ShiftRoutineChecks_ParticipantRoutines_ParticipantRoutineId",
                table: "ShiftRoutineChecks");

            migrationBuilder.AddColumn<string>(
                name: "RoutineTitle",
                table: "ShiftRoutineChecks",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddForeignKey(
                name: "FK_ShiftRoutineChecks_ParticipantRoutines_ParticipantRoutineId",
                table: "ShiftRoutineChecks",
                column: "ParticipantRoutineId",
                principalTable: "ParticipantRoutines",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ShiftRoutineChecks_ParticipantRoutines_ParticipantRoutineId",
                table: "ShiftRoutineChecks");

            migrationBuilder.DropColumn(
                name: "RoutineTitle",
                table: "ShiftRoutineChecks");

            migrationBuilder.AddForeignKey(
                name: "FK_ShiftRoutineChecks_ParticipantRoutines_ParticipantRoutineId",
                table: "ShiftRoutineChecks",
                column: "ParticipantRoutineId",
                principalTable: "ParticipantRoutines",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
