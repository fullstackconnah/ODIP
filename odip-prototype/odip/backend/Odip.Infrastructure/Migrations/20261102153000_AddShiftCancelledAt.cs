using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261102153000_AddShiftCancelledAt")]
    public partial class AddShiftCancelledAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // When a published shift was cancelled (claims PR2). Expand-only: nullable, no default, no backfill, so a rollback to the previous image just ignores it.
            migrationBuilder.AddColumn<DateTime>(
                name: "CancelledAt",
                table: "Shifts",
                type: "timestamp without time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CancelledAt",
                table: "Shifts");
        }
    }
}
