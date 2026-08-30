# Staff/User Unification — Design Spec

Status: Approved (reviewed and approved section-by-section by the project owner)
Date: 2026-08-30

## 1. Overview / Goal

Unify the separate `Staff` entity with `User` accounts platform-wide: every staff member IS a
user account, the roster displays tenant users, and Staff-as-a-separate-entity is removed.

The approach is a single cut-over migration ("Approach A"): one EF migration performs the schema
change, the data backfill, and the auto-creation of any missing user accounts for orphaned staff
rows, in one pass, rather than a phased dual-write/dual-read rollout.

## 2. Decisions & Scope Boundaries

The following decisions are owner-approved and are the fixed constraints for the implementation:

- Staff fields absorb into `User`; the `Staff` entity and its backing table are deleted entirely.
- The migration auto-creates `SupportWorker` users for any Staff rows that have no linked User,
  so that no shift history is lost.
- The roster displays ALL active tenant users, regardless of role — not just former Staff rows.
- The old `StaffRole` becomes a display-only `Position` enum on `User` (`SupportWorker`,
  `SeniorSupportWorker`, `Coordinator`, `TeamLeader`, `Other`). This is separate from, and does
  not change, the access-control `UserRole` enum (`Admin`, `Coordinator`, `SupportWorker`,
  `ReadOnly`, `SuperAdmin`).
- The `/staff` page stays in the frontend, now backed by Users: tenant Admins/Coordinators
  manage their team there (create/edit accounts plus profile/qualification fields). Settings →
  Users remains the SuperAdmin-only account administration surface, unchanged in scope.
- The backend route `api/v1/staff` KEEPS its existing name/path while serving Users under the
  hood. This is a deliberate pragmatic choice to avoid wholesale client churn — it is not an
  oversight and should not be "corrected" to `api/v1/users` as part of this work.

## 3. Data Model & Migration

### 3.1 User entity changes

File: `odip-prototype/odip/backend/Odip.Domain/Entities/User.cs`

New fields added to `User`:
- `Position` — new enum replacing `StaffRole`, nullable, display-only (see Decisions above).
- `Mobile`
- `Region`
- `IsDriverEligible`
- `IsFirstAidQualified`
- `IsMedicationCompetent`
- `IsManualHandlingCompetent`
- `IsOvernightEligible`
- Four `DateOnly?` expiry dates: First Aid, Driver Licence, Manual Handling, Medication
  Competency expiry.
- `WorkerScreeningNumber`
- `WorkerScreeningExpiryDate`
- `Notes`
- Computed `HasExpiredQualifications`

All boolean flags default to `false`, and the new fields are nullable/defaulted so that
non-staff users (e.g. SuperAdmin accounts) are unaffected by the change.

Removed from `User`: the `StaffId` field and its `Staff` navigation property.

### 3.2 FK re-pointing

Twelve entities that reference Staff get their `StaffId`-family foreign key columns replaced
by `UserId`-family columns, each retaining the SAME nullability and delete behavior it has
today:

| Entity | Old column | New column | Nullability | Delete behavior | Notes |
|---|---|---|---|---|---|
| `Shift` | `StaffId` | `UserId` | nullable | Restrict | |
| `ShiftPattern` | `DefaultStaffId` | `DefaultUserId` | nullable | SetNull | |
| `StaffParticipantCompatibility` | `StaffId` | `UserId` | required | Cascade | unique constraint on `(TenantId, UserId, ParticipantId)` |
| `StaffAssignment` | `StaffId` | `UserId` | required | Restrict | entity itself survives; only the property is renamed |
| `StaffAvailability` | `StaffId` | `UserId` | required | Cascade | entity itself survives |
| `MedicationAdministration` | `WitnessStaffId` | `WitnessUserId` | nullable | Restrict | |
| `IncidentReport` | `InvolvedStaffId` / `ReportedByStaffId` / `ReviewedByStaffId` | `InvolvedUserId` / `ReportedByUserId` / `ReviewedByUserId` | mixed, same as today per column | same as today per column | three separate FK columns |
| `TripClaim` | `AuthorisedByStaffId` | `AuthorisedByUserId` | nullable | SetNull | |
| `VehicleAssignment` | `DriverStaffId` | `DriverUserId` | nullable | SetNull | |
| `Participant` | `PreferredStaffId` | `PreferredUserId` | nullable | SetNull | |
| `BookingTask` | `OwnerId` | `OwnerId` (unchanged name) | unchanged | unchanged | column name stays `OwnerId`; only the FK target table changes, from Staff to Users |
| `TripInstance` | `LeadCoordinatorId` | `LeadCoordinatorId` (unchanged name) | nullable | SetNull | column name stays the same; only the FK target table changes, from Staff to Users |

Note that `StaffAssignment` and `StaffAvailability` are entities whose class/table names are
kept as-is — only their internal `StaffId` property/column is renamed to `UserId`. They are not
being merged into `User` or deleted; they remain distinct join/detail tables.

### 3.3 The migration

