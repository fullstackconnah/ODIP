using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20260327084507_AddPaymentStatusToBooking")]
    public partial class AddPaymentStatusToBooking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_IncidentReports_TripInstances_TripInstanceId",
                table: "IncidentReports");

            migrationBuilder.DropColumn(
                name: "OopPaymentStatus",
                table: "ParticipantBookings");

            migrationBuilder.AddColumn<DateOnly>(
                name: "DriverLicenceExpiryDate",
                table: "Staff",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "FirstAidExpiryDate",
                table: "Staff",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ManualHandlingExpiryDate",
                table: "Staff",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "MedicationCompetencyExpiryDate",
                table: "Staff",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PaymentStatus",
                table: "ParticipantBookings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_TripInstances_TripInstanceId",
                table: "IncidentReports",
                column: "TripInstanceId",
                principalTable: "TripInstances",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_IncidentReports_TripInstances_TripInstanceId",
                table: "IncidentReports");

            migrationBuilder.DropColumn(
                name: "DriverLicenceExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "FirstAidExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "ManualHandlingExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "MedicationCompetencyExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "PaymentStatus",
                table: "ParticipantBookings");

            migrationBuilder.AddColumn<string>(
                name: "OopPaymentStatus",
                table: "ParticipantBookings",
                type: "text",
                nullable: true);

            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_TripInstances_TripInstanceId",
                table: "IncidentReports",
                column: "TripInstanceId",
                principalTable: "TripInstances",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
