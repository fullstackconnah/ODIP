using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAuditLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_IncidentReports_TripInstances_TripInstanceId",
                table: "IncidentReports");

            // OopPaymentStatus may not exist on prod DBs that had it dropped by AddNdisClaiming
            migrationBuilder.Sql("""ALTER TABLE "ParticipantBookings" DROP COLUMN IF EXISTS "OopPaymentStatus";""");

            // These columns may already exist if AddNdisClaiming ran on this database
            migrationBuilder.Sql("""ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "DriverLicenceExpiryDate" date;""");
            migrationBuilder.Sql("""ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "FirstAidExpiryDate" date;""");
            migrationBuilder.Sql("""ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "ManualHandlingExpiryDate" date;""");
            migrationBuilder.Sql("""ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "MedicationCompetencyExpiryDate" date;""");

            // PaymentStatus may already exist if AddNdisClaiming ran on this database
            migrationBuilder.Sql("""ALTER TABLE "ParticipantBookings" ADD COLUMN IF NOT EXISTS "PaymentStatus" integer NOT NULL DEFAULT 0;""");

            // AppSettings may already exist if AddNdisClaiming ran on this database
            migrationBuilder.Sql("""
                CREATE TABLE IF NOT EXISTS "AppSettings" (
                    "Id" integer NOT NULL,
                    "QualificationWarningDays" integer NOT NULL,
                    CONSTRAINT "PK_AppSettings" PRIMARY KEY ("Id")
                );
            """);

            migrationBuilder.CreateTable(
                name: "AuditLogs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ChangedById = table.Column<Guid>(type: "uuid", nullable: true),
                    ChangedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Changes = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditLogs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_ChangedAt",
                table: "AuditLogs",
                column: "ChangedAt");

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_EntityType_EntityId",
                table: "AuditLogs",
                columns: new[] { "EntityType", "EntityId" });

            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_TripInstances_TripInstanceId",
                table: "IncidentReports",
                column: "TripInstanceId",
                principalTable: "TripInstances",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_IncidentReports_TripInstances_TripInstanceId",
                table: "IncidentReports");

            migrationBuilder.DropTable(
                name: "AppSettings");

            migrationBuilder.DropTable(
                name: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "DriverLicenceExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "FirstAidExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "ManualHandlingExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "MedicationCompetencyExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "PaymentStatus",
                table: "ParticipantBookings");

            migrationBuilder.AddColumn<string>(
                name: "OopPaymentStatus",
                table: "ParticipantBookings",
                type: "text",
                nullable: true);

            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_TripInstances_TripInstanceId",
                table: "IncidentReports",
                column: "TripInstanceId",
                principalTable: "TripInstances",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