Exactly ONE new EF Core migration is added, and it is strictly APPENDED to the existing
migration history. Existing migrations must never be renamed or reordered: `Program.cs`
contains raw-SQL self-healing logic for `__EFMigrationsHistory` that is tied to specific
migration IDs, and disturbing that history can break application startup silently.

The migration performs the following ordered steps:

1. Add the new columns (listed in 3.1) to the `Users` table.
2. Raw SQL: for each Staff row (active OR inactive) that has no linked User, insert a new User:
   - Role: `SupportWorker`.
   - Tenant: same tenant as the Staff row.
   - Names: copied from the Staff row.
   - Username: derived as `first.last`, lowercased, with a numeric collision suffix (`-2`,
     `-3`, …) appended when needed, because the `Username`/`Email` uniqueness constraints are
     GLOBAL (across all tenants), not per-tenant.
   - Email: taken from `Staff.Email` if present and not already used by another user; otherwise
     a placeholder of the form `first.last@<placeholder>.local` is generated.
   - `IsActive`: mirrors the Staff row's active/inactive status.
3. Raw SQL: copy profile fields from each Staff row onto its linked User — whether that User
   already existed prior to this migration or was just created in step 2. If two Users are
   linked to the same Staff row (this is possible in the current schema, since there is no
   unique constraint on `User.StaffId` today), the profile fields are copied onto BOTH Users;
   when a later step needs to pick a single User to backfill a foreign key against (see step 4),
   the earliest-created of the two Users is chosen deterministically.
4. Add the new `UserId`-family columns to all twelve referencing tables listed in 3.2, backfill
   them using the Staff→User mapping built in steps 2–3, then drop the old `StaffId`-family
   columns.
5. Drop `Users.StaffId`, then drop the `Staff` table itself. Remove the `StaffRole` enum from the
   codebase.

### 3.4 Seeder changes

File: `Odip.Infrastructure/Data/DbSeeder.cs`

The seeder is rewritten so that the 10 previously-seeded Staff rows become 10 Users with
profile data:
- The 5 existing staff rows that were already linked to a User absorb their Staff profile data
  onto that same User.
- The 5 previously-orphaned staff rows (no linked User) are replaced by 5 new `SupportWorker`
  users: Marcus Papadopoulos, Priya Sharma, Lachlan Robertson, Jade Watkins, Brendan Nguyen.

All seeded shifts, trips, and tasks are updated to reference user ids instead of staff ids.

The rewrite follows the seeder's existing reset-path ordering, and any new backfill helper
follows the pattern already established by `RestrictivePracticeBackfill`.

## 4. Backend API & Services

### 4.1 `VehiclesStaffController.cs`

- `StaffController` CRUD continues to be exposed at `api/v1/staff`, but is now backed by Users:
  - List: active tenant users, including their profile fields.
  - Create/update: writes a `User` record, with a selectable role (default `SupportWorker`)
    plus the profile/qualification fields described in 3.1.
  - Delete: implemented as a soft-deactivate (`IsActive = false`), not a hard delete.
  - Write access remains restricted to `Admin`, `Coordinator`, `SuperAdmin` roles, unchanged
    from today.
  - Username and email become required fields on create, since a Staff record now IS a real
    login-capable account rather than a lightweight profile row.
- Guardrails added on these endpoints:
  - A tenant Admin or Coordinator can only manage users within their OWN tenant.
  - A tenant Admin or Coordinator cannot grant the `SuperAdmin` role to any user, and cannot
    edit an existing `SuperAdmin` account.
  - Changing a user's role to `Admin` is permitted only when the actor performing the change is
    themselves an Admin — a Coordinator cannot promote anyone to `Admin`.
- `StaffAvailabilityController` and `StaffAssignmentsController` keep their existing routes,
  re-pointed internally to use `UserId` instead of `StaffId`.

### 4.2 `RosteringController.cs`

- Board and validation queries switch their data source from `_db.Staff` to
  `_db.Users.Where(u => u.IsActive)`, and no longer filter by any particular role — all active
  tenant users of any role appear.
- `StaffCompatibilityLinkService` is re-pointed to use `UserId`; its logic (including
  `AutoLinked` semantics) is otherwise unchanged.

### 4.3 Portal, Auth, and Medications

- `StaffIdResolver` (in `Odip.Application/Common`) is DELETED.
- `PortalController` filters shifts directly on `Shift.UserId == currentUserId`, honouring the
  existing `X-View-As-User` super-admin impersonation mechanism exactly as it does today.
- The previous `IsLinked: false` empty-state (shown when a user had no linked Staff record) goes
  away entirely — a user with no shifts now simply gets an empty shift list, with no special
  "not linked" messaging.
- `AuthResponseDto.StaffId` is dropped from the auth response. Frontend logic that previously
  used a user's own `StaffId` for self-exclusion (e.g. excluding yourself from a picker) now
  uses the user's own `id` instead.

### 4.4 Same-tenant validation

Same-tenant validation is added everywhere a user foreign key is written from a request DTO,
closing a previously-unvalidated cross-tenant linking gap. Each of the following write paths
validates that the chosen `UserId` exists, is active, and belongs to the current tenant,
returning a 400 or 404 on violation:

