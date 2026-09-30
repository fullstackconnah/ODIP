using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddShiftHandover : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "HandoverText",
                table: "ShiftCompletions",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NothingToHandOver",
                table: "ShiftCompletions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "NothingToNoteConfirmed",
                table: "ShiftCompletions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "HandoverAcknowledgements",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceCompletionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ShiftId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AcknowledgedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HandoverAcknowledgements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HandoverAcknowledgements_ShiftCompletions_SourceCompletionId",
                        column: x => x.SourceCompletionId,
                        principalTable: "ShiftCompletions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HandoverAcknowledgements_Shifts_ShiftId",
                        column: x => x.ShiftId,
                        principalTable: "Shifts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HandoverAcknowledgements_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HandoverAcknowledgements_ShiftId",
                table: "HandoverAcknowledgements",
                column: "ShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_HandoverAcknowledgements_SourceCompletionId_UserId",
                table: "HandoverAcknowledgements",
                columns: new[] { "SourceCompletionId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HandoverAcknowledgements_TenantId",
                table: "HandoverAcknowledgements",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_HandoverAcknowledgements_TenantId_ShiftId",
                table: "HandoverAcknowledgements",
                columns: new[] { "TenantId", "ShiftId" });

            migrationBuilder.CreateIndex(
                name: "IX_HandoverAcknowledgements_UserId",
                table: "HandoverAcknowledgements",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HandoverAcknowledgements");

            migrationBuilder.DropColumn(
                name: "HandoverText",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "NothingToHandOver",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "NothingToNoteConfirmed",
                table: "ShiftCompletions");
        }
    }
}
