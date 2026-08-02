using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddInsuranceTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "InsuranceCoverageEnd",
                table: "ParticipantBookings",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "InsuranceCoverageStart",
                table: "ParticipantBookings",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InsurancePolicyNumber",
                table: "ParticipantBookings",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InsuranceProvider",
                table: "ParticipantBookings",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "InsuranceStatus",
                table: "ParticipantBookings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantBookings_InsuranceStatus",
                table: "ParticipantBookings",
                column: "InsuranceStatus");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ParticipantBookings_InsuranceStatus",
                table: "ParticipantBookings");

            migrationBuilder.DropColumn(
                name: "InsuranceCoverageEnd",
                table: "ParticipantBookings");

            migrationBuilder.DropColumn(
                name: "InsuranceCoverageStart",
                table: "ParticipantBookings");

            migrationBuilder.DropColumn(
                name: "InsurancePolicyNumber",
                table: "ParticipantBookings");

            migrationBuilder.DropColumn(
                name: "InsuranceProvider",
                table: "ParticipantBookings");

            migrationBuilder.DropColumn(
                name: "InsuranceStatus",
                table: "ParticipantBookings");
        }
    }
}
