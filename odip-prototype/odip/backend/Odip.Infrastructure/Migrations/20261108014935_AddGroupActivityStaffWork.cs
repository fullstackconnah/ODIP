using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261108014935_AddGroupActivityStaffWork")]
    public partial class AddGroupActivityStaffWork : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ActualEnd",
                table: "GroupActivityStaff",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ActualStart",
                table: "GroupActivityStaff",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AdjustedByUserId",
                table: "GroupActivityStaff",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AdjustmentReason",
                table: "GroupActivityStaff",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "BreakEndedAt",
                table: "GroupActivityStaff",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "BreakStartedAt",
                table: "GroupActivityStaff",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LocationCheck",
                table: "GroupActivityStaff",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LocationDistanceMetres",
                table: "GroupActivityStaff",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ReviewOutcome",
                table: "GroupActivityStaff",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ReviewedAt",
                table: "GroupActivityStaff",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ReviewedByUserId",
                table: "GroupActivityStaff",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "StartedAt",
                table: "GroupActivityStaff",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SubmittedAt",
                table: "GroupActivityStaff",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TimeZoneId",
                table: "GroupActivityStaff",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ActualEnd",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "ActualStart",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "AdjustedByUserId",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "AdjustmentReason",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "BreakEndedAt",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "BreakStartedAt",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "LocationCheck",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "LocationDistanceMetres",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "ReviewOutcome",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "ReviewedAt",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "ReviewedByUserId",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "StartedAt",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "SubmittedAt",
                table: "GroupActivityStaff");

            migrationBuilder.DropColumn(
                name: "TimeZoneId",
                table: "GroupActivityStaff");
        }
    }
}