- Medications: witness selection.
- Incidents: all three user pickers (involved, reported-by, reviewed-by).
- Trips: lead coordinator and driver selection.
- Tasks: task owner selection.
- Participants: preferred-staff (now preferred-user) selection.
- Rostering: shift assignment and compatibility linking.

### 4.5 `AdminUsersController.cs`

- Loses the "linked Staff record" field entirely (the concept no longer exists).
- Gains the new profile fields from 3.1, as optional fields.
- Remains SuperAdmin-only, with no change to that access restriction.

## 5. Frontend Changes

- `src/api/hooks/staff.ts` / `src/api/types/staff.ts`: hook names and endpoint paths are
  unchanged, but the records they return now carry `id` (the user id), `username`, `email`,
  `role`, `position`, and the profile/qualification fields from 3.1.
- `src/api/types/auth.ts`: `staffId` is dropped from the auth response type, matching the
  backend change in 4.3.
- `src/lib/permissions.ts`: self-exclusion logic switches from the user's `staffId` to the
  user's own `id`.
- The dead `useMyDashboard` hook (`src/api/hooks/dashboard.ts`) is deleted. It calls a
  nonexistent `GET /staff/me/dashboard` endpoint and has zero call sites in the app, so its
  removal is unrelated cleanup rather than a functional change.
- `StaffPage.tsx` / `StaffCreatePage.tsx` / `QualificationsPage.tsx`: these stay at the `/staff`
  route and continue to list tenant users. Create/edit forms gain account fields (username,
  email, role); the role dropdown always hides `SuperAdmin` as an option, and additionally hides
  `Admin` when the person filling out the form is a Coordinator. The `Position` field replaces
  the old staff-role dropdown. `QualificationsPage.tsx` behaviour is unchanged apart from now
  reading from Users instead of Staff.
- All staff pickers throughout the app become user pickers, with display names sourced from the
  user's first/last name:
  - Witness picker: `RecordAdministrationModal.tsx`.
  - Incident pickers (all three): `IncidentCreatePage.tsx`.
  - Trip pickers (lead coordinator, driver): `trip-detail/StaffTab.tsx`.
  - Task owner picker: `TaskCreatePage.tsx`.
  - Participant preferred-staff picker: `ParticipantCreatePage.tsx`.
  - Rostering board, patterns, and compatibility pickers.
  - `schedule/StaffAssignModal.tsx`.
- `settings/UserFormPanel.tsx`: the "Linked Staff Record" dropdown is DELETED, since the
  underlying concept no longer exists. No other fields are added to Settings → Users — profile
  editing continues to live on the Staff page (per the Decisions in Section 2), not in Settings.
- Portal: `PortalShiftsPage` drops its "not linked to a staff record" empty-state message,
  consistent with the backend change in 4.3. The witness-approval flow is otherwise unchanged.
- Roster board: the staff column now lists all active tenant users of any role, and
  compatibility preferred/not-compatible sorting works identically, just keyed on user ids
  instead of staff ids.

## 6. Testing & Verification

### 6.1 Backend

- Update existing Staff-fixture tests to use user-based fixtures instead, including (at least):
  `RosteringControllerTests`, `PortalControllerTests`, `MedicationsWitnessTests`,
  `StaffCompatibilityLinkServiceTests`, and `ParticipantsControllerTests`.
- Add NEW tests covering:
  - The auto-create mapping rules from the migration (username collision suffixing, and
    earliest-created-user-wins when a Staff row is linked to more than one User).
  - Same-tenant FK validation rejections, for each writing controller listed in 4.4.
- Gate: `dotnet build` and `dotnet test` must both be green.

### 6.2 Frontend

- Update vitest suites that touch staff pickers or the portal shift views.
- Gate: `npm test` and `npm run build` must both be green, with no NEW lint errors introduced
  (pre-existing lint debt in the repo is not required to be cleaned up as part of this work).

### 6.3 Local verification

- Run the new migration against a local Postgres instance seeded with the pre-change
  10-staff/5-linked-user state, specifically to exercise the orphaned-staff auto-create path
  described in step 2 of Section 3.3.
- Manual click-through checks:
  - Roster displays users (of any role), not just former Staff rows.
  - Portal "My Shifts" works correctly for a `SupportWorker` user.
  - The witness flow works end-to-end.
  - Staff page CRUD works correctly when performed as a Coordinator (respecting the guardrails
    in 4.1).

## 7. Out of Scope

The following are explicitly NOT part of this change:

- Permission redesign — `SupportWorker` capabilities remain exactly as `permissions.ts` defines
  them today; no new permissions are introduced or removed.
- The pre-existing `ScheduleController` authorization inconsistency — known, and deliberately
  left untouched by this work.
- Making usernames/emails per-tenant-unique — they remain globally unique, as they are today.
- Full tenant-scoping of the `StaffAssignment`, `StaffAvailability`, `IncidentReport`,
  `TripClaim`, and `VehicleAssignment`/`BookingTask` tables. Only the write-time same-tenant
  validation described in Section 4.4 is added; these tables are not otherwise made
  tenant-scoped as part of this work.
