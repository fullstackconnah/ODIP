using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddShiftCompletion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ReturnCount",
                table: "Shifts",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "ShiftCompletions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ShiftId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActualStart = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    ActualEnd = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    TimeZoneId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    StartLatitude = table.Column<decimal>(type: "numeric", nullable: true),
                    StartLongitude = table.Column<decimal>(type: "numeric", nullable: true),
                    EndLatitude = table.Column<decimal>(type: "numeric", nullable: true),
                    EndLongitude = table.Column<decimal>(type: "numeric", nullable: true),
                    GeolocationDeclined = table.Column<bool>(type: "boolean", nullable: false),
                    StartWasManual = table.Column<bool>(type: "boolean", nullable: false),
                    SubmittedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    SubmittedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    ReviewedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReviewedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    ReviewOutcome = table.Column<int>(type: "integer", nullable: true),
                    ReturnReason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    VarianceMinutesStart = table.Column<int>(type: "integer", nullable: false),
                    VarianceMinutesEnd = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShiftCompletions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShiftCompletions_Shifts_ShiftId",
                        column: x => x.ShiftId,
                        principalTable: "Shifts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ShiftCompletions_ShiftId_Active",
                table: "ShiftCompletions",
                column: "ShiftId",
                unique: true,
                filter: "\"IsActive\"");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftCompletions_TenantId",
                table: "ShiftCompletions",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftCompletions_TenantId_ShiftId",
                table: "ShiftCompletions",
                columns: new[] { "TenantId", "ShiftId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "ReturnCount",
                table: "Shifts");
        }
    }
}
