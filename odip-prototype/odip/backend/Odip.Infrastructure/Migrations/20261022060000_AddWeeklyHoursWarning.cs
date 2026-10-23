using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations;

[DbContext(typeof(OdipDbContext))]
[Migration("20261022060000_AddWeeklyHoursWarning")]
public class AddWeeklyHoursWarning : Migration
{
    // Existing organisations get 38, the figure that used to be fixed in code.
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.AddColumn<int>(name: "WeeklyHoursWarning", table: "AppSettings", type: "integer", nullable: false, defaultValue: 38);

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropColumn(name: "WeeklyHoursWarning", table: "AppSettings");
}
