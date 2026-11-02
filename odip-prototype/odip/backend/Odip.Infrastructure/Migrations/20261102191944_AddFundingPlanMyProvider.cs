using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddFundingPlanMyProvider : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "MyProvider",
                table: "FundingPlans",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateOnly>(
                name: "MyProviderOn",
                table: "FundingPlans",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MyProviderSetBy",
                table: "FundingPlans",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "MyProvider", table: "FundingPlans");
            migrationBuilder.DropColumn(name: "MyProviderOn", table: "FundingPlans");
            migrationBuilder.DropColumn(name: "MyProviderSetBy", table: "FundingPlans");
        }
    }
}
