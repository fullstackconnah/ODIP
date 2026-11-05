using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Retention;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddParticipantRetention : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "RetentionStartEstimated",
                table: "Participants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateOnly>(
                name: "RetentionStartsOn",
                table: "Participants",
                type: "date",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PurgeRecords",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConfirmedById = table.Column<Guid>(type: "uuid", nullable: false),
                    ConfirmedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ConfirmedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    RetentionStartsOn = table.Column<DateOnly>(type: "date", nullable: false),
                    RetentionStartEstimated = table.Column<bool>(type: "boolean", nullable: false),
                    DueOn = table.Column<DateOnly>(type: "date", nullable: false),
                    RowCounts = table.Column<string>(type: "text", nullable: false),
                    ClaimBatchFilesCleared = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurgeRecords", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PurgeRecords_TenantId_EntityType_EntityId",
                table: "PurgeRecords",
                columns: new[] { "TenantId", "EntityType", "EntityId" },
                unique: true);

            // Records archived before the clock existed get an estimated start (the audit date, else the last edit).
            migrationBuilder.Sql(RetentionBackfill.Sql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PurgeRecords");

            migrationBuilder.DropColumn(
                name: "RetentionStartEstimated",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "RetentionStartsOn",
                table: "Participants");
        }
    }
}
