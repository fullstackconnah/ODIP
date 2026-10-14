using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddIntakeBooking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "IntakeBookedByUserId",
                table: "ParticipantInquiries",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "IntakeConfirmedAt",
                table: "ParticipantInquiries",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "IntakeDurationMinutes",
                table: "ParticipantInquiries",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "IntakeIcsSequence",
                table: "ParticipantInquiries",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "IntakeInviteError",
                table: "ParticipantInquiries",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "IntakeInviteSentAt",
                table: "ParticipantInquiries",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IntakeLocation",
                table: "ParticipantInquiries",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IntakeNotes",
                table: "ParticipantInquiries",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "IntakeStaffUserId",
                table: "ParticipantInquiries",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "IntakeStartsAt",
                table: "ParticipantInquiries",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IntakeUid",
                table: "ParticipantInquiries",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantInquiries_IntakeBookedByUserId",
                table: "ParticipantInquiries",
                column: "IntakeBookedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantInquiries_IntakeStaffUserId",
                table: "ParticipantInquiries",
                column: "IntakeStaffUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantInquiries_TenantId_IntakeStartsAt",
                table: "ParticipantInquiries",
                columns: new[] { "TenantId", "IntakeStartsAt" });

            migrationBuilder.AddForeignKey(
                name: "FK_ParticipantInquiries_Users_IntakeBookedByUserId",
                table: "ParticipantInquiries",
                column: "IntakeBookedByUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ParticipantInquiries_Users_IntakeStaffUserId",
                table: "ParticipantInquiries",
                column: "IntakeStaffUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ParticipantInquiries_Users_IntakeBookedByUserId",
                table: "ParticipantInquiries");

            migrationBuilder.DropForeignKey(
                name: "FK_ParticipantInquiries_Users_IntakeStaffUserId",
                table: "ParticipantInquiries");

            migrationBuilder.DropIndex(
                name: "IX_ParticipantInquiries_IntakeBookedByUserId",
                table: "ParticipantInquiries");

            migrationBuilder.DropIndex(
                name: "IX_ParticipantInquiries_IntakeStaffUserId",
                table: "ParticipantInquiries");

            migrationBuilder.DropIndex(
                name: "IX_ParticipantInquiries_TenantId_IntakeStartsAt",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "IntakeBookedByUserId",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "IntakeConfirmedAt",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "IntakeDurationMinutes",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "IntakeIcsSequence",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "IntakeInviteError",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "IntakeInviteSentAt",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "IntakeLocation",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "IntakeNotes",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "IntakeStaffUserId",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "IntakeStartsAt",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "IntakeUid",
                table: "ParticipantInquiries");
        }
    }
}
