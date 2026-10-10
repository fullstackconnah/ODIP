using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ActivityPerOrganisation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Nullable first, so the rows already there can be given an organisation before the column is required: the activity library was one table shared by every organisation.
            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "Activities",
                type: "uuid",
                nullable: true);

            // 1. An activity of an event template belongs to that template's organisation.
            migrationBuilder.Sql("""
                UPDATE "Activities" a
                SET "TenantId" = t."TenantId"
                FROM "EventTemplates" t
                WHERE t."Id" = a."EventTemplateId" AND a."TenantId" IS NULL;
                """);

            // 2. An activity with no template belongs to the organisation of the trips that use it, when that is exactly one.
            migrationBuilder.Sql("""
                UPDATE "Activities" a
                SET "TenantId" = u."TenantId"
                FROM (
                    SELECT sa."ActivityId", MIN(ti."TenantId"::text)::uuid AS "TenantId"
                    FROM "ScheduledActivities" sa
                    JOIN "TripDays" d ON d."Id" = sa."TripDayId"
                    JOIN "TripInstances" ti ON ti."Id" = d."TripInstanceId"
                    WHERE sa."ActivityId" IS NOT NULL
                    GROUP BY sa."ActivityId"
                    HAVING COUNT(DISTINCT ti."TenantId") = 1
                ) u
                WHERE u."ActivityId" = a."Id" AND a."TenantId" IS NULL;
                """);

            // 3. What is still unowned is used by no trip: every organisation gets its own copy, then the original goes. The delete spares an activity a trip still points at (deleting it would
            // silently null that link), so one used by trips of several organisations is still unowned at the check below, which stops the migration instead of losing the link.
            migrationBuilder.Sql("""
                INSERT INTO "Activities" ("Id", "TenantId", "EventTemplateId", "ActivityName", "Category", "Location", "AccessibilityNotes", "SuitabilityNotes", "Notes", "IsActive", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), t."Id", NULL, a."ActivityName", a."Category", a."Location", a."AccessibilityNotes", a."SuitabilityNotes", a."Notes", a."IsActive", a."CreatedAt", a."UpdatedAt"
                FROM "Activities" a
                CROSS JOIN "Tenants" t
                WHERE a."TenantId" IS NULL;
                """);
            migrationBuilder.Sql("""
                DELETE FROM "Activities" a
                WHERE a."TenantId" IS NULL
                  AND NOT EXISTS (SELECT 1 FROM "ScheduledActivities" sa WHERE sa."ActivityId" = a."Id");
                """);

            // Stop, naming the activities, rather than leave one without an organisation, or one on a trip of an organisation other than its own (that trip's coordinator could not save it:
            // the activity would be hidden from them). The migration is one transaction, so a stop changes nothing.
            migrationBuilder.Sql("""
                DO $$
                DECLARE conflicts text;
                BEGIN
                    SELECT string_agg(a."Id"::text, ', ') INTO conflicts
                    FROM "Activities" a
                    WHERE a."TenantId" IS NULL
                       OR EXISTS (
                            SELECT 1
                            FROM "ScheduledActivities" sa
                            JOIN "TripDays" d ON d."Id" = sa."TripDayId"
                            JOIN "TripInstances" ti ON ti."Id" = d."TripInstanceId"
                            WHERE sa."ActivityId" = a."Id" AND ti."TenantId" <> a."TenantId");
                    IF conflicts IS NOT NULL THEN
                        RAISE EXCEPTION 'ActivityPerOrganisation: no single organisation for activities (none found, or used by a trip of another organisation): %', conflicts;
                    END IF;
                END $$;
                """);

            migrationBuilder.AlterColumn<Guid>(
                name: "TenantId",
                table: "Activities",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Activities_TenantId",
                table: "Activities",
                column: "TenantId");

            migrationBuilder.AddForeignKey(
                name: "FK_Activities_Tenants_TenantId",
                table: "Activities",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The per-organisation copies made in Up stay: they cannot be told apart from activities an organisation has since added.
            migrationBuilder.DropForeignKey(
                name: "FK_Activities_Tenants_TenantId",
                table: "Activities");

            migrationBuilder.DropIndex(
                name: "IX_Activities_TenantId",
                table: "Activities");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "Activities");
        }
    }
}
