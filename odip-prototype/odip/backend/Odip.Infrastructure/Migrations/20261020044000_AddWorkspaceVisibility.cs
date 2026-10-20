using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations;

[DbContext(typeof(OdipDbContext))]
[Migration("20261020044000_AddWorkspaceVisibility")]
public class AddWorkspaceVisibility : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<bool>(name: "HiddenAccommodation", table: "AppSettings", type: "boolean", nullable: false, defaultValue: false);
        migrationBuilder.AddColumn<bool>(name: "HiddenVehicles", table: "AppSettings", type: "boolean", nullable: false, defaultValue: false);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "HiddenAccommodation", table: "AppSettings");
        migrationBuilder.DropColumn(name: "HiddenVehicles", table: "AppSettings");
    }
}
