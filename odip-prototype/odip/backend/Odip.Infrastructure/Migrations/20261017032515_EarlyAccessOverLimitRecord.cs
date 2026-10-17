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

            migrationBuilder.AddColumn<DateTime>(
                name: "LastOverLimitAtUtc",
                table: "EarlyAccessRequests",
                type: "timestamp without time zone",
                nullable: true);

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
                name: "LastOverLimitAtUtc",
                table: "EarlyAccessRequests");

            migrationBuilder.DropColumn(
                name: "IsOverLimit",
                table: "EarlyAccessLaterSubmissions");
        }
    }
}
