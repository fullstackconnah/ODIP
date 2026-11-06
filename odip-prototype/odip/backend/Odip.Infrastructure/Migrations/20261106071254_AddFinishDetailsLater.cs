using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddFinishDetailsLater : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "DetailsRequired",
                table: "ShiftCompletions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "PostTravelNone",
                table: "ShiftCompletions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "PreTravelNone",
                table: "ShiftCompletions",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DetailsRequired",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "PostTravelNone",
                table: "ShiftCompletions");

            migrationBuilder.DropColumn(
                name: "PreTravelNone",
                table: "ShiftCompletions");
        }
    }
}
