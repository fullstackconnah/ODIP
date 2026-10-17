using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class EarlyAccessOverLimitRecord : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "OverLimitCount",
                table: "EarlyAccessRequests",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "IsOverLimit",
                table: "EarlyAccessLaterSubmissions",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OverLimitCount",
                table: "EarlyAccessRequests");

            migrationBuilder.DropColumn(
                name: "IsOverLimit",
                table: "EarlyAccessLaterSubmissions");
        }
    }
}
