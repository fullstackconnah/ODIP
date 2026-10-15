using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddShiftCompletionAdjustments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AnythingToReport",
                table: "ShiftCompletions",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Kilometres",
                table: "ShiftCompletions",
                type: "numeric(6,1)",
                precision: 6,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "OriginalActualEnd",
                table: "ShiftCompletions",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "OriginalActualStart",
                table: "ShiftCompletions",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TimeAdjustmentReason",
                table: "ShiftCompletions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AnythingToReport",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "Kilometres",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "OriginalActualEnd",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "OriginalActualStart",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "TimeAdjustmentReason",
                table: "ShiftCompletions");
        }
    }
}
