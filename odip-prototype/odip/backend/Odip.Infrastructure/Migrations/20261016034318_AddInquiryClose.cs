using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddInquiryClose : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CloseNote",
                table: "ParticipantInquiries",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CloseOutcome",
                table: "ParticipantInquiries",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ClosedAt",
                table: "ParticipantInquiries",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ClosedByUserId",
                table: "ParticipantInquiries",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantInquiries_ClosedByUserId",
                table: "ParticipantInquiries",
                column: "ClosedByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_ParticipantInquiries_Users_ClosedByUserId",
                table: "ParticipantInquiries",
                column: "ClosedByUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ParticipantInquiries_Users_ClosedByUserId",
                table: "ParticipantInquiries");

            migrationBuilder.DropIndex(
                name: "IX_ParticipantInquiries_ClosedByUserId",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "CloseNote",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "CloseOutcome",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "ClosedAt",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "ClosedByUserId",
                table: "ParticipantInquiries");
        }
    }
}
