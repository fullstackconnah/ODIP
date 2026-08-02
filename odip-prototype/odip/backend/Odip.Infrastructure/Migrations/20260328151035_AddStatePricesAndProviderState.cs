using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddStatePricesAndProviderState : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "PriceLimit_Standard",
                table: "SupportCatalogueItems",
                newName: "PriceLimit_WA");

            migrationBuilder.RenameColumn(
                name: "PriceLimit_1to5",
                table: "SupportCatalogueItems",
                newName: "PriceLimit_VIC");

            migrationBuilder.RenameColumn(
                name: "PriceLimit_1to4",
                table: "SupportCatalogueItems",
                newName: "PriceLimit_TAS");

            migrationBuilder.RenameColumn(
                name: "PriceLimit_1to3",
                table: "SupportCatalogueItems",
                newName: "PriceLimit_SA");

            migrationBuilder.RenameColumn(
                name: "PriceLimit_1to2",
                table: "SupportCatalogueItems",
                newName: "PriceLimit_QLD");

            migrationBuilder.AddColumn<decimal>(
                name: "PriceLimit_ACT",
                table: "SupportCatalogueItems",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "PriceLimit_NSW",
                table: "SupportCatalogueItems",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "PriceLimit_NT",
                table: "SupportCatalogueItems",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "State",
                table: "ProviderSettings",
                type: "text",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PriceLimit_ACT",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "PriceLimit_NSW",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "PriceLimit_NT",
                table: "SupportCatalogueItems");

            migrationBuilder.DropColumn(
                name: "State",
                table: "ProviderSettings");

            migrationBuilder.RenameColumn(
                name: "PriceLimit_WA",
                table: "SupportCatalogueItems",
                newName: "PriceLimit_Standard");

            migrationBuilder.RenameColumn(
                name: "PriceLimit_VIC",
                table: "SupportCatalogueItems",
                newName: "PriceLimit_1to5");

            migrationBuilder.RenameColumn(
                name: "PriceLimit_TAS",
                table: "SupportCatalogueItems",
                newName: "PriceLimit_1to4");

            migrationBuilder.RenameColumn(
                name: "PriceLimit_SA",
                table: "SupportCatalogueItems",
                newName: "PriceLimit_1to3");

            migrationBuilder.RenameColumn(
                name: "PriceLimit_QLD",
                table: "SupportCatalogueItems",
                newName: "PriceLimit_1to2");
        }
    }
}
