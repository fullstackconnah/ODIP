using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddServiceLocations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ServiceLocations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Address = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    Latitude = table.Column<decimal>(type: "numeric(9,6)", precision: 9, scale: 6, nullable: false),
                    Longitude = table.Column<decimal>(type: "numeric(9,6)", precision: 9, scale: 6, nullable: false),
                    RadiusMetres = table.Column<int>(type: "integer", nullable: false),
                    TimeZoneId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceLocations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceLocations_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceLocations_TenantId",
                table: "ServiceLocations",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceLocations_TenantId_Name",
                table: "ServiceLocations",
                columns: new[] { "TenantId", "Name" },
                unique: true,
                filter: "\"IsActive\"");

            migrationBuilder.AddColumn<Guid>(
                name: "ServiceLocationId",
                table: "Shifts",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Shifts_ServiceLocationId",
                table: "Shifts",
                column: "ServiceLocationId");

            migrationBuilder.AddForeignKey(
                name: "FK_Shifts_ServiceLocations_ServiceLocationId",
                table: "Shifts",
                column: "ServiceLocationId",
                principalTable: "ServiceLocations",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Shifts_ServiceLocations_ServiceLocationId",
                table: "Shifts");

            migrationBuilder.DropIndex(
                name: "IX_Shifts_ServiceLocationId",
                table: "Shifts");

            migrationBuilder.DropColumn(
                name: "ServiceLocationId",
                table: "Shifts");

            migrationBuilder.DropTable(
                name: "ServiceLocations");
        }
    }
}
