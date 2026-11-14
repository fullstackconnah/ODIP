using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261017032515_EarlyAccessOverLimitRecord")]
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
                name: "FollowUpNeeded",
                table: "EarlyAccessRequests",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "FollowUpClearedAtUtc",
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
                name: "FollowUpNeeded",
                table: "EarlyAccessRequests");

            migrationBuilder.DropColumn(
                name: "FollowUpClearedAtUtc",
                table: "EarlyAccessRequests");

            migrationBuilder.DropColumn(
                name: "IsOverLimit",
                table: "EarlyAccessLaterSubmissions");
        }
    }
}
