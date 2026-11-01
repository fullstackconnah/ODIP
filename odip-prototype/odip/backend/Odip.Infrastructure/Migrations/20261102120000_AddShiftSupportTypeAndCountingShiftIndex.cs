using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddShiftSupportTypeAndCountingShiftIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SupportGroupCode",
                table: "Shifts",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SupportGroupCode",
                table: "ShiftPatterns",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ClaimLineItems_ShiftId_Counting",
                table: "ClaimLineItems",
                column: "ShiftId",
                unique: true,
                filter: "\"ShiftId\" IS NOT NULL AND \"Status\" <> 5");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ClaimLineItems_ShiftId_Counting",
                table: "ClaimLineItems");

            migrationBuilder.DropColumn(
                name: "SupportGroupCode",
                table: "Shifts");

            migrationBuilder.DropColumn(
                name: "SupportGroupCode",
                table: "ShiftPatterns");
        }
    }
}
