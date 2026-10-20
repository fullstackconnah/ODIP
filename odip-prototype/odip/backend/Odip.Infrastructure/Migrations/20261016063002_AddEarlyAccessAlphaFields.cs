using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddEarlyAccessAlphaFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Message",
                table: "EarlyAccessRequests",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OrganisationSize",
                table: "EarlyAccessRequests",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Phone",
                table: "EarlyAccessRequests",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Role",
                table: "EarlyAccessRequests",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Message",
                table: "EarlyAccessRequests");

            migrationBuilder.DropColumn(
                name: "OrganisationSize",
                table: "EarlyAccessRequests");

            migrationBuilder.DropColumn(
                name: "Phone",
                table: "EarlyAccessRequests");

            migrationBuilder.DropColumn(
                name: "Role",
                table: "EarlyAccessRequests");
        }
    }
}
