using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddProviderSettingsAgreementTerms : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AgreementComplaintsTerms",
                table: "ProviderSettings",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AgreementResponsibilitiesTerms",
                table: "ProviderSettings",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AgreementComplaintsTerms",
                table: "ProviderSettings");

            migrationBuilder.DropColumn(
                name: "AgreementResponsibilitiesTerms",
                table: "ProviderSettings");
        }
    }
}
