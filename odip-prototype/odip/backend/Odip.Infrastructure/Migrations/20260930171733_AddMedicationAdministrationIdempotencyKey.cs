using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMedicationAdministrationIdempotencyKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "IdempotencyKey",
                table: "MedicationAdministrations",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_MedicationAdministrations_TenantId_IdempotencyKey",
                table: "MedicationAdministrations",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true,
                filter: "\"IdempotencyKey\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_MedicationAdministrations_TenantId_IdempotencyKey",
                table: "MedicationAdministrations");

            migrationBuilder.DropColumn(
                name: "IdempotencyKey",
                table: "MedicationAdministrations");
        }
    }
}
