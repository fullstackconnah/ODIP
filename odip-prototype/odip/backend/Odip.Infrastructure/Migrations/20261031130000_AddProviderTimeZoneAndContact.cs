using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddProviderTimeZoneAndContact : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ContactEmail",
                table: "ProviderSettings",
                type: "character varying(254)",
                maxLength: 254,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContactPhone",
                table: "ProviderSettings",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TimeZoneId",
                table: "ProviderSettings",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TradingName",
                table: "ProviderSettings",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Website",
                table: "ProviderSettings",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            // Each existing organisation gets its State's zone (StateTimeZoneMap); a blank or unknown State gets Sydney, today's fallback.
            // btrim is harmless: the controller refuses unknown States, and the ELSE covers any odd value.
            migrationBuilder.Sql("""
                UPDATE "ProviderSettings" SET "TimeZoneId" = CASE upper(btrim("State"))
                    WHEN 'NSW' THEN 'Australia/Sydney' WHEN 'ACT' THEN 'Australia/Sydney'
                    WHEN 'VIC' THEN 'Australia/Melbourne' WHEN 'TAS' THEN 'Australia/Hobart'
                    WHEN 'QLD' THEN 'Australia/Brisbane' WHEN 'SA' THEN 'Australia/Adelaide'
                    WHEN 'WA' THEN 'Australia/Perth' WHEN 'NT' THEN 'Australia/Darwin'
                    ELSE 'Australia/Sydney' END
                WHERE "TimeZoneId" IS NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ContactEmail",
                table: "ProviderSettings");

            migrationBuilder.DropColumn(
                name: "ContactPhone",
                table: "ProviderSettings");

            migrationBuilder.DropColumn(
                name: "TimeZoneId",
                table: "ProviderSettings");

            migrationBuilder.DropColumn(
                name: "TradingName",
                table: "ProviderSettings");

            migrationBuilder.DropColumn(
                name: "Website",
                table: "ProviderSettings");
        }
    }
}
