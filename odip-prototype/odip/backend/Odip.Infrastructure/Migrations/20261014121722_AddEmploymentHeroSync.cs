using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddEmploymentHeroSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ExternalPayrollId",
                table: "Users",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "EmploymentHeroAttentions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ExternalEmployeeId = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    DismissedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmploymentHeroAttentions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EmploymentHeroConnections",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    BusinessId = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    BusinessName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ApiKeyCiphertext = table.Column<byte[]>(type: "bytea", nullable: false),
                    ApiKeyNonce = table.Column<byte[]>(type: "bytea", nullable: false),
                    ConnectedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    ConnectedById = table.Column<Guid>(type: "uuid", nullable: true),
                    ConnectedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    LastSyncAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    LastSyncError = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmploymentHeroConnections", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EmploymentHeroSyncLogs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    BusinessId = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    FinishedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    Linked = table.Column<int>(type: "integer", nullable: false),
                    Created = table.Column<int>(type: "integer", nullable: false),
                    Updated = table.Column<int>(type: "integer", nullable: false),
                    Archived = table.Column<int>(type: "integer", nullable: false),
                    NeedsAttention = table.Column<int>(type: "integer", nullable: false),
                    ErrorClass = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmploymentHeroSyncLogs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Users_TenantId_ExternalPayrollId",
                table: "Users",
                columns: new[] { "TenantId", "ExternalPayrollId" },
                unique: true,
                filter: "\"ExternalPayrollId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_EmploymentHeroAttentions_TenantId_Key",
                table: "EmploymentHeroAttentions",
                columns: new[] { "TenantId", "Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EmploymentHeroConnections_TenantId",
                table: "EmploymentHeroConnections",
                column: "TenantId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EmploymentHeroSyncLogs_TenantId_StartedAt",
                table: "EmploymentHeroSyncLogs",
                columns: new[] { "TenantId", "StartedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmploymentHeroAttentions");

            migrationBuilder.DropTable(
                name: "EmploymentHeroConnections");

            migrationBuilder.DropTable(
                name: "EmploymentHeroSyncLogs");

            migrationBuilder.DropIndex(
                name: "IX_Users_TenantId_ExternalPayrollId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "ExternalPayrollId",
                table: "Users");
        }
    }
}
