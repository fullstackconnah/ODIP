using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <summary>
    /// Staff/user unification "Approach A" single cut-over migration (see
    /// docs/superpowers/specs/2026-08-30-staff-user-unification-design.md §3.3): one pass that
    /// (1) adds the absorbed profile columns to Users, (2) auto-creates a SupportWorker User for
    /// every Staff row with no linked User (raw SQL — username derived as first.last lowercased
    /// with a numeric -2/-3 collision suffix, since Username/Email are globally unique; email
    /// from Staff.Email if free, else a placeholder), (3) copies Staff profile fields onto every
    /// linked User (both, if a Staff row is linked to two), (4) re-points the 12 referencing
    /// tables' FK columns from Staff to User — backfilling via the Staff→User mapping built in
    /// steps 2–3 (earliest-created User wins when a Staff row has two links) — and (5) drops
    /// Staff entirely. See <see cref="Odip.Infrastructure.Data.StaffUserUnificationMapping"/> for
    /// the C# mirror of the username-collision and earliest-user-wins algorithms (exercised via
    /// unit tests, since raw SQL can't run against the EF InMemory provider).
    ///
    /// APPENDED migration: never renumber/reorder — Program.cs's __EFMigrationsHistory
    /// self-healing logic is tied to specific migration IDs.
    /// </summary>
    public partial class StaffUserUnification : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // gen_random_uuid() was folded into Postgres core in v13; CREATE EXTENSION is a
            // harmless no-op on 13+ (same idiom as the AddRestrictivePractices migration).
            migrationBuilder.Sql("""CREATE EXTENSION IF NOT EXISTS pgcrypto;""");

            // ══════════════════════════════════════════════════════════════
            // STEP 1 (spec §3.3.1): add the absorbed Staff profile columns to Users.
            // ══════════════════════════════════════════════════════════════
            migrationBuilder.AddColumn<DateOnly>(
                name: "DriverLicenceExpiryDate", table: "Users", type: "date", nullable: true);
            migrationBuilder.AddColumn<DateOnly>(
                name: "FirstAidExpiryDate", table: "Users", type: "date", nullable: true);
            migrationBuilder.AddColumn<bool>(
                name: "IsDriverEligible", table: "Users", type: "boolean", nullable: false, defaultValue: false);
            migrationBuilder.AddColumn<bool>(
                name: "IsFirstAidQualified", table: "Users", type: "boolean", nullable: false, defaultValue: false);
            migrationBuilder.AddColumn<bool>(
                name: "IsManualHandlingCompetent", table: "Users", type: "boolean", nullable: false, defaultValue: false);
            migrationBuilder.AddColumn<bool>(
                name: "IsMedicationCompetent", table: "Users", type: "boolean", nullable: false, defaultValue: false);
            migrationBuilder.AddColumn<bool>(
                name: "IsOvernightEligible", table: "Users", type: "boolean", nullable: false, defaultValue: false);
            migrationBuilder.AddColumn<DateOnly>(
                name: "ManualHandlingExpiryDate", table: "Users", type: "date", nullable: true);
            migrationBuilder.AddColumn<DateOnly>(
                name: "MedicationCompetencyExpiryDate", table: "Users", type: "date", nullable: true);
            migrationBuilder.AddColumn<string>(
                name: "Mobile", table: "Users", type: "character varying(20)", maxLength: 20, nullable: true);
            migrationBuilder.AddColumn<string>(
                name: "Notes", table: "Users", type: "text", nullable: true);
            migrationBuilder.AddColumn<int>(
                name: "Position", table: "Users", type: "integer", nullable: true);
            migrationBuilder.AddColumn<string>(
                name: "Region", table: "Users", type: "character varying(100)", maxLength: 100, nullable: true);
            migrationBuilder.AddColumn<DateOnly>(
                name: "WorkerScreeningExpiryDate", table: "Users", type: "date", nullable: true);
            migrationBuilder.AddColumn<string>(
                name: "WorkerScreeningNumber", table: "Users", type: "character varying(50)", maxLength: 50, nullable: true);

            // ══════════════════════════════════════════════════════════════
            // STEP 2 (spec §3.3.2): auto-create a SupportWorker User for every Staff row (active
            // OR inactive) with no linked User. Users.StaffId still exists at this point in the
            // migration — it isn't dropped until step 5 — so the new User is linked via it the
            // same way any pre-existing linked User already is, which is what makes it visible to
            // step 3's profile copy below. UserRole.SupportWorker's stored ordinal is 2 (Admin=0,
            // Coordinator=1, SupportWorker=2, ReadOnly=3, SuperAdmin=4) — enums in this database
            // are stored as their plain integer ordinal (see AddRestrictivePractices/
            // AddPackagingAndNotes for the same idiom).
            // ══════════════════════════════════════════════════════════════
            migrationBuilder.Sql("""
                DO $$
                DECLARE
                    staff_row RECORD;
                    base_username TEXT;
                    candidate_username TEXT;
                    suffix INT;
                    trimmed_email TEXT;
                    final_email TEXT;
                    new_user_id UUID;
                BEGIN
                    FOR staff_row IN
                        SELECT s.* FROM "Staff" s
                        WHERE NOT EXISTS (SELECT 1 FROM "Users" u WHERE u."StaffId" = s."Id")
                        ORDER BY s."CreatedAt", s."Id"
                    LOOP
                        base_username := lower(
                            regexp_replace(staff_row."FirstName", '[^A-Za-z0-9]', '', 'g')
                            || '.' ||
                            regexp_replace(staff_row."LastName", '[^A-Za-z0-9]', '', 'g'));
                        candidate_username := base_username;
                        suffix := 1;
                        WHILE EXISTS (SELECT 1 FROM "Users" WHERE lower("Username") = candidate_username) LOOP
                            suffix := suffix + 1;
                            candidate_username := base_username || '-' || suffix;
                        END LOOP;

                        -- Hardened per Task 2 review: a Staff.Email that is empty or
                        -- whitespace-only must be treated exactly like NULL (fall through to the
                        -- placeholder), not copied verbatim as a blank/invalid email address.
                        trimmed_email := NULLIF(TRIM(staff_row."Email"), '');
                        IF trimmed_email IS NOT NULL
                           AND NOT EXISTS (SELECT 1 FROM "Users" WHERE lower("Email") = lower(trimmed_email))
                        THEN
                            final_email := trimmed_email;
                        ELSE
                            final_email := candidate_username || '@placeholder.local';
                        END IF;

                        new_user_id := gen_random_uuid();
                        INSERT INTO "Users"
                            ("Id", "TenantId", "Username", "Email", "FirstName", "LastName", "Role",
                             "StaffId", "IsActive", "CreatedAt", "UpdatedAt")
                        VALUES
                            (new_user_id, staff_row."TenantId", candidate_username, final_email,
                             staff_row."FirstName", staff_row."LastName", 2,
                             staff_row."Id", staff_row."IsActive", NOW(), NOW());
                    END LOOP;
                END $$;
                """);

            // ══════════════════════════════════════════════════════════════
            // STEP 3 (spec §3.3.3): copy Staff profile fields onto every linked User — pre-existing
            // or just created above. If two Users are linked to the same Staff row, both receive
            // the copy (there is no unique constraint on the old Users.StaffId). Position's stored
            // ordinal is identical to the old StaffRole's (same declaration order), so Staff."Role"
            // copies straight across with no remapping.
            // ══════════════════════════════════════════════════════════════
            migrationBuilder.Sql("""
                UPDATE "Users" u SET
                    "Mobile" = s."Mobile",
                    "Region" = s."Region",
                    "Position" = s."Role",
                    "IsDriverEligible" = s."IsDriverEligible",
                    "IsFirstAidQualified" = s."IsFirstAidQualified",
                    "IsMedicationCompetent" = s."IsMedicationCompetent",
                    "IsManualHandlingCompetent" = s."IsManualHandlingCompetent",
                    "IsOvernightEligible" = s."IsOvernightEligible",
                    "FirstAidExpiryDate" = s."FirstAidExpiryDate",
                    "DriverLicenceExpiryDate" = s."DriverLicenceExpiryDate",
                    "ManualHandlingExpiryDate" = s."ManualHandlingExpiryDate",
                    "MedicationCompetencyExpiryDate" = s."MedicationCompetencyExpiryDate",
                    "WorkerScreeningNumber" = s."WorkerScreeningNumber",
                    "WorkerScreeningExpiryDate" = s."WorkerScreeningExpiryDate",
                    "Notes" = s."Notes"
                FROM "Staff" s
                WHERE u."StaffId" = s."Id";
                """);

            // Staff -> User mapping used by every FK backfill below: earliest-created User wins
            // when a Staff row is linked to more than one (deterministic tie-break on Id).
            migrationBuilder.Sql("""
                CREATE TEMP TABLE _staff_user_map AS
                SELECT DISTINCT ON (s."Id") s."Id" AS staff_id, u."Id" AS user_id
                FROM "Staff" s
                JOIN "Users" u ON u."StaffId" = s."Id"
                ORDER BY s."Id", u."CreatedAt" ASC, u."Id" ASC;
                """);

            // ══════════════════════════════════════════════════════════════
            // STEP 4 (spec §3.3.4 / §3.2 table): add the new UserId-family columns to all twelve
            // referencing tables, backfill from _staff_user_map, then drop the old StaffId-family
            // columns. Nullability/delete-behaviour per column exactly matches §3.2.
            // ══════════════════════════════════════════════════════════════

            // ── Shift.StaffId -> UserId (nullable, Restrict) ────────────────
            migrationBuilder.DropForeignKey(name: "FK_Shifts_Staff_StaffId", table: "Shifts");
            migrationBuilder.AddColumn<Guid>(name: "UserId", table: "Shifts", type: "uuid", nullable: true);
            migrationBuilder.Sql("""UPDATE "Shifts" t SET "UserId" = m.user_id FROM "_staff_user_map" m WHERE t."StaffId" = m.staff_id;""");
            migrationBuilder.DropColumn(name: "StaffId", table: "Shifts");
            migrationBuilder.AddForeignKey(
                name: "FK_Shifts_Users_UserId", table: "Shifts", column: "UserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
            migrationBuilder.CreateIndex(name: "IX_Shifts_TenantId_UserId_ServiceDate", table: "Shifts", columns: new[] { "TenantId", "UserId", "ServiceDate" });
            migrationBuilder.CreateIndex(name: "IX_Shifts_UserId", table: "Shifts", column: "UserId");

            // ── ShiftPattern.DefaultStaffId -> DefaultUserId (nullable, SetNull) ─────
            migrationBuilder.DropForeignKey(name: "FK_ShiftPatterns_Staff_DefaultStaffId", table: "ShiftPatterns");
            migrationBuilder.AddColumn<Guid>(name: "DefaultUserId", table: "ShiftPatterns", type: "uuid", nullable: true);
            migrationBuilder.Sql("""UPDATE "ShiftPatterns" t SET "DefaultUserId" = m.user_id FROM "_staff_user_map" m WHERE t."DefaultStaffId" = m.staff_id;""");
            migrationBuilder.DropColumn(name: "DefaultStaffId", table: "ShiftPatterns");
            migrationBuilder.AddForeignKey(
                name: "FK_ShiftPatterns_Users_DefaultUserId", table: "ShiftPatterns", column: "DefaultUserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.CreateIndex(name: "IX_ShiftPatterns_DefaultUserId", table: "ShiftPatterns", column: "DefaultUserId");

            // ── StaffParticipantCompatibility.StaffId -> UserId (REQUIRED, Cascade) ──
            migrationBuilder.DropForeignKey(name: "FK_StaffParticipantCompatibilities_Staff_StaffId", table: "StaffParticipantCompatibilities");
            migrationBuilder.AddColumn<Guid>(name: "UserId", table: "StaffParticipantCompatibilities", type: "uuid", nullable: true);
            migrationBuilder.Sql("""UPDATE "StaffParticipantCompatibilities" t SET "UserId" = m.user_id FROM "_staff_user_map" m WHERE t."StaffId" = m.staff_id;""");
            migrationBuilder.DropColumn(name: "StaffId", table: "StaffParticipantCompatibilities");
            migrationBuilder.AlterColumn<Guid>(name: "UserId", table: "StaffParticipantCompatibilities", type: "uuid", nullable: false);
            migrationBuilder.AddForeignKey(
                name: "FK_StaffParticipantCompatibilities_Users_UserId", table: "StaffParticipantCompatibilities", column: "UserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.CreateIndex(
                name: "IX_StaffParticipantCompatibilities_TenantId_UserId_Participant~",
                table: "StaffParticipantCompatibilities", columns: new[] { "TenantId", "UserId", "ParticipantId" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_StaffParticipantCompatibilities_UserId", table: "StaffParticipantCompatibilities", column: "UserId");

            // ── StaffAssignment.StaffId -> UserId (REQUIRED, Restrict) ──────
            migrationBuilder.DropForeignKey(name: "FK_StaffAssignments_Staff_StaffId", table: "StaffAssignments");
            migrationBuilder.AddColumn<Guid>(name: "UserId", table: "StaffAssignments", type: "uuid", nullable: true);
            migrationBuilder.Sql("""UPDATE "StaffAssignments" t SET "UserId" = m.user_id FROM "_staff_user_map" m WHERE t."StaffId" = m.staff_id;""");
            migrationBuilder.DropColumn(name: "StaffId", table: "StaffAssignments");
            migrationBuilder.AlterColumn<Guid>(name: "UserId", table: "StaffAssignments", type: "uuid", nullable: false);
            migrationBuilder.AddForeignKey(
                name: "FK_StaffAssignments_Users_UserId", table: "StaffAssignments", column: "UserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
            migrationBuilder.CreateIndex(name: "IX_StaffAssignments_UserId_AssignmentStart_AssignmentEnd", table: "StaffAssignments", columns: new[] { "UserId", "AssignmentStart", "AssignmentEnd" });

            // ── StaffAvailability.StaffId -> UserId (REQUIRED, Cascade) ─────
            migrationBuilder.DropForeignKey(name: "FK_StaffAvailabilities_Staff_StaffId", table: "StaffAvailabilities");
            migrationBuilder.AddColumn<Guid>(name: "UserId", table: "StaffAvailabilities", type: "uuid", nullable: true);
            migrationBuilder.Sql("""UPDATE "StaffAvailabilities" t SET "UserId" = m.user_id FROM "_staff_user_map" m WHERE t."StaffId" = m.staff_id;""");
            migrationBuilder.DropColumn(name: "StaffId", table: "StaffAvailabilities");
            migrationBuilder.AlterColumn<Guid>(name: "UserId", table: "StaffAvailabilities", type: "uuid", nullable: false);
            migrationBuilder.AddForeignKey(
                name: "FK_StaffAvailabilities_Users_UserId", table: "StaffAvailabilities", column: "UserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.CreateIndex(name: "IX_StaffAvailabilities_UserId_StartDateTime_EndDateTime", table: "StaffAvailabilities", columns: new[] { "UserId", "StartDateTime", "EndDateTime" });

            // ── MedicationAdministration.WitnessStaffId -> WitnessUserId (nullable, Restrict) ──
            migrationBuilder.DropForeignKey(name: "FK_MedicationAdministrations_Staff_WitnessStaffId", table: "MedicationAdministrations");
            migrationBuilder.AddColumn<Guid>(name: "WitnessUserId", table: "MedicationAdministrations", type: "uuid", nullable: true);
            migrationBuilder.Sql("""UPDATE "MedicationAdministrations" t SET "WitnessUserId" = m.user_id FROM "_staff_user_map" m WHERE t."WitnessStaffId" = m.staff_id;""");
            migrationBuilder.DropColumn(name: "WitnessStaffId", table: "MedicationAdministrations");
            migrationBuilder.AddForeignKey(
                name: "FK_MedicationAdministrations_Users_WitnessUserId", table: "MedicationAdministrations", column: "WitnessUserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
            migrationBuilder.CreateIndex(name: "IX_MedicationAdministrations_WitnessUserId_WitnessStatus", table: "MedicationAdministrations", columns: new[] { "WitnessUserId", "WitnessStatus" });

            // ── IncidentReport: three columns ────────────────────────────────
            migrationBuilder.DropForeignKey(name: "FK_IncidentReports_Staff_InvolvedStaffId", table: "IncidentReports");
            migrationBuilder.DropForeignKey(name: "FK_IncidentReports_Staff_ReportedByStaffId", table: "IncidentReports");
            migrationBuilder.DropForeignKey(name: "FK_IncidentReports_Staff_ReviewedByStaffId", table: "IncidentReports");
            migrationBuilder.AddColumn<Guid>(name: "InvolvedUserId", table: "IncidentReports", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "ReportedByUserId", table: "IncidentReports", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "ReviewedByUserId", table: "IncidentReports", type: "uuid", nullable: true);
            migrationBuilder.Sql("""UPDATE "IncidentReports" t SET "InvolvedUserId" = m.user_id FROM "_staff_user_map" m WHERE t."InvolvedStaffId" = m.staff_id;""");
            migrationBuilder.Sql("""UPDATE "IncidentReports" t SET "ReportedByUserId" = m.user_id FROM "_staff_user_map" m WHERE t."ReportedByStaffId" = m.staff_id;""");
            migrationBuilder.Sql("""UPDATE "IncidentReports" t SET "ReviewedByUserId" = m.user_id FROM "_staff_user_map" m WHERE t."ReviewedByStaffId" = m.staff_id;""");
            migrationBuilder.DropColumn(name: "InvolvedStaffId", table: "IncidentReports");
            migrationBuilder.DropColumn(name: "ReportedByStaffId", table: "IncidentReports");
            migrationBuilder.DropColumn(name: "ReviewedByStaffId", table: "IncidentReports");
            migrationBuilder.AlterColumn<Guid>(name: "ReportedByUserId", table: "IncidentReports", type: "uuid", nullable: false);
            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_Users_InvolvedUserId", table: "IncidentReports", column: "InvolvedUserId",
                principalTable: "Users", principalColumn: "Id");
            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_Users_ReportedByUserId", table: "IncidentReports", column: "ReportedByUserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_Users_ReviewedByUserId", table: "IncidentReports", column: "ReviewedByUserId",
                principalTable: "Users", principalColumn: "Id");
            migrationBuilder.CreateIndex(name: "IX_IncidentReports_InvolvedUserId", table: "IncidentReports", column: "InvolvedUserId");
            migrationBuilder.CreateIndex(name: "IX_IncidentReports_ReportedByUserId", table: "IncidentReports", column: "ReportedByUserId");
            migrationBuilder.CreateIndex(name: "IX_IncidentReports_ReviewedByUserId", table: "IncidentReports", column: "ReviewedByUserId");

            // ── TripClaim.AuthorisedByStaffId -> AuthorisedByUserId (nullable, SetNull) ──
            migrationBuilder.DropForeignKey(name: "FK_TripClaims_Staff_AuthorisedByStaffId", table: "TripClaims");
            migrationBuilder.AddColumn<Guid>(name: "AuthorisedByUserId", table: "TripClaims", type: "uuid", nullable: true);
            migrationBuilder.Sql("""UPDATE "TripClaims" t SET "AuthorisedByUserId" = m.user_id FROM "_staff_user_map" m WHERE t."AuthorisedByStaffId" = m.staff_id;""");
            migrationBuilder.DropColumn(name: "AuthorisedByStaffId", table: "TripClaims");
            migrationBuilder.AddForeignKey(
                name: "FK_TripClaims_Users_AuthorisedByUserId", table: "TripClaims", column: "AuthorisedByUserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.CreateIndex(name: "IX_TripClaims_AuthorisedByUserId", table: "TripClaims", column: "AuthorisedByUserId");

            // ── VehicleAssignment.DriverStaffId -> DriverUserId (nullable, SetNull) ──
            migrationBuilder.DropForeignKey(name: "FK_VehicleAssignments_Staff_DriverStaffId", table: "VehicleAssignments");
            migrationBuilder.AddColumn<Guid>(name: "DriverUserId", table: "VehicleAssignments", type: "uuid", nullable: true);
            migrationBuilder.Sql("""UPDATE "VehicleAssignments" t SET "DriverUserId" = m.user_id FROM "_staff_user_map" m WHERE t."DriverStaffId" = m.staff_id;""");
            migrationBuilder.DropColumn(name: "DriverStaffId", table: "VehicleAssignments");
            migrationBuilder.AddForeignKey(
                name: "FK_VehicleAssignments_Users_DriverUserId", table: "VehicleAssignments", column: "DriverUserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.CreateIndex(name: "IX_VehicleAssignments_DriverUserId", table: "VehicleAssignments", column: "DriverUserId");

            // ── Participant.PreferredStaffId -> PreferredUserId (nullable, SetNull) ──
            migrationBuilder.DropForeignKey(name: "FK_Participants_Staff_PreferredStaffId", table: "Participants");
            migrationBuilder.AddColumn<Guid>(name: "PreferredUserId", table: "Participants", type: "uuid", nullable: true);
            migrationBuilder.Sql("""UPDATE "Participants" t SET "PreferredUserId" = m.user_id FROM "_staff_user_map" m WHERE t."PreferredStaffId" = m.staff_id;""");
            migrationBuilder.DropColumn(name: "PreferredStaffId", table: "Participants");
            migrationBuilder.AddForeignKey(
                name: "FK_Participants_Users_PreferredUserId", table: "Participants", column: "PreferredUserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.CreateIndex(name: "IX_Participants_PreferredUserId", table: "Participants", column: "PreferredUserId");

            // ── BookingTask.OwnerId (column name UNCHANGED — only the FK target/values move) ──
            migrationBuilder.DropForeignKey(name: "FK_BookingTasks_Staff_OwnerId", table: "BookingTasks");
            migrationBuilder.AddColumn<Guid>(name: "OwnerId_New", table: "BookingTasks", type: "uuid", nullable: true);
            migrationBuilder.Sql("""UPDATE "BookingTasks" t SET "OwnerId_New" = m.user_id FROM "_staff_user_map" m WHERE t."OwnerId" = m.staff_id;""");
            migrationBuilder.DropColumn(name: "OwnerId", table: "BookingTasks");
            migrationBuilder.RenameColumn(name: "OwnerId_New", table: "BookingTasks", newName: "OwnerId");
            migrationBuilder.AddForeignKey(
                name: "FK_BookingTasks_Users_OwnerId", table: "BookingTasks", column: "OwnerId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.CreateIndex(name: "IX_BookingTasks_OwnerId", table: "BookingTasks", column: "OwnerId");

            // ── TripInstance.LeadCoordinatorId (column name UNCHANGED — only the FK target/values move) ──
            migrationBuilder.DropForeignKey(name: "FK_TripInstances_Staff_LeadCoordinatorId", table: "TripInstances");
            migrationBuilder.AddColumn<Guid>(name: "LeadCoordinatorId_New", table: "TripInstances", type: "uuid", nullable: true);
            migrationBuilder.Sql("""UPDATE "TripInstances" t SET "LeadCoordinatorId_New" = m.user_id FROM "_staff_user_map" m WHERE t."LeadCoordinatorId" = m.staff_id;""");
            migrationBuilder.DropColumn(name: "LeadCoordinatorId", table: "TripInstances");
            migrationBuilder.RenameColumn(name: "LeadCoordinatorId_New", table: "TripInstances", newName: "LeadCoordinatorId");
            migrationBuilder.AddForeignKey(
                name: "FK_TripInstances_Users_LeadCoordinatorId", table: "TripInstances", column: "LeadCoordinatorId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.CreateIndex(name: "IX_TripInstances_LeadCoordinatorId", table: "TripInstances", column: "LeadCoordinatorId");

            migrationBuilder.Sql("""DROP TABLE "_staff_user_map";""");

            // ══════════════════════════════════════════════════════════════
            // STEP 5 (spec §3.3.5): drop Users.StaffId, then drop the Staff table itself.
            // ══════════════════════════════════════════════════════════════
            migrationBuilder.DropForeignKey(name: "FK_Users_Staff_StaffId", table: "Users");
            migrationBuilder.DropIndex(name: "IX_Users_StaffId", table: "Users");
            migrationBuilder.DropColumn(name: "StaffId", table: "Users");
            migrationBuilder.DropTable(name: "Staff");
        }

        /// <inheritdoc />
        /// <remarks>
        /// Restores the pre-migration SCHEMA shape only (recreates Staff, re-adds the StaffId-family
        /// columns) — it cannot restore the pre-migration DATA mapping the "Up" side discards
        /// (auto-created Staff rows for orphan-created Users, the exact prior FK values), the same
        /// standard caveat as any migration that folds one table's data into another.
        /// </remarks>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Staff",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    DriverLicenceExpiryDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    FirstAidExpiryDate = table.Column<DateOnly>(type: "date", nullable: true),
                    FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    IsDriverEligible = table.Column<bool>(type: "boolean", nullable: false),
                    IsFirstAidQualified = table.Column<bool>(type: "boolean", nullable: false),
                    IsManualHandlingCompetent = table.Column<bool>(type: "boolean", nullable: false),
                    IsMedicationCompetent = table.Column<bool>(type: "boolean", nullable: false),
                    IsOvernightEligible = table.Column<bool>(type: "boolean", nullable: false),
                    LastName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ManualHandlingExpiryDate = table.Column<DateOnly>(type: "date", nullable: true),
                    MedicationCompetencyExpiryDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Mobile = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    Region = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Role = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    WorkerScreeningExpiryDate = table.Column<DateOnly>(type: "date", nullable: true),
                    WorkerScreeningNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Staff", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Staff_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
            migrationBuilder.CreateIndex(name: "IX_Staff_IsActive", table: "Staff", column: "IsActive");
            migrationBuilder.CreateIndex(name: "IX_Staff_Region", table: "Staff", column: "Region");
            migrationBuilder.CreateIndex(name: "IX_Staff_Role", table: "Staff", column: "Role");
            migrationBuilder.CreateIndex(name: "IX_Staff_TenantId", table: "Staff", column: "TenantId");

            migrationBuilder.AddColumn<Guid>(name: "StaffId", table: "Users", type: "uuid", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_Users_StaffId", table: "Users", column: "StaffId");
            migrationBuilder.AddForeignKey(
                name: "FK_Users_Staff_StaffId", table: "Users", column: "StaffId",
                principalTable: "Staff", principalColumn: "Id", onDelete: ReferentialAction.SetNull);

            void RevertColumn(string table, string newCol, string oldCol, ReferentialAction onDelete, bool required = false)
            {
                migrationBuilder.DropForeignKey(name: $"FK_{table}_Users_{newCol}", table: table);
                migrationBuilder.AddColumn<Guid>(name: oldCol, table: table, type: "uuid", nullable: true);
                migrationBuilder.DropColumn(name: newCol, table: table);
                if (required)
                    migrationBuilder.AlterColumn<Guid>(name: oldCol, table: table, type: "uuid", nullable: false);
                migrationBuilder.AddForeignKey(
                    name: $"FK_{table}_Staff_{oldCol}", table: table, column: oldCol,
                    principalTable: "Staff", principalColumn: "Id", onDelete: onDelete);
            }

            RevertColumn("Shifts", "UserId", "StaffId", ReferentialAction.Restrict);
            migrationBuilder.CreateIndex(name: "IX_Shifts_TenantId_StaffId_ServiceDate", table: "Shifts", columns: new[] { "TenantId", "StaffId", "ServiceDate" });
            migrationBuilder.CreateIndex(name: "IX_Shifts_StaffId", table: "Shifts", column: "StaffId");

            RevertColumn("ShiftPatterns", "DefaultUserId", "DefaultStaffId", ReferentialAction.SetNull);
            migrationBuilder.CreateIndex(name: "IX_ShiftPatterns_DefaultStaffId", table: "ShiftPatterns", column: "DefaultStaffId");

            RevertColumn("StaffParticipantCompatibilities", "UserId", "StaffId", ReferentialAction.Cascade, required: true);
            migrationBuilder.CreateIndex(
                name: "IX_StaffParticipantCompatibilities_TenantId_StaffId_Participan~",
                table: "StaffParticipantCompatibilities", columns: new[] { "TenantId", "StaffId", "ParticipantId" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_StaffParticipantCompatibilities_StaffId", table: "StaffParticipantCompatibilities", column: "StaffId");

            RevertColumn("StaffAssignments", "UserId", "StaffId", ReferentialAction.Restrict, required: true);
            migrationBuilder.CreateIndex(name: "IX_StaffAssignments_StaffId_AssignmentStart_AssignmentEnd", table: "StaffAssignments", columns: new[] { "StaffId", "AssignmentStart", "AssignmentEnd" });

            RevertColumn("StaffAvailabilities", "UserId", "StaffId", ReferentialAction.Cascade, required: true);
            migrationBuilder.CreateIndex(name: "IX_StaffAvailabilities_StaffId_StartDateTime_EndDateTime", table: "StaffAvailabilities", columns: new[] { "StaffId", "StartDateTime", "EndDateTime" });

            RevertColumn("MedicationAdministrations", "WitnessUserId", "WitnessStaffId", ReferentialAction.Restrict);
            migrationBuilder.CreateIndex(name: "IX_MedicationAdministrations_WitnessStaffId_WitnessStatus", table: "MedicationAdministrations", columns: new[] { "WitnessStaffId", "WitnessStatus" });

            migrationBuilder.DropForeignKey(name: "FK_IncidentReports_Users_InvolvedUserId", table: "IncidentReports");
            migrationBuilder.DropForeignKey(name: "FK_IncidentReports_Users_ReportedByUserId", table: "IncidentReports");
            migrationBuilder.DropForeignKey(name: "FK_IncidentReports_Users_ReviewedByUserId", table: "IncidentReports");
            migrationBuilder.AddColumn<Guid>(name: "InvolvedStaffId", table: "IncidentReports", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "ReportedByStaffId", table: "IncidentReports", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "ReviewedByStaffId", table: "IncidentReports", type: "uuid", nullable: true);
            migrationBuilder.DropColumn(name: "InvolvedUserId", table: "IncidentReports");
            migrationBuilder.DropColumn(name: "ReportedByUserId", table: "IncidentReports");
            migrationBuilder.DropColumn(name: "ReviewedByUserId", table: "IncidentReports");
            migrationBuilder.AlterColumn<Guid>(name: "ReportedByStaffId", table: "IncidentReports", type: "uuid", nullable: false);
            migrationBuilder.AddForeignKey(name: "FK_IncidentReports_Staff_InvolvedStaffId", table: "IncidentReports", column: "InvolvedStaffId", principalTable: "Staff", principalColumn: "Id");
            migrationBuilder.AddForeignKey(name: "FK_IncidentReports_Staff_ReportedByStaffId", table: "IncidentReports", column: "ReportedByStaffId", principalTable: "Staff", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_IncidentReports_Staff_ReviewedByStaffId", table: "IncidentReports", column: "ReviewedByStaffId", principalTable: "Staff", principalColumn: "Id");
            migrationBuilder.CreateIndex(name: "IX_IncidentReports_InvolvedStaffId", table: "IncidentReports", column: "InvolvedStaffId");
            migrationBuilder.CreateIndex(name: "IX_IncidentReports_ReportedByStaffId", table: "IncidentReports", column: "ReportedByStaffId");
            migrationBuilder.CreateIndex(name: "IX_IncidentReports_ReviewedByStaffId", table: "IncidentReports", column: "ReviewedByStaffId");

            RevertColumn("TripClaims", "AuthorisedByUserId", "AuthorisedByStaffId", ReferentialAction.SetNull);
            migrationBuilder.CreateIndex(name: "IX_TripClaims_AuthorisedByStaffId", table: "TripClaims", column: "AuthorisedByStaffId");

            RevertColumn("VehicleAssignments", "DriverUserId", "DriverStaffId", ReferentialAction.SetNull);
            migrationBuilder.CreateIndex(name: "IX_VehicleAssignments_DriverStaffId", table: "VehicleAssignments", column: "DriverStaffId");

            RevertColumn("Participants", "PreferredUserId", "PreferredStaffId", ReferentialAction.SetNull);
            migrationBuilder.CreateIndex(name: "IX_Participants_PreferredStaffId", table: "Participants", column: "PreferredStaffId");

            migrationBuilder.DropForeignKey(name: "FK_BookingTasks_Users_OwnerId", table: "BookingTasks");
            migrationBuilder.AddColumn<Guid>(name: "OwnerId_Old", table: "BookingTasks", type: "uuid", nullable: true);
            migrationBuilder.DropColumn(name: "OwnerId", table: "BookingTasks");
            migrationBuilder.RenameColumn(name: "OwnerId_Old", table: "BookingTasks", newName: "OwnerId");
            migrationBuilder.AddForeignKey(name: "FK_BookingTasks_Staff_OwnerId", table: "BookingTasks", column: "OwnerId", principalTable: "Staff", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.CreateIndex(name: "IX_BookingTasks_OwnerId", table: "BookingTasks", column: "OwnerId");

            migrationBuilder.DropForeignKey(name: "FK_TripInstances_Users_LeadCoordinatorId", table: "TripInstances");
            migrationBuilder.AddColumn<Guid>(name: "LeadCoordinatorId_Old", table: "TripInstances", type: "uuid", nullable: true);
            migrationBuilder.DropColumn(name: "LeadCoordinatorId", table: "TripInstances");
            migrationBuilder.RenameColumn(name: "LeadCoordinatorId_Old", table: "TripInstances", newName: "LeadCoordinatorId");
            migrationBuilder.AddForeignKey(name: "FK_TripInstances_Staff_LeadCoordinatorId", table: "TripInstances", column: "LeadCoordinatorId", principalTable: "Staff", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.CreateIndex(name: "IX_TripInstances_LeadCoordinatorId", table: "TripInstances", column: "LeadCoordinatorId");

            migrationBuilder.DropColumn(name: "DriverLicenceExpiryDate", table: "Users");
            migrationBuilder.DropColumn(name: "FirstAidExpiryDate", table: "Users");
            migrationBuilder.DropColumn(name: "IsDriverEligible", table: "Users");
            migrationBuilder.DropColumn(name: "IsFirstAidQualified", table: "Users");
            migrationBuilder.DropColumn(name: "IsManualHandlingCompetent", table: "Users");
            migrationBuilder.DropColumn(name: "IsMedicationCompetent", table: "Users");
            migrationBuilder.DropColumn(name: "IsOvernightEligible", table: "Users");
            migrationBuilder.DropColumn(name: "ManualHandlingExpiryDate", table: "Users");
            migrationBuilder.DropColumn(name: "MedicationCompetencyExpiryDate", table: "Users");
            migrationBuilder.DropColumn(name: "Mobile", table: "Users");
            migrationBuilder.DropColumn(name: "Notes", table: "Users");
            migrationBuilder.DropColumn(name: "Position", table: "Users");
            migrationBuilder.DropColumn(name: "Region", table: "Users");
            migrationBuilder.DropColumn(name: "WorkerScreeningExpiryDate", table: "Users");
            migrationBuilder.DropColumn(name: "WorkerScreeningNumber", table: "Users");
        }
    }
}
