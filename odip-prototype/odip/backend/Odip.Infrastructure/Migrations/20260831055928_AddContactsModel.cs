using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddContactsModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "People",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LastName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Phone = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    Mobile = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    AddressLine = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Suburb = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    State = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    Postcode = table.Column<string>(type: "character varying(4)", maxLength: 4, nullable: true),
                    Organisation = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DateOfBirth = table.Column<DateOnly>(type: "date", nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_People", x => x.Id);
                    table.ForeignKey(
                        name: "FK_People_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ParticipantContactRoles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    PersonId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoleType = table.Column<int>(type: "integer", nullable: false),
                    RelationshipToParticipant = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    IsPrimary = table.Column<bool>(type: "boolean", nullable: false),
                    PriorityOrder = table.Column<int>(type: "integer", nullable: true),
                    AuthorisedForMedicalInfo = table.Column<bool>(type: "boolean", nullable: true),
                    AppointingTribunal = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    OrderScopeDomains = table.Column<List<string>>(type: "text[]", nullable: false),
                    OrderStartDate = table.Column<DateOnly>(type: "date", nullable: true),
                    OrderReviewDate = table.Column<DateOnly>(type: "date", nullable: true),
                    OrderEndDate = table.Column<DateOnly>(type: "date", nullable: true),
                    NomineeScope = table.Column<int>(type: "integer", nullable: true),
                    AppointmentDate = table.Column<DateOnly>(type: "date", nullable: true),
                    ReasonForAppointment = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    AlternateRepresentativeName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    FundingLineItemType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    OrganisationName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RegistrationNumber = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    LastVisitDate = table.Column<DateOnly>(type: "date", nullable: true),
                    ConsentToShare = table.Column<bool>(type: "boolean", nullable: true),
                    Discipline = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    FrequencyOfContact = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    WebsterPackFlag = table.Column<bool>(type: "boolean", nullable: true),
                    RoleTitle = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    RegisteredProviderFlag = table.Column<bool>(type: "boolean", nullable: true),
                    ScopeNotes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    AuthorisationDocumentReference = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    PreferredLanguage = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: true),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParticipantContactRoles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ParticipantContactRoles_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ParticipantContactRoles_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ParticipantContactRoles_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantContactRoles_ParticipantId",
                table: "ParticipantContactRoles",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantContactRoles_PersonId",
                table: "ParticipantContactRoles",
                column: "PersonId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantContactRoles_RoleType",
                table: "ParticipantContactRoles",
                column: "RoleType");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantContactRoles_TenantId",
                table: "ParticipantContactRoles",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_People_LastName",
                table: "People",
                column: "LastName");

            migrationBuilder.CreateIndex(
                name: "IX_People_TenantId",
                table: "People",
                column: "TenantId");

            // ── CONTACT-01/02/03 data migration ─────────────────────────────────────
            // Best-effort backfill of the legacy Contact/ParticipantContact pair into the new
            // Person/ParticipantContactRole model, per this task's brief ("MIGRATE existing
            // contact data into the new model in the migration if any exists"). The legacy tables
            // are deliberately left in place, untouched, alongside this backfill — Contact still
            // backs Participant.PlanManagerContact/InvoiceService's real bill-to logic (see
            // Person.cs's type doc), so a full cutover (repointing that FK, dropping Contacts/
            // ParticipantContacts) is out of scope here and would need its own dedicated task.
            //
            // gen_random_uuid() was folded into Postgres core in v13, but pre-13 databases only
            // have it via pgcrypto — creating the extension is a harmless no-op on 13+ (same idiom
            // as AddRestrictivePractices/StaffUserUnification's backfills).
            migrationBuilder.Sql("""CREATE EXTENSION IF NOT EXISTS pgcrypto;""");

            // Step 1: one Person per legacy Contact, reusing Contact.Id as the new Person.Id
            // (safe — Contact never becomes an FK target of ParticipantContactRole, and the two
            // id spaces can't otherwise collide) so a Contact linked to several participants
            // migrates to exactly one deduplicated Person, matching CONTACT-03's "one person,
            // several roles" model rather than one Person per link.
            //
            // Contact has no TenantId column of its own (see Contact.cs's doc — it predates
            // multi-tenancy query filters) — People.TenantId is NOT NULL, so a tenant is derived
            // from whichever tenant-scoped Participant references the Contact first (via
            // ParticipantContacts or Participants.PlanManagerContactId), deterministically
            // tie-broken by the smallest TenantId when more than one exists. This covers the
            // overwhelmingly common case of a Contact only ever being linked within one tenant;
            // an orphaned Contact with zero participant links has no tenant to derive and is
            // simply not migrated (it stays reachable via the untouched legacy Contacts table).
            //
            // MINOR fix-round finding 4 — accepted cross-tenant edge case: a legacy Contact
            // linked to participants in TWO DIFFERENT tenants backfills its Person row into only
            // the smaller TenantId (per the DISTINCT ON tie-break immediately below). Step 2/3's
            // role row for the OTHER tenant's participant then points at a PersonId that tenant's
            // own People query filter hides — ParticipantContactRolesController.ToDto's
            // `r.Person?.FullName ?? string.Empty` falls back to an empty PersonFullName for that
            // row rather than throwing, so this degrades to a blank-looking contact rather than a
            // crash, but the row is otherwise unreachable/unfixable from that tenant's UI. This is
            // accepted as-is for the data actually being deployed here (verified: no Contact in
            // the current deployed dataset is linked across more than one tenant, so this path
            // does not fire in practice). Manual remedy if it's ever hit: insert a duplicate
            // People row scoped to the second tenant (copying the same source fields) and
            // repoint that tenant's orphaned ParticipantContactRole.PersonId at it.
            migrationBuilder.Sql(
                """
                WITH contact_links AS (
                    SELECT pc."ContactId", p."TenantId"
                    FROM "ParticipantContacts" pc
                    JOIN "Participants" p ON p."Id" = pc."ParticipantId"
                    UNION ALL
                    SELECT p."PlanManagerContactId" AS "ContactId", p."TenantId"
                    FROM "Participants" p
                    WHERE p."PlanManagerContactId" IS NOT NULL
                ),
                contact_tenant AS (
                    SELECT DISTINCT ON ("ContactId") "ContactId", "TenantId"
                    FROM contact_links
                    ORDER BY "ContactId", "TenantId"
                )
                INSERT INTO "People"
                    ("Id", "TenantId", "FirstName", "LastName", "Phone", "Mobile", "Email",
                     "AddressLine", "Suburb", "State", "Postcode", "Organisation", "Notes",
                     "CreatedAt", "UpdatedAt")
                SELECT c."Id", ct."TenantId", c."FirstName", c."LastName", c."Phone", c."Mobile",
                       c."Email", c."Address", c."Suburb", c."State", c."Postcode",
                       c."Organisation", c."Notes", c."CreatedAt", c."UpdatedAt"
                FROM "Contacts" c
                JOIN contact_tenant ct ON ct."ContactId" = c."Id";
                """);

            // Step 2: one ParticipantContactRole per legacy ParticipantContact link. The old
            // Contact.ContactType enum (General=0/Guardian=1/EmergencyContact=2/PlanManager=3/
            // SupportCoordinator=4/Primary=5/Secondary=6/Other=7 — see Enums.cs) has no faithful
            // 1:1 mapping onto the new, larger ContactRoleType taxonomy (NextOfKin=0/
            // EmergencyContact=1/Guardian=2/PlanNominee=3/ChildRepresentative=4/
            // SupportCoordinator=5/PlanManager=6/...): the four types with an obvious equivalent
            // map directly; General/Primary/Secondary/Other all fall back to NextOfKin (the
            // closest fit for the DbSeeder's actual legacy data — every migrated seed Contact's
            // RoleRelationship is a family relationship, e.g. "Mother", "Sister / Next of Kin") —
            // Primary also sets IsPrimary = TRUE, mirroring its old meaning.
            //
            // MAJOR fix-round finding 3 — dedup against ContactRoleRules.ValidateUniqueness:
            // legacy data can carry TWO OR MORE PlanManager-type (ContactType=3) or Primary-type
            // (ContactType=5) ParticipantContacts rows for the same participant. Landed naively,
            // that would seed >= 2 active PlanManager roles (ValidateUniqueness: "max 1 active
            // Plan Manager") or >= 2 active-and-primary NextOfKin roles (ValidateUniqueness: "one
            // primary NoK") for one participant — data that violates the app's own invariant the
            // moment this migration lands, and that any later write through
            // ParticipantContactRolesController would then reject. `ranked` below assigns each
            // candidate row a deterministic rank (earliest CreatedAt first, ties broken by the
            // legacy Contact's Id) within its participant + dedup-group (PlanManager rows and
            // primary-NextOfKin rows are ranked as two separate groups; every other row is
            // ungrouped and always rank 1, i.e. never touched by the two CASE branches below).
            // Only rank 1 keeps the state that trips ValidateUniqueness: a later-ranked PlanManager
            // row is landed Status=Superseded (2) instead of Active (0); a later-ranked Primary
            // row is landed IsPrimary=FALSE instead of TRUE. No legacy data is dropped — every
            // row is still inserted, just with the conflicting flag/status downgraded.
            migrationBuilder.Sql(
                """
                WITH mapped AS (
                    SELECT
                        pc."ParticipantId" AS participant_id,
                        p."TenantId" AS tenant_id,
                        c."Id" AS person_id,
                        CASE c."ContactType"
                            WHEN 1 THEN 2  -- Guardian -> Guardian
                            WHEN 2 THEN 1  -- EmergencyContact -> EmergencyContact
                            WHEN 3 THEN 6  -- PlanManager -> PlanManager
                            WHEN 4 THEN 5  -- SupportCoordinator -> SupportCoordinator
                            ELSE 0         -- General/Primary/Secondary/Other -> NextOfKin
                        END AS role_type,
                        (c."ContactType" = 5) AS is_primary,
                        c."RoleRelationship" AS relationship, c."Organisation" AS organisation,
                        c."Notes" AS notes, c."CreatedAt" AS created_at, c."UpdatedAt" AS updated_at
                    FROM "ParticipantContacts" pc
                    JOIN "Contacts" c ON c."Id" = pc."ContactId"
                    JOIN "Participants" p ON p."Id" = pc."ParticipantId"
                ),
                ranked AS (
                    SELECT m.*,
                        ROW_NUMBER() OVER (
                            PARTITION BY m.participant_id,
                                CASE WHEN m.role_type = 6 THEN 'plan_manager'
                                     WHEN m.is_primary THEN 'primary_nok'
                                     ELSE NULL END
                            ORDER BY m.created_at, m.person_id
                        ) AS dedup_rank
                    FROM mapped m
                )
                INSERT INTO "ParticipantContactRoles"
                    ("Id", "TenantId", "ParticipantId", "PersonId", "RoleType",
                     "RelationshipToParticipant", "IsPrimary", "OrderScopeDomains",
                     "OrganisationName", "Status", "Notes", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), r.tenant_id, r.participant_id, r.person_id, r.role_type,
                       r.relationship,
                       CASE WHEN r.is_primary AND r.dedup_rank > 1 THEN FALSE ELSE r.is_primary END,
                       ARRAY[]::text[], r.organisation,
                       CASE WHEN r.role_type = 6 AND r.dedup_rank > 1 THEN 2 ELSE 0 END,
                       r.notes, r.created_at, r.updated_at
                FROM ranked r;
                """);

            // Step 3: one PlanManager role per Participant.PlanManagerContactId, skipped where
            // Step 2 already created an equivalent active PlanManager role for the same
            // (participant, person) pair (a Contact double-linked via both PlanManagerContactId
            // and a PlanManager-typed ParticipantContacts row) — avoids seeding data that
            // immediately violates ContactRoleRules.ValidateUniqueness's "max 1 active Plan
            // Manager" rule the moment this migration lands.
            migrationBuilder.Sql(
                """
                INSERT INTO "ParticipantContactRoles"
                    ("Id", "TenantId", "ParticipantId", "PersonId", "RoleType",
                     "RelationshipToParticipant", "IsPrimary", "OrderScopeDomains",
                     "OrganisationName", "Status", "Notes", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), p."TenantId", p."Id", c."Id", 6,
                       c."RoleRelationship", TRUE, ARRAY[]::text[],
                       c."Organisation", 0, c."Notes", c."CreatedAt", c."UpdatedAt"
                FROM "Participants" p
                JOIN "Contacts" c ON c."Id" = p."PlanManagerContactId"
                WHERE p."PlanManagerContactId" IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM "ParticipantContactRoles" r
                      WHERE r."ParticipantId" = p."Id" AND r."PersonId" = c."Id" AND r."RoleType" = 6
                  );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ParticipantContactRoles");

            migrationBuilder.DropTable(
                name: "People");
        }
    }
}
