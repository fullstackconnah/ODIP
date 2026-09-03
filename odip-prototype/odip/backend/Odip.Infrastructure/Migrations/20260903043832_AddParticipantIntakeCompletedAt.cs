using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddParticipantIntakeCompletedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "IntakeCompletedAt",
                table: "Participants",
                type: "timestamp without time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IntakeCompletedAt",
                table: "Participants");
        }
    }
}
