using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261026090000_AddCaregiverBasePayload")]
    public partial class AddCaregiverBasePayload : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BasePayload",
                table: "CaregiverProfileSubmissions",
                type: "jsonb",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BasePayload",
                table: "CaregiverProfileSubmissions");
        }
    }
}
