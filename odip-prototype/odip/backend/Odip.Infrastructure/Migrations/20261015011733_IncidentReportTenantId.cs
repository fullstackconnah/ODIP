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
            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "IncidentReports",
                type: "uuid",
                nullable: true);

            // Every incident takes its reporter's organisation: ReportedByUserId is required and Users.TenantId is not null, so every row gets one.
            // The column stays nullable (expand): the previous image's INSERTs leave it out, so a rollback keeps working; its rows stay hidden from
            // non-SuperAdmins until a contract migration re-runs this backfill and makes the column NOT NULL.
            migrationBuilder.Sql("""
                UPDATE "IncidentReports" i SET "TenantId" = u."TenantId"
                FROM "Users" u WHERE u."Id" = i."ReportedByUserId"
                """);

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
