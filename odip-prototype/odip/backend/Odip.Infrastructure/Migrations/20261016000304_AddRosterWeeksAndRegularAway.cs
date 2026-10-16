using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddRosterWeeksAndRegularAway : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "RegularAwayReason",
                table: "Shifts",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "RegularUserId",
                table: "Shifts",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "RosterWeeks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    WeekStart = table.Column<DateOnly>(type: "date", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    StartedByUserId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RosterWeeks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RosterWeeks_Users_StartedByUserId",
                        column: x => x.StartedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Shifts_RegularUserId",
                table: "Shifts",
                column: "RegularUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RosterWeeks_StartedByUserId",
                table: "RosterWeeks",
                column: "StartedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RosterWeeks_TenantId_WeekStart",
                table: "RosterWeeks",
                columns: new[] { "TenantId", "WeekStart" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Shifts_Users_RegularUserId",
                table: "Shifts",
                column: "RegularUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Shifts_Users_RegularUserId",
                table: "Shifts");

            migrationBuilder.DropTable(
                name: "RosterWeeks");

            migrationBuilder.DropIndex(
                name: "IX_Shifts_RegularUserId",
                table: "Shifts");

            migrationBuilder.DropColumn(
                name: "RegularAwayReason",
                table: "Shifts");

            migrationBuilder.DropColumn(
                name: "RegularUserId",
                table: "Shifts");
        }
    }
}
