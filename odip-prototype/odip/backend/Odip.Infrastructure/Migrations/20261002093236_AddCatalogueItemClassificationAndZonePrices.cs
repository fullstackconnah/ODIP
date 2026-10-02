using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCatalogueItemClassificationAndZonePrices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CatalogueType",
                table: "SupportCatalogueItems",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "IrregularSil",
                table: "SupportCatalogueItems",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsLegacy",
                table: "SupportCatalogueItems",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "NdiaRequestedReports",
                table: "SupportCatalogueItems",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NonFaceToFace",
                table: "SupportCatalogueItems",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OutcomeDomain",
                table: "SupportCatalogueItems",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PaceSupportCategoryNumber",
                table: "SupportCatalogueItems",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "PriceNational",
                table: "SupportCatalogueItems",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "PriceRemote",
                table: "SupportCatalogueItems",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "PriceVeryRemote",
                table: "SupportCatalogueItems",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ProviderTravel",
                table: "SupportCatalogueItems",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RegistrationGroup",
                table: "SupportCatalogueItems",
                type: "character varying(4)",
                maxLength: 4,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ShortNoticeCancellation",
                table: "SupportCatalogueItems",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceDocument",
                table: "SupportCatalogueItems",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SupportCategoryNumber",
                table: "SupportCatalogueItems",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SupportPurpose",
                table: "SupportCatalogueItems",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CatalogueType",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "IrregularSil",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "IsLegacy",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "NdiaRequestedReports",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "NonFaceToFace",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "OutcomeDomain",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "PaceSupportCategoryNumber",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "PriceNational",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "PriceRemote",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "PriceVeryRemote",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "ProviderTravel",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "RegistrationGroup",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "ShortNoticeCancellation",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "SourceDocument",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "SupportCategoryNumber",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "SupportPurpose",
                table: "SupportCatalogueItems");
        }
    }
}
