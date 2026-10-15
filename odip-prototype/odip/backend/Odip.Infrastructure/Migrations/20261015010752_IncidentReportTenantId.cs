using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class IncidentReportTenantId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Nullable first, then every incident takes its reporter's organisation (ReportedByUserId is required and Users.TenantId is not null, so
            // every row gets one), then NOT NULL. Done this way, a row the backfill missed would fail the migration rather than vanish behind the filter.
            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "IncidentReports",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "IncidentReports" i SET "TenantId" = u."TenantId"
                FROM "Users" u WHERE u."Id" = i."ReportedByUserId"
                """);

            migrationBuilder.AlterColumn<Guid>(
                name: "TenantId",
                table: "IncidentReports",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_TenantId",
                table: "IncidentReports",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_IncidentReports_TenantId",
                table: "IncidentReports");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "IncidentReports");
        }
    }
}
