using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ConsolidateSchemaFixes : Migration
    {
        /// <summary>
        /// Consolidates the various ALTER TABLE … ADD COLUMN IF NOT EXISTS statements that
        /// previously ran as raw SQL on every startup in Program.cs.  Using IF NOT EXISTS
        /// keeps this migration idempotent for databases that already have some or all of
        /// these columns from the old startup path.
        /// </summary>
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // TripInstances – staff calculation
            migrationBuilder.Sql(
                """ALTER TABLE "TripInstances" ADD COLUMN IF NOT EXISTS "CalculatedStaffRequired" numeric NOT NULL DEFAULT 0""");

            // ScheduledActivities – booking/provider tracking
            migrationBuilder.Sql(
                """
                ALTER TABLE "ScheduledActivities" ADD COLUMN IF NOT EXISTS "Status" integer NOT NULL DEFAULT 0;
                ALTER TABLE "ScheduledActivities" ADD COLUMN IF NOT EXISTS "BookingReference" character varying(200);
                ALTER TABLE "ScheduledActivities" ADD COLUMN IF NOT EXISTS "ProviderName" character varying(200);
                ALTER TABLE "ScheduledActivities" ADD COLUMN IF NOT EXISTS "ProviderPhone" character varying(50);
                ALTER TABLE "ScheduledActivities" ADD COLUMN IF NOT EXISTS "ProviderEmail" character varying(200);
                ALTER TABLE "ScheduledActivities" ADD COLUMN IF NOT EXISTS "ProviderWebsite" character varying(500);
                ALTER TABLE "ScheduledActivities" ADD COLUMN IF NOT EXISTS "EstimatedCost" numeric(18,2);
                CREATE INDEX IF NOT EXISTS "IX_ScheduledActivities_Status" ON "ScheduledActivities" ("Status");
                """);

            // ParticipantBookings – insurance tracking
            migrationBuilder.Sql(
                """
                ALTER TABLE "ParticipantBookings" ADD COLUMN IF NOT EXISTS "InsuranceProvider" text;
                ALTER TABLE "ParticipantBookings" ADD COLUMN IF NOT EXISTS "InsurancePolicyNumber" text;
                ALTER TABLE "ParticipantBookings" ADD COLUMN IF NOT EXISTS "InsuranceCoverageStart" date;
                ALTER TABLE "ParticipantBookings" ADD COLUMN IF NOT EXISTS "InsuranceCoverageEnd" date;
                ALTER TABLE "ParticipantBookings" ADD COLUMN IF NOT EXISTS "InsuranceStatus" integer NOT NULL DEFAULT 0;
                CREATE INDEX IF NOT EXISTS "IX_ParticipantBookings_InsuranceStatus" ON "ParticipantBookings" ("InsuranceStatus");
                """);

            // Staff – qualification/certification expiry dates
            migrationBuilder.Sql(
                """
                ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "FirstAidExpiryDate" date;
                ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "DriverLicenceExpiryDate" date;
                ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "ManualHandlingExpiryDate" date;
                ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "MedicationCompetencyExpiryDate" date;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ParticipantBookings_InsuranceStatus",
                table: "ParticipantBookings");

            migrationBuilder.DropIndex(
                name: "IX_ScheduledActivities_Status",
                table: "ScheduledActivities");

            migrationBuilder.DropColumn(name: "CalculatedStaffRequired", table: "TripInstances");

            migrationBuilder.DropColumn(name: "Status", table: "ScheduledActivities");
            migrationBuilder.DropColumn(name: "BookingReference", table: "ScheduledActivities");
            migrationBuilder.DropColumn(name: "ProviderName", table: "ScheduledActivities");
            migrationBuilder.DropColumn(name: "ProviderPhone", table: "ScheduledActivities");
            migrationBuilder.DropColumn(name: "ProviderEmail", table: "ScheduledActivities");
            migrationBuilder.DropColumn(name: "ProviderWebsite", table: "ScheduledActivities");
            migrationBuilder.DropColumn(name: "EstimatedCost", table: "ScheduledActivities");

            migrationBuilder.DropColumn(name: "InsuranceProvider", table: "ParticipantBookings");
            migrationBuilder.DropColumn(name: "InsurancePolicyNumber", table: "ParticipantBookings");
            migrationBuilder.DropColumn(name: "InsuranceCoverageStart", table: "ParticipantBookings");
            migrationBuilder.DropColumn(name: "InsuranceCoverageEnd", table: "ParticipantBookings");
            migrationBuilder.DropColumn(name: "InsuranceStatus", table: "ParticipantBookings");

            migrationBuilder.DropColumn(name: "FirstAidExpiryDate", table: "Staff");
            migrationBuilder.DropColumn(name: "DriverLicenceExpiryDate", table: "Staff");
            migrationBuilder.DropColumn(name: "ManualHandlingExpiryDate", table: "Staff");
            migrationBuilder.DropColumn(name: "MedicationCompetencyExpiryDate", table: "Staff");
        }
    }
}
