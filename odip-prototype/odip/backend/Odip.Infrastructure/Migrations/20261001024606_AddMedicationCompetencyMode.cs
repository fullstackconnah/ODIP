using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261001024606_AddMedicationCompetencyMode")]
    public partial class AddMedicationCompetencyMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "MedicationCompetencyMode",
                table: "ProviderSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "RecordedWithoutCompetency",
                table: "MedicationAdministrations",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MedicationCompetencyMode",
                table: "ProviderSettings");

            migrationBuilder.DropColumn(
                name: "RecordedWithoutCompetency",
                table: "MedicationAdministrations");
        }
    }
}
