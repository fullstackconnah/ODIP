using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddEmploymentHeroOutbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Failed",
                table: "EmploymentHeroSyncLogs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Kind",
                table: "EmploymentHeroSyncLogs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Sent",
                table: "EmploymentHeroSyncLogs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "WorkTypeActiveNight",
                table: "EmploymentHeroConnections",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WorkTypePassiveNight",
                table: "EmploymentHeroConnections",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WorkTypeSleepover",
                table: "EmploymentHeroConnections",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WorkTypeStandard",
                table: "EmploymentHeroConnections",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "EmploymentHeroOutbox",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    LastError = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    PayloadHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    ExternalId = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    ExternalEmployeeId = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    SentAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmploymentHeroOutbox", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmploymentHeroOutbox_Status_NextAttemptAt",
                table: "EmploymentHeroOutbox",
                columns: new[] { "Status", "NextAttemptAt" });

            migrationBuilder.CreateIndex(
                name: "IX_EmploymentHeroOutbox_TenantId",
                table: "EmploymentHeroOutbox",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_EmploymentHeroOutbox_TenantId_Kind_EntityId",
                table: "EmploymentHeroOutbox",
                columns: new[] { "TenantId", "Kind", "EntityId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmploymentHeroOutbox");

            migrationBuilder.DropColumn(
                name: "Failed",
                table: "EmploymentHeroSyncLogs");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "EmploymentHeroSyncLogs");

            migrationBuilder.DropColumn(
                name: "Sent",
                table: "EmploymentHeroSyncLogs");

            migrationBuilder.DropColumn(
                name: "WorkTypeActiveNight",
                table: "EmploymentHeroConnections");

            migrationBuilder.DropColumn(
                name: "WorkTypePassiveNight",
                table: "EmploymentHeroConnections");

            migrationBuilder.DropColumn(
                name: "WorkTypeSleepover",
                table: "EmploymentHeroConnections");

            migrationBuilder.DropColumn(
                name: "WorkTypeStandard",
                table: "EmploymentHeroConnections");
        }
    }
}
