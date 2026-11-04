using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddShiftCompletionLocationCheck : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Owner decision (2026-11-04): a worker's coordinates are never kept. Dropping the four columns deletes the stored values; down cannot bring them back.
            migrationBuilder.DropColumn(
                name: "EndLatitude",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "EndLongitude",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "StartLatitude",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "StartLongitude",
                table: "ShiftCompletions");

            migrationBuilder.AddColumn<int>(
                name: "LocationAccuracyMetres",
                table: "ShiftCompletions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LocationCheck",
                table: "ShiftCompletions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LocationCheckedAt",
                table: "ShiftCompletions",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LocationDistanceMetres",
                table: "ShiftCompletions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LocationReason",
                table: "ShiftCompletions",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LocationAccuracyMetres",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "LocationCheck",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "LocationCheckedAt",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "LocationDistanceMetres",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "LocationReason",
                table: "ShiftCompletions");

            migrationBuilder.AddColumn<decimal>(
                name: "EndLatitude",
                table: "ShiftCompletions",
                type: "numeric",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "EndLongitude",
                table: "ShiftCompletions",
                type: "numeric",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "StartLatitude",
                table: "ShiftCompletions",
                type: "numeric",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "StartLongitude",
                table: "ShiftCompletions",
                type: "numeric",
                nullable: true);
        }
    }
}
