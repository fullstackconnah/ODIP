using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261109121235_AddAuditLogTenantId")]
    public partial class AddAuditLogTenantId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "AuditLogs",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_TenantId_Action_ChangedAt",
                table: "AuditLogs",
                columns: new[] { "TenantId", "Action", "ChangedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_AuditLogs_TenantId_Action_ChangedAt",
                table: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "AuditLogs");
        }
    }
}
