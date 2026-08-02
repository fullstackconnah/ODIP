using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class MakeProviderSettingsPerTenant : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Add TenantId as nullable first so existing rows can be backfilled
            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "ProviderSettings",
                type: "uuid",
                nullable: true);

            // Assign the existing row to the Demo tenant
            migrationBuilder.Sql("""
                UPDATE "ProviderSettings"
                SET "TenantId" = (SELECT "Id" FROM "Tenants" WHERE "Name" = 'Demo')
                WHERE "TenantId" IS NULL;
                """);

            // Now enforce NOT NULL — will fail loudly if Demo tenant does not exist
            migrationBuilder.AlterColumn<Guid>(
                name: "TenantId",
                table: "ProviderSettings",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            // FK to Tenants
            migrationBuilder.AddForeignKey(
                name: "FK_ProviderSettings_Tenants_TenantId",
                table: "ProviderSettings",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            // Index for query filter performance
            migrationBuilder.CreateIndex(
                name: "IX_ProviderSettings_TenantId",
                table: "ProviderSettings",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ProviderSettings_Tenants_TenantId",
                table: "ProviderSettings");

            migrationBuilder.DropIndex(
                name: "IX_ProviderSettings_TenantId",
                table: "ProviderSettings");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "ProviderSettings");
        }
    }
}
