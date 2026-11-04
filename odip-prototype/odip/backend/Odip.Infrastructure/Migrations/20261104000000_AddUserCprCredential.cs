using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddUserCprCredential : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // CPR as its own credential next to first aid. Expand-only: a flag defaulting to false and a nullable date, no backfill (a first aid date says nothing about CPR), so a rollback to the previous image just ignores both columns.
            migrationBuilder.AddColumn<bool>(
                name: "IsCprQualified",
                table: "Users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateOnly>(
                name: "CprExpiryDate",
                table: "Users",
                type: "date",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CprExpiryDate",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "IsCprQualified",
                table: "Users");
        }
    }
}
