using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261102140000_AddClaimLineShiftPart")]
    public partial class AddClaimLineShiftPart : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // A shift claims as one line per rate band, so a shift can have several lines that count: they are told apart by their part (0 for every line made before this).
            migrationBuilder.AddColumn<int>(
                name: "ShiftPart",
                table: "ClaimLineItems",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.DropIndex(
                name: "IX_ClaimLineItems_ShiftId_Counting",
                table: "ClaimLineItems");

            migrationBuilder.CreateIndex(
                name: "IX_ClaimLineItems_ShiftId_ShiftPart_Counting",
                table: "ClaimLineItems",
                columns: new[] { "ShiftId", "ShiftPart" },
                unique: true,
                filter: "\"ShiftId\" IS NOT NULL AND \"Status\" <> 5");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ClaimLineItems_ShiftId_ShiftPart_Counting",
                table: "ClaimLineItems");

            migrationBuilder.DropColumn(
                name: "ShiftPart",
                table: "ClaimLineItems");

            migrationBuilder.CreateIndex(
                name: "IX_ClaimLineItems_ShiftId_Counting",
                table: "ClaimLineItems",
                column: "ShiftId",
                unique: true,
                filter: "\"ShiftId\" IS NOT NULL AND \"Status\" <> 5");
        }
    }
}
