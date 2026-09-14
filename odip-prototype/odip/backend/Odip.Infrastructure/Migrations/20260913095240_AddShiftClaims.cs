using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddShiftClaims : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "TripInstanceId",
                table: "TripClaims",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<int>(
                name: "Kind",
                table: "TripClaims",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "ParticipantId",
                table: "TripClaims",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PeriodFrom",
                table: "TripClaims",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PeriodTo",
                table: "TripClaims",
                type: "date",
                nullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "ParticipantBookingId",
                table: "ClaimLineItems",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<Guid>(
                name: "ShiftId",
                table: "ClaimLineItems",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_TripClaims_ParticipantId",
                table: "TripClaims",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_ClaimLineItems_ShiftId",
                table: "ClaimLineItems",
                column: "ShiftId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClaimLineItem_ExactlyOneParent",
                table: "ClaimLineItems",
                sql: "((\"ParticipantBookingId\" IS NOT NULL)::int + (\"ShiftId\" IS NOT NULL)::int) = 1");

            migrationBuilder.AddForeignKey(
                name: "FK_ClaimLineItems_Shifts_ShiftId",
                table: "ClaimLineItems",
                column: "ShiftId",
                principalTable: "Shifts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_TripClaims_Participants_ParticipantId",
                table: "TripClaims",
                column: "ParticipantId",
                principalTable: "Participants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ClaimLineItems_Shifts_ShiftId",
                table: "ClaimLineItems");

            migrationBuilder.DropForeignKey(
                name: "FK_TripClaims_Participants_ParticipantId",
                table: "TripClaims");

            migrationBuilder.DropIndex(
                name: "IX_TripClaims_ParticipantId",
                table: "TripClaims");

            migrationBuilder.DropIndex(
                name: "IX_ClaimLineItems_ShiftId",
                table: "ClaimLineItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClaimLineItem_ExactlyOneParent",
                table: "ClaimLineItems");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "TripClaims");

            migrationBuilder.DropColumn(
                name: "ParticipantId",
                table: "TripClaims");

            migrationBuilder.DropColumn(
                name: "PeriodFrom",
                table: "TripClaims");

            migrationBuilder.DropColumn(
                name: "PeriodTo",
                table: "TripClaims");

            migrationBuilder.DropColumn(
                name: "ShiftId",
                table: "ClaimLineItems");

            migrationBuilder.AlterColumn<Guid>(
                name: "TripInstanceId",
                table: "TripClaims",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "ParticipantBookingId",
                table: "ClaimLineItems",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
