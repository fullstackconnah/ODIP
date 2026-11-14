using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20260401005722_AddParticipantPreferredStaff")]
    public partial class AddParticipantPreferredStaff : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "PreferredStaffId",
                table: "Participants",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Participants_PreferredStaffId",
                table: "Participants",
                column: "PreferredStaffId");

            migrationBuilder.AddForeignKey(
                name: "FK_Participants_Staff_PreferredStaffId",
                table: "Participants",
                column: "PreferredStaffId",
                principalTable: "Staff",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Participants_Staff_PreferredStaffId",
                table: "Participants");

            migrationBuilder.DropIndex(
                name: "IX_Participants_PreferredStaffId",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "PreferredStaffId",
                table: "Participants");
        }
    }
}
