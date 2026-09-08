# Shift Completion + Claim-from-Shifts — Design

Status: Approved 2026-09-08 — design; implementation plan pending.

`ShiftStatus.Completed` has existed as an enum value since the roster board shipped, but
nothing in the codebase has ever set it — `UpdateShift` (PUT `shifts/{id}`) writes whatever
`Status` a coordinator's client sends, which means a shift can be marked Completed by
accident or by a stray client bug, with no actual-time record, no review, and no connection
to billing. Separately, the entire claim pipeline (`ClaimGenerationService`, `ClaimLineItem`,
`TripClaim`) is wired exclusively to trip bookings (`ParticipantBooking`) — a support-worker
shift has no way to become a claim line at all today. This spec gives workers a genuine
Start/Finish flow with actual times, gives the office a review-and-approve step that is the
only path to `Completed`, and extends the claim model so a range of Completed shifts can
generate a Draft claim the same way a completed trip does.

## Product rulings

1. **Worker submits actual times.** In the portal, the assigned worker taps Start and Finish
   on their own shift. Both actions stamp the server's own `DateTime.UtcNow` — the client
   never supplies the "real" timestamp, only an optional device geolocation stamp and an
   optional decline flag if geolocation is refused (refusing is recorded, never blocking).
   Finish is disabled until at least one `ShiftNote` exists on the shift, and is refused
   server-side under the same rule.
2. **Office reviews variances against rostered times.** Every submitted shift lands in a
   review queue regardless of how close actual times were to rostered times — a
   "no variance" shift is still reviewed, just pre-highlighted as clean. The reviewer either
   Approves (shift becomes `Completed`) or Returns it to the worker with a required reason
   (shift goes back to `Published` for the worker to resubmit).
3. **Completed shifts feed claim generation.** A Completed, not-yet-claimed shift is eligible
   input to a new "generate claim from shifts" action, parallel to the existing
   trip-claim-generation path but running its own pricing/day-type logic.

## Context — what exists today

- `Shift` (`odip-prototype/odip/backend/Odip.Domain/Rostering/RosteringEntities.cs`, class at
  line 45, `ShiftStatus` enum at line 8: `Draft=0, Published=1, Completed=2, Cancelled=3`) has
  no actual-time fields — no `ActualStart`, `ActualEnd`, or `CompletedAt`.
- Nothing sets `ShiftStatus.Completed`. `PortalController`'s own doc comment (lines 159-163):
  *"there is no shift-completion transition anywhere in this domain... the coordinators Draft
  to Published toggle is the only status write that exists."* `RosteringController.UpdateShift`
  (`Odip.Api/Controllers/RosteringController.cs:345-374`) writes `shift.Status = dto.Status;`
  verbatim from the client at line 368 — a coordinator (or a bug) can currently PUT any
  `ShiftStatus` including `Completed`, with none of this spec's guarantees.
- `ShiftNote` (NOTES-01, same file, line 174) links notes to a shift via `ShiftId`, written
  through `PortalController`: `GET shifts/{id:guid}/notes` (170), `POST shifts/{id:guid}/notes`
  (190 — the endpoint Finish's note-required guard checks against), `PUT notes/{noteId:guid}`
  (223), `POST notes/{noteId:guid}/acknowledge-flags` (259). `PortalController`'s self-scoping
  idiom — every action resolves the caller's own id via `ResolveCurrentStaffIdAsync`, 404
  (never 403) on a shift belonging to someone else — must extend to the new start/finish
  actions.
- The claim pipeline is entirely trip-shaped. `ClaimGenerationService`
  (`Odip.Infrastructure/Services/ClaimGenerationService.cs`) loads a `TripInstance` and
  iterates `trip.Bookings.Where(b => b.BookingStatus == BookingStatus.Confirmed)`
  (`ParticipantBooking` rows, lines 61-65/138-172) to build `ClaimLineItem`s, gated on
  `trip.Status == TripStatus.Completed` (line 68). `ClaimLineItem`
  (`Odip.Domain/Entities/ClaimLineItem.cs`) has a required `Guid ParticipantBookingId` and
  non-nullable `ParticipantBooking` navigation; `TripClaim` (`Odip.Domain/Entities/
  TripClaim.cs`) likewise requires `Guid TripInstanceId`. Neither can attach to a shift today.
- Day-type/pricing logic is directly reusable: `GroupDaysByType`/`ResolveDayType`
  (`ClaimGenerationService.cs:355-388`) classify each date as Weekday/Saturday/Sunday/
  PublicHoliday by querying `_db.PublicHolidays` directly (`PublicHoliday`,
  `Odip.Domain/Entities/PublicHoliday.cs`, a plain `{Id, Date, Name, State}` row synced by
  `HolidaySyncBackgroundService` — no separate lookup service exists); `GetPriceForState`
  (`ClaimGenerationService.cs:390-403`) is a `switch` on a **state string** against
  `SupportCatalogueItem`'s ten `PriceLimit_*` columns. **Correction to the approved brief:**
  `Participant.Region` (`Odip.Domain/Entities/Participant.cs:67`) is `public string? Region` —
  free-text region prose (e.g. "South East QLD", "Melbourne Metro"), not an enum and not a
  state abbreviation, so it can never match `GetPriceForState`'s switch cases. The real
  state-abbreviation field is `Participant.AddressState`
  (`Odip.Domain/Entities/Participant.cs:145`, doc comment: "AU state/territory abbreviation
  (e.g. \"QLD\", \"NSW\")"). Note also that the trip path today only ever uses
  `settings.State ?? "VIC"` (`ClaimGenerationService.cs:158`) and never consults the
  participant at all. The shift-claim price lookup must reuse `GetPriceForState`'s
  string-switch shape keyed off `Participant.AddressState ?? ProviderSettings.State`.
- `ProviderSettings` (`Odip.Domain/Entities/ProviderSettings.cs`) has a `State` string but
  **no timezone field anywhere** — the only `TimeZone` hit in the backend is
  `MedicationAdministration.AdministeredAtTimeZone` (`Odip.Domain/Entities/
  MedicationAdministration.cs:45`, a nullable string beside a UTC instant), the precedent this
  spec's `ShiftCompletion.TimeZoneId` follows. Nothing derives a tenant timezone today — see
  Open questions.
- `CaregiverProfileSubmission` is the existing "at most one active row" precedent
  `ShiftCompletion`'s uniqueness follows: a partial unique index in `OdipDbContext.cs`
  (`~649-653`): `e.HasIndex(x => x.ParticipantId).IsUnique().HasDatabaseName("IX_
  CaregiverProfileSubmissions_ParticipantId_Active").HasFilter("\"Status\" IN (0, 1)")`.
- `AuditedEntities.Types` (`Odip.Infrastructure/Audit/AuditedEntities.cs:8-65`) already covers
  `Shift`/`StaffAssignment`/`LeaveRequest`; `ShiftCompletion` joins for the same reason
  `Shift.OverrideReason` is audited. Config convention: no `Options` classes exist anywhere;
  `HolidaySyncBackgroundService.cs:78-83` reads `_config.GetValue<int>("HolidaySync:FromYear",
  2025)` directly — `Rostering:VarianceReviewMinutes` follows the identical idiom. No
  `HasCheckConstraint` call exists anywhere in `OdipDbContext.cs` — the exactly-one-of
  `ParticipantBookingId`/`ShiftId` constraint introduces this pattern for the first time; the
  EF Core 8 shape (`entity.ToTable(tb => tb.HasCheckConstraint(name, sql))`) is standard.
- Frontend: `frontend/src/components/ConfirmDialog.tsx` is the existing modal-confirm
  component (already used by `LeaveApprovalsPage`'s approve/decline flow). Claims hooks live
  in `frontend/src/api/hooks/claims.ts` (`useTripClaims`, `useClaim`, `useGenerateClaim`,
  `usePreviewClaim`, `useUpdateClaim`, `useUpdateClaimLineItem`, `useDeleteClaim`), all
  trip-scoped. The only claim UI today is `frontend/src/pages/trip-detail/ClaimsTab.tsx`; there
  is no participant-level claims surface — `ParticipantDetailPage.tsx`'s tab union (line 30:
  `'details' | 'contacts' | 'bookings' | 'support' | 'medications' | 'notes' | 'routines' |
  'restrictive-practices' | 'history'`) has no `'claims'` entry. `App.tsx` registers
  `/rostering/leave` at line 137 (`<Route path="/rostering/leave" element={<PrivateRoute
  page="leave-approvals"><LeaveApprovalsPage /></PrivateRoute>} />`) — the pattern
  `/rostering/completions` copies; portal routes (`/portal`, `/portal/shifts/:id`,
  `/portal/witness-approvals`, `/portal/leave`) use `page="portal"`/`page="portal-leave"`.

## 1. Data model

```csharp
// backend/Odip.Domain/Rostering/RosteringEntities.cs — append-only enum change
public enum ShiftStatus
{
    Draft = 0,
    Published = 1,
    Completed = 2,
    Cancelled = 3,
    InProgress = 4,      // NEW — worker has tapped Start
    PendingReview = 5,   // NEW — worker has tapped Finish, awaiting office review
}
```

Numeric values 0-3 are persisted data — do not renumber. `Shift` gains one scalar field:

```csharp
public class Shift : ITenantEntity
{
    // ...existing fields unchanged...
    public int ReturnCount { get; set; }   // NEW — incremented every time office Returns this shift
}
```

`ReturnCount` lets the portal show "Returned for correction (x2)" without a join; the actual
return *reason* always comes from the latest `ShiftCompletion` row (below), never duplicated
onto `Shift` itself.

```csharp
// backend/Odip.Domain/Rostering/ShiftCompletionEntities.cs (new file)

public enum ReviewOutcome { Approved = 0, Returned = 1 }

public class ShiftCompletion : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ShiftId { get; set; }
    public Shift? Shift { get; set; }
    public DateTime ActualStart { get; set; }                   // UTC, server-stamped unless StartWasManual
    public DateTime? ActualEnd { get; set; }                     // UTC, null until Finish; may be next calendar day
    public string TimeZoneId { get; set; } = string.Empty;        // IANA id used to compute variance — see §3
    public decimal? StartLatitude { get; set; }
    public decimal? StartLongitude { get; set; }
    public decimal? EndLatitude { get; set; }
    public decimal? EndLongitude { get; set; }
    public bool GeolocationDeclined { get; set; }
    public bool StartWasManual { get; set; }                      // true when Finish supplied actualStart (Start was skipped)
    public Guid SubmittedByUserId { get; set; }                   // the worker — Shift.UserId at Start time
    public DateTime StartedAt { get; set; }                       // = ActualStart unless StartWasManual (then the real Finish-time stamp)
    public DateTime? SubmittedAt { get; set; }                     // set on Finish
    public Guid? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public ReviewOutcome? ReviewOutcome { get; set; }
    public string? ReturnReason { get; set; }
    public int VarianceMinutesStart { get; set; }                 // ActualStart - rostered start, signed
    public int VarianceMinutesEnd { get; set; }                    // ActualEnd - rostered end, signed (0 until Finish)
    public bool IsActive { get; set; } = true;                     // resolves the "1:1 vs history" question — see below
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
```

**"At most one active" resolution.** The brief asks to pick between an explicit `IsActive`
bool or deriving activeness from `ReviewOutcome`; this design uses an explicit bool, because
deriving from "outcome is null OR Approved" reads backwards (a fully-closed-out Approved row
counting as "active") and would break the day a status like "Approved but later disputed" is
added. `IsActive` defaults `true`; Return (§3) sets the current row's `IsActive = false` in
the same transaction that flips `Shift.Status` back to `Published`, excluding it from the
"current" 1:1 without deleting it (full history stays queryable by `ShiftId` alone). A
resubmit (Start again on a Returned shift) inserts a new row with `IsActive = true`. Approve
never touches `IsActive` — an Approved row is the one active row forever, since a Completed
shift can never be re-started (§3 guards this).

Uniqueness, mirroring `CaregiverProfileSubmission`'s partial-index precedent
(`OdipDbContext.cs:~649-653`):

```csharp
entity.HasIndex(x => x.ShiftId)
    .IsUnique()
    .HasDatabaseName("IX_ShiftCompletions_ShiftId_Active")
    .HasFilter("\"IsActive\"");
```

`ShiftCompletion` joins `AuditedEntities.Types` (`AuditedEntities.cs:8-65`) on day one — same
justification as `Shift.OverrideReason`: a Return's reason and every review decision must be
recoverable.

**Claim-side changes** (own migration, PR 3 — see Delivery):

```csharp
// ClaimLineItem.cs
public Guid? ParticipantBookingId { get; set; }        // was required Guid — now nullable
public ParticipantBooking? ParticipantBooking { get; set; }  // was non-nullable
public Guid? ShiftId { get; set; }                       // NEW
public Shift? Shift { get; set; }                         // NEW

// DB check constraint (new pattern for this codebase — see Context):
entity.ToTable(tb => tb.HasCheckConstraint(
    "CK_ClaimLineItem_ExactlyOneParent",
    "((\"ParticipantBookingId\" IS NOT NULL)::int + (\"ShiftId\" IS NOT NULL)::int) = 1"));
```

```csharp
// TripClaim.cs
public enum ClaimKind { Trip = 0, Shift = 1 }
public ClaimKind Kind { get; set; } = ClaimKind.Trip;       // NEW — append-only, Trip=0 keeps every existing row correct
public Guid? TripInstanceId { get; set; }                    // was required Guid — now nullable
public TripInstance? TripInstance { get; set; }               // was non-nullable
public Guid? ParticipantId { get; set; }                      // NEW
public Participant? Participant { get; set; }                  // NEW
public DateOnly? PeriodFrom { get; set; }                      // NEW
public DateOnly? PeriodTo { get; set; }                         // NEW
```

Invariant (documented in a class doc-comment, enforced in `ShiftClaimGenerationService`, not
a DB constraint — a claim-kind check constraint spanning five nullable columns was judged not
worth the complexity for a single-writer invariant): `Kind == Trip` ⇒ `TripInstanceId` set,
`ParticipantId`/`PeriodFrom`/`PeriodTo` null; `Kind == Shift` ⇒ `ParticipantId` +
`PeriodFrom` + `PeriodTo` set, `TripInstanceId` null.

## 2. API + permissions

**Portal** (`PortalController`, `[Authorize]` + `ResolveCurrentStaffIdAsync` self-scoping,
404 never 403 — same idiom as every existing portal action):

| Method | Route | Request | Response | Status |
|---|---|---|---|---|
| POST | `/portal/shifts/{id}/start` | `{ latitude?, longitude?, geolocationDeclined }` | `PortalShiftDetailDto` | 200, 404, 409 (see §3 guards) |
| POST | `/portal/shifts/{id}/finish` | `{ latitude?, longitude?, geolocationDeclined, actualStart? }` | `PortalShiftDetailDto` | 200, 404, 409 |

Both slot after `GetShiftDetail` (`PortalController.cs:110-153`), scoped identically:
`_db.Shifts.FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value)`.
`PortalShiftDetailDto` gains a nested `completion` (current active `ShiftCompletion`, or
null) and `returnCount` so the UI renders the "Returned: &lt;reason&gt;" banner without a
second round-trip.

**Rostering** (`RosteringController`, class-level `[Authorize(Roles =
"SuperAdmin,Admin,Coordinator")]`, `Route("api/v1/rostering")` — same gate as every existing
action on this controller):

| Method | Route | Request | Response | Status |
|---|---|---|---|---|
| GET | `/rostering/completions?status=&from=&to=` | — | `CompletionQueueItemDto[]` | 200 |
| GET | `/rostering/shifts/{id}/completion` | — | `ShiftCompletionDto` | 200, 404 |
| POST | `/rostering/shifts/{id}/completion/approve` | — | `ShiftCompletionDto` | 200, 404, 409 |
| POST | `/rostering/shifts/{id}/completion/return` | `{ reason }` (required) | `ShiftCompletionDto` | 200, 400 (no reason), 404, 409 (claimed shift) |

`status` defaults to `PendingReview`; passing `Approved`/`Returned` lets the queue show
history. `UpdateShift` (`RosteringController.cs:345-374`) gets one new guard right after the
existing `refError` check, closing the backdoor from Context — PUT can still toggle
Draft↔Published (today's only real use) but can no longer jump straight to
`Completed`/`InProgress`/`PendingReview`:

```csharp
if (dto.Status != shift.Status
    && !(shift.Status is ShiftStatus.Draft or ShiftStatus.Published
         && dto.Status is ShiftStatus.Draft or ShiftStatus.Published))
    return Conflict(ApiResponse<ShiftDto>.Fail(
        "Status can only be changed via the shift-completion endpoints.", "STATUS_TRANSITION_VIA_COMPLETION"));
```

**Claims** (`ClaimsController`, `Route("api/v1")`, per-write-action `[Authorize(Roles =
"Admin,Coordinator,SuperAdmin")]` — same gate as the existing trip-claim actions):

| Method | Route | Request | Response | Status |
|---|---|---|---|---|
| GET | `/participants/{participantId}/claims?kind=Shift` | — | `TripClaimListDto[]` | 200 |
| POST | `/participants/{participantId}/claims/from-shifts/preview` | `{ from, to }` | `ShiftClaimPreviewResponseDto` | 200, 400 |
| POST | `/participants/{participantId}/claims/from-shifts` | `{ from, to }` | `TripClaimListDto` | 200, 400, 409 |

The GET is a small necessary addition beyond the two POSTs the brief names — the claims tab
(§4) needs a way to list a participant's shift-claims, mirroring `GetClaimsForTrip`
(`ClaimsController.cs:72-86`) filtered by `ParticipantId` instead of `TripInstanceId`.
`TripClaimListDto` gains `Kind`, `ParticipantId?`, `PeriodFrom?`, `PeriodTo?`.

**DTOs** — `backend/Odip.Application/DTOs/ShiftCompletionDTOs.cs` (new file), following the
existing camelCase-stable discipline:

| DTO | Properties |
|---|---|
| `StartShiftDto` | `latitude?`, `longitude?`, `geolocationDeclined` |
| `FinishShiftDto` | `latitude?`, `longitude?`, `geolocationDeclined`, `actualStart?` |
| `ShiftCompletionDto` | `id`, `shiftId`, `actualStart`, `actualEnd`, `timeZoneId`, `geolocationDeclined`, `startWasManual`, `submittedByUserId`, `submittedByName`, `startedAt`, `submittedAt`, `reviewedByUserId`, `reviewedByName`, `reviewedAt`, `reviewOutcome`, `returnReason`, `varianceMinutesStart`, `varianceMinutesEnd` |
| `CompletionQueueItemDto` | `shiftId`, `completionId`, `participantName`, `staffName`, `serviceDate`, `rosteredStart`, `rosteredEnd`, `actualStart`, `actualEnd`, `varianceMinutesStart`, `varianceMinutesEnd`, `status` (`ShiftStatus`) |
| `ReturnCompletionDto` | `reason` |
| `GenerateShiftClaimRequestDto` | `from`, `to` |
| `ShiftClaimPreviewResponseDto` | `totalAmount`, `lineItems: ShiftClaimPreviewLineItemDto[]` |
| `ShiftClaimPreviewLineItemDto` | `shiftId`, `serviceDate`, `dayTypeLabel`, `dayType`, `supportItemCode`, `hours`, `unitPrice`, `totalAmount` |

**Frontend permissions** (`frontend/src/lib/permissions.ts`, following the existing
`canWrite*` one-boolean-per-capability convention):

```ts
/** Mirrors PortalController's shift start/finish — any non-ReadOnly authenticated user, own shifts only. */
canCompleteOwnShifts: !isReadOnly,
/** Mirrors RosteringController's completion review actions — [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]. */
canReviewCompletions: isSuperAdmin || isAdmin || isCoordinator,
```

No new `PageKey` is needed for the portal shift-detail page (already gated as `'portal'`);
`/rostering/completions` uses the existing `'rostering'` key, registered next to
`/rostering/leave` — `leave-approvals` earned its own key because `SupportWorker` must never
see it despite sitting under `/rostering`, whereas completions review is ordinary
coordinator-only rostering work like the board itself.

## 3. State machine, variance, and claim-from-shifts generation

`Published →(Start)→ InProgress →(Finish)→ PendingReview →(Approve)→ Completed`, or
`PendingReview →(Return)→ Published` (`ReturnCount++`). Full matrix in Error handling below.

**Start** (`POST portal/shifts/{id}/start`) — 404 if not the caller's own shift; 409
`SHIFT_NOT_STARTABLE` if `Shift.Status` isn't `Published` (covers Cancelled, Draft, and
double-start). Creates a `ShiftCompletion` with `ActualStart = StartedAt = DateTime.UtcNow`,
`TimeZoneId` resolved per the tenant-timezone rule below, `SubmittedByUserId = Shift.UserId`,
`GeolocationDeclined`/lat/long from the body, `IsActive = true`. Flips `Shift.Status =
InProgress`.

**Finish** (`POST portal/shifts/{id}/finish`) — same 404 rule. 409 `SHIFT_NOTE_REQUIRED` if
`_db.ShiftNotes.AnyAsync(n => n.ShiftId == id)` is false, checked first so the worker gets one
clear reason. If `Shift.Status == Published` and `dto.ActualStart` is supplied (Start was
skipped): creates the `ShiftCompletion` row now with `ActualStart = dto.ActualStart`,
`StartWasManual = true`, `StartedAt = DateTime.UtcNow` (the real Finish instant, kept distinct
from the manually-entered `ActualStart` for audit honesty). If `Published` with no
`actualStart`, or any status other than `Published`/`InProgress` → 409
`SHIFT_NOT_IN_PROGRESS`. Otherwise (`InProgress`) uses the existing active row. Sets
`ActualEnd = DateTime.UtcNow`, `SubmittedAt = DateTime.UtcNow`, end lat/long, computes both
variances (below). Flips `Shift.Status = PendingReview`.

**Approve** (`POST rostering/shifts/{id}/completion/approve`) — 404 if no shift or no active
`ShiftCompletion`; 409 `SHIFT_NOT_PENDING_REVIEW` if not `PendingReview`. Sets
`ReviewedByUserId`/`ReviewedAt`/`ReviewOutcome = Approved`, flips `Shift.Status = Completed`.
No notification — only Finish and Return raise one (see Notifications).

**Return** (`POST rostering/shifts/{id}/completion/return`) — same 404/409 as Approve, plus
400 if `reason` is blank. 409 `SHIFT_ALREADY_CLAIMED` if any `ClaimLineItem` already
references this `ShiftId` (message includes the `ClaimReference`) — a claimed shift can never
be un-completed out from under billing; the state machine never actually lets an
Approved/claimed shift re-enter `PendingReview`, so this is defence-in-depth, kept because the
brief calls it out explicitly. Sets `ReviewedByUserId`/`ReviewedAt`/`ReviewOutcome =
Returned`/`ReturnReason`, `IsActive = false`; increments `Shift.ReturnCount`; flips
`Shift.Status = Published`.

**Variance calculation.** Rostered start/end are computed from `Shift.ServiceDate` +
`Shift.StartTime` / `Shift.EndTime` (`+1` day if `Shift.EndsNextDay`), interpreted as local
time in `ShiftCompletion.TimeZoneId` and converted to UTC via
`TimeZoneInfo.ConvertTimeToUtc`, then diffed against `ActualStart`/`ActualEnd` in minutes
(signed — positive means late/over, negative means early/under). `Rostering:
VarianceReviewMinutes` (`IConfiguration.GetValue<int>("Rostering:VarianceReviewMinutes", 15)`,
same direct-`IConfiguration` idiom as `HolidaySyncBackgroundService.cs:78-83` — no `Options`
class) sets the "no variance" pre-highlight threshold in the queue UI; it does **not** gate
review — every submission is reviewed regardless of variance size, per ruling 2.

**Tenant timezone source.** `TimeZoneId` is resolved once, at Start, from a static
Australian-state → IANA-zone map (`VIC/NSW/ACT/TAS → "Australia/Sydney"`, `QLD →
"Australia/Brisbane"`, `SA → "Australia/Adelaide"`, `WA → "Australia/Perth"`, `NT →
"Australia/Darwin"`) keyed off `ProviderSettings.State` — the only geographic signal that
exists on the tenant today (see Context: no dedicated timezone field exists anywhere). This
is a pragmatic default, not a precise one; flagged in Open questions.

**`ShiftClaimGenerationService`** (`backend/Odip.Infrastructure/Services/
ShiftClaimGenerationService.cs`, new file, deliberately separate from `ClaimGenerationService`
— the trip path carries `ClaimPreviewRequestDto` overrides for departure/return/active-hours
that have no shift equivalent, and mixing the two would force every trip call site to reason
about shift-only parameters):

```csharp
public async Task<ShiftClaimPreviewResponseDto> PreviewAsync(Guid participantId, DateOnly from, DateOnly to, CancellationToken ct);
public async Task<TripClaim> GenerateDraftClaimAsync(Guid participantId, DateOnly from, DateOnly to, CancellationToken ct);
```

Both load `_db.Shifts.Where(s => s.ParticipantId == participantId && s.Status ==
ShiftStatus.Completed && s.ServiceDate >= from && s.ServiceDate <= to && !_db.ClaimLineItems
.Any(l => l.ShiftId == s.Id))` — Completed and not yet claimed, mirroring `TripInstance`'s
"no active claim already exists" check in `GenerateDraftClaimAsync`
(`ClaimGenerationService.cs:71`) but at the line-item level since a shift range spans many
independent shifts, not one trip. Generate throws `InvalidOperationException` ("No completed,
unclaimed shifts found in this date range.") on an empty result — surfaced as 400 by the
controller, same as every other `InvalidOperationException` in `ClaimsController`.

Per-shift line generation reuses the trip path's building blocks: `ResolveDayType`-equivalent
logic against `Shift.ServiceDate` (querying `_db.PublicHolidays`, `ClaimGenerationService.cs:
179-183`); `FindCatalogueItem` keyed on the resolved `ClaimDayType` +
`Participant.IsIntensiveSupport` (`ClaimGenerationService.cs:340-345`); a
`GetPriceForState`-shaped switch keyed on `Participant.AddressState ?? ProviderSettings.State`
(see Context correction — `Region` is free-text prose, `AddressState` is the abbreviation).
Hours come from `Shift.DurationHours` (already
accounts for `EndsNextDay`), not `ShiftCompletion`'s actual times — **billing is against
rostered hours, not clocked hours**; the office already accepted any variance at Approve time,
so re-deriving hours here would silently relitigate that decision. `GSTCode` comes from
`ProviderSettings.GSTRegistered`, same as the trip path. Each shift becomes one
`ClaimLineItem` (`ShiftId` set, `ParticipantBookingId` null, `SupportsDeliveredFrom` =
`SupportsDeliveredTo` = `Shift.ServiceDate`), attached to one new `TripClaim` (`Kind = Shift`,
`ParticipantId` set, `PeriodFrom`/`PeriodTo` = the request range, `ClaimReference` built the
same `"TC-{code}-{date}"` shape as `BuildClaimReference` using the NDIS number in place of a
trip code).

## 4. UI

**`PortalShiftDetailPage.tsx`** (`frontend/src/pages/portal/PortalShiftDetailPage.tsx`) gains
a Start/Finish card, inserted between the existing shift time/status block (lines 91-113) and
the Participant summary block (115+), state-driven off `shift.status`: `Published` (not yet
started) shows a "Start shift" button that requests `navigator.geolocation.
getCurrentPosition` (short timeout) then calls `useStartShift` regardless of accept/decline —
denial sets `geolocationDeclined: true` and omits lat/long, per ruling 1. `InProgress` shows
elapsed time since `ActualStart` and a "Finish shift" button, disabled with an inline hint
("Add a shift note before finishing") until `useShiftNotes(shift.id)` returns a row — reusing
the hook `ShiftNotesSection.tsx` already calls, no new fetch — same geolocation
prompt-then-proceed via `useFinishShift`. `PendingReview` shows a static "Submitted —
awaiting review" banner. `shift.returnCount > 0` with current status `Published` adds a
"Returned: &lt;reason&gt;" banner above Start, reading `reason` from the `completion` object
the detail DTO now carries (§2) — no extra fetch. `Completed` shows a compact read-only
summary (actual start/end, variance, approver name).

**Permissions-Policy.** `navigator.geolocation.getCurrentPosition` above will always fail —
silently, as a permissions error, indistinguishable from the user declining — under the
`Permissions-Policy` header this app ships today: `nginx/default.conf:50` sends
`Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()` on the served SPA,
and `Odip.Api/Program.cs:490` sends the same on API JSON responses. `geolocation=()` disables
the Geolocation API for every origin, including the document itself — there is no per-call
override once the header says this. Both files need `geolocation=()` → `geolocation=(self)`.
`nginx/default.conf:50` is the load-bearing change — it governs the document the browser
actually renders `PortalShiftDetailPage.tsx` inside, so it's what the Geolocation API call
itself is gated by; `Program.cs:490` only covers API JSON responses and is changed for
consistency, not because it affects this call. Without the nginx change, Start/Finish's
geolocation capture is unavailable on every browser, unconditionally — not a per-user permission
prompt outcome.

**`CompletionReviewPage`** (`frontend/src/pages/rostering/CompletionReviewPage.tsx`, new
file), registered in `App.tsx` immediately after the `/rostering/leave` route (line 137),
same shape:

```tsx
<Route path="/rostering/completions" element={<PrivateRoute page="rostering"><CompletionReviewPage /></PrivateRoute>} />
```

A `PageHeader` (`frontend/src/components/PageHeader.tsx`) with status/staff/date filters
(default `status=PendingReview`), a `DataTable` (`frontend/src/components/DataTable.tsx`)
whose rows show participant, staff, rostered vs. actual times side-by-side with a variance
badge (green within the 15-minute default threshold, amber outside — there's no existing
pattern here for shipping backend config to the frontend, so it's hardcoded to match). Approve
and Return both go through `ConfirmDialog` (`frontend/src/components/ConfirmDialog.tsx`) —
Return's adds a required reason textarea, mirroring `LeaveApprovalsPage`'s decline dialog. A
sidebar entry under Rostering links here with a pending-count badge, computed the same
read-time way the leave feature's badge is.

**Claims entry point.** A new `'claims'` tab is added to `ParticipantDetailPage.tsx`'s `Tab`
union (line 30) and its `initialTab` guard, rendering
`frontend/src/pages/participant-detail/ClaimsTab.tsx` (distinct from the trip-scoped
`frontend/src/pages/trip-detail/ClaimsTab.tsx` — same name, different directories, never
imported together). It lists the participant's shift-claims (`GET
/participants/{id}/claims?kind=Shift`) and has a "Generate from shifts" button opening a
`Modal` (`frontend/src/components/Modal.tsx`): date-range picker → preview (line items,
total) → confirm → `useGenerateShiftClaim`. Generated claims route to the existing
`ClaimDetailPage.tsx`, since `PATCH claims/{id}/line-items/{id}` and `PUT claims/{id}` are
already generic over `ClaimLineItemId`/`ClaimId`, not booking-shaped.

**Hooks.** `portal.ts` gains `useStartShift`/`useFinishShift` (invalidating
`['portal-shift', id]` and `['portal-shift-notes', id]`). `rostering.ts` gains
`useCompletions`, `useCompletion`, `useApproveCompletion`, `useReturnCompletion`. `claims.ts`
gains `useParticipantClaims`, `usePreviewShiftClaim`, `useGenerateShiftClaim` — the same file
the trip claim hooks live in, since a participant claim is still a `TripClaim`/`ClaimLineItem`.

## Data flow

**Worker completes a shift → office approves → claim generated.** Worker taps Start on a
`Published` shift → `ShiftCompletion` row created, `Shift.Status = InProgress`. They add a
`ShiftNote` via the existing `ShiftNotesSection`, then tap Finish → note-required guard
passes, `ActualEnd`/variances computed, `Shift.Status = PendingReview`, a
`ShiftCompletionPendingReview` notification raised. Coordinator opens
`/rostering/completions`, sees the row (green badge — within threshold), clicks Approve →
`Shift.Status = Completed`. Later, from the participant's `claims` tab, the coordinator picks
a date range covering that shift, previews (one line item, correct day-type/price), confirms
→ `ShiftClaimGenerationService.GenerateDraftClaimAsync` creates a `Draft` `TripClaim` (`Kind =
Shift`) with one `ClaimLineItem`. The claim then goes through the existing generic
`ClaimDetailPage`/`ClaimsController` review flow unchanged.

**Worker's times get sent back for correction.** Same flow, but actual times are well outside
rostered (amber badge). Coordinator clicks Return, must type a reason → `ShiftCompletion.
IsActive = false`, `ReviewOutcome = Returned`, `Shift.Status = Published`,
`Shift.ReturnCount++`, a `ShiftCompletionReturned` notification raised. Worker reopens the
shift, sees the "Returned: &lt;reason&gt;" banner, taps Start again (a fresh `IsActive = true`
row; the old one stays for history) and resubmits.

**Notifications hook-in.** On Finish, raise `ShiftCompletionPendingReview`; on Return, raise
`ShiftCompletionReturned` — both via the notification outbox defined in the sibling spec
`docs/specs/2026-09-08-notifications-design.md` (referenced by path only; not defined here).

## Error handling

| Rule | Status | Code / message |
|---|---|---|
| Start on a shift not `Published` (Cancelled, Draft, or already started/reviewed/completed) | 409 | `SHIFT_NOT_STARTABLE` |
| Finish with zero `ShiftNote` rows on the shift | 409 | `SHIFT_NOTE_REQUIRED` |
| Finish before Start with no `actualStart` supplied | 409 | `SHIFT_NOT_IN_PROGRESS` |
| Finish on a shift not `Published` (manual-start case) or `InProgress` | 409 | `SHIFT_NOT_IN_PROGRESS` |
| Start/Finish on a shift not belonging to the caller | 404 | (never 403 — matches `PortalController`'s existing idiom) |
| Approve/Return on a shift not `PendingReview` | 409 | `SHIFT_NOT_PENDING_REVIEW` |
| Return without a `reason` | 400 | "A return reason is required." |
| Return on a shift that already has a claim line | 409 | `SHIFT_ALREADY_CLAIMED` (includes `ClaimReference`) |
| `UpdateShift` PUT with a `Status` outside Draft↔Published | 409 | `STATUS_TRANSITION_VIA_COMPLETION` |
| Claim-from-shifts with no Completed/unclaimed shifts in range | 400 | "No completed, unclaimed shifts found in this date range." |

**State-transition matrix** (`ShiftStatus`):

| From \ To | InProgress | PendingReview | Completed | Published |
|---|---|---|---|---|
| Draft | — | — | — | Coordinator (PUT, unchanged) |
| Published | Worker (Start) | — | — | — |
| InProgress | — | Worker (Finish) | — | — |
| PendingReview | — | — | Office (Approve) | Office (Return) |
| Completed | — | — | — | — (terminal, short of the defence-in-depth guard above) |
| Cancelled | — | — | — | — |

## Out of scope / explicitly deferred

- Award interpretation (penalty rates, overtime) — claim lines bill rostered hours at the flat
  catalogue rate, same as the trip path today. Break tracking — no unpaid-break deduction
  exists on `Shift` and this feature doesn't add one. Travel-time claims between shifts.
- Offline Start/Finish — no `vite-plugin-pwa`/IndexedDB exists anywhere in the frontend
  (confirmed absent); a worker without connectivity simply can't submit until back online.
  Deferred to a future PWA spec.
- Trip-side `StaffAssignment` completion parity — `AssignmentStatus.Completed` is already
  client-writable via `StaffAssignmentsController.Update` with no review step; bringing it up
  to this same reviewed-completion standard is separate work.
- PDF invoice / BPR CSV generation for `Kind == Shift` claims — `InvoiceService
  .GenerateInvoiceAsync`/`BprCsvService.GenerateBprCsvAsync` are both written around a
  `ParticipantBookingId`, which a shift claim's line items have none of. This PR's
  `ShiftClaimGenerationService` only produces the Draft claim and its line items — export is
  deferred (see Open questions).
- Editing `ActualStart`/`ActualEnd` after the fact — Return-and-resubmit is the only
  correction path; there is no direct edit of a `ShiftCompletion` row.

## Testing

**Backend (`Odip.Tests`)**, inline in-memory `OdipDbContext` fixture with mocked
`ICurrentTenant` per the existing `StaffAssignmentGateTests.CreateDb` pattern (no shared base
class):

- `Rostering/ShiftCompletionStateMachineTests` — every transition in the matrix below,
  including the double-start/finish-before-start/finish-with-no-notes 409s and the
  assigned-worker-only 404 guard.
- `Rostering/ShiftCompletionVarianceTests` — variance calc against rostered times, including
  an `EndsNextDay` sleepover shift crossing midnight, and the state→timezone map.
- `Rostering/RosteringCompletionReviewTests` — Approve/Return role gating, Return's
  required-reason 400, `SHIFT_ALREADY_CLAIMED` guard, `ReturnCount` increments, `IsActive`
  flips correctly across a Return-then-resubmit cycle.
- `Controllers/RosteringUpdateShiftStatusGateTests` — `UpdateShift` accepts Draft↔Published,
  rejects every other `Status` with `STATUS_TRANSITION_VIA_COMPLETION`.
- `Billing/ShiftClaimGenerationServiceTests` — day-type/holiday resolution reusing
  `PublicHoliday` fixtures, price selection by `Participant.AddressState` (incl. null
  fallback to `ProviderSettings.State`), the exactly-one-of check constraint (both-set and
  neither-set inserts rejected by the DB), Completed-and-unclaimed filtering, empty-range 400.
- `Audit/ShiftCompletionAuditTests` — copies the `Rostering/RosteringAuditTests.cs` scaffold:
  Approve/Return decisions and reasons land in `AuditLog`.

**Frontend** — co-located `*.test.tsx`, `vi.mock('@/api/hooks', ...)` with `vi.hoisted` per the
`PortalShiftsPage.test.tsx` precedent: `PortalShiftDetailPage.test.tsx` additions (Start/Finish
button states across every `ShiftStatus`, Finish disabled until `useShiftNotes` returns a row,
geolocation accept/decline, the Returned banner); `CompletionReviewPage.test.tsx` (queue
rendering, variance badge thresholds, Approve/Return dialogs, Return's required-reason
validation — assert submit payload rather than rendered validation text, per this repo's known
`zod@4`/`@hookform/resolvers@3` mismatch, same limitation the leave-approvals tests already
work around); `participant-detail/ClaimsTab.test.tsx` (preview → generate flow, empty-range
state).

## Delivery

Three PRs, each additive-only migrations (per `Program.cs`'s raw-SQL migration-history
self-healing — never rename or reorder an existing migration id):

1. **State machine.** `ShiftCompletion` entity + `ShiftStatus` append + `Shift.ReturnCount`,
   migration `AddShiftCompletion` (after
   `20260907071508_AddStaffLeaveAndRecurringUnavailability`, the current latest),
   `AuditedEntities.Types` addition, `PortalController` start/finish actions,
   `RosteringController` completion endpoints + `UpdateShift` status gate,
   `ShiftCompletionDTOs.cs`, the timezone map, all backend tests above except
   `ShiftClaimGenerationServiceTests`.
2. **Portal + review UI + mock-api.** `PortalShiftDetailPage.tsx` Start/Finish card,
   `CompletionReviewPage.tsx`, `App.tsx` route, `permissions.ts` additions, `portal.ts`/
   `rostering.ts` hooks, sidebar badge, frontend tests for these. `mock-api/server.js` gains
   fixture-array-plus-handler routes (same style as `leaveRequests`/`recurringUnavailabilities`,
   `mock-api/server.js:685-881`) for `shifts/:id/start`, `shifts/:id/finish`,
   `rostering/completions`, `rostering/shifts/:id/completion(/approve|/return)`.
   `nginx/default.conf` + `Program.cs` Permissions-Policy `geolocation=(self)`.
3. **Claim-from-shifts.** Own migration `AddShiftClaims` (`ClaimLineItem.ParticipantBookingId`
   nullable + `ShiftId`, `TripClaim.Kind`/`TripInstanceId` nullable/`ParticipantId`/
   `PeriodFrom`/`PeriodTo`, the check constraint), `ShiftClaimGenerationService`, the three new
   `ClaimsController` actions, `participant-detail/ClaimsTab.tsx`, `ParticipantDetailPage.tsx`
   tab addition, `claims.ts` hook additions, `ShiftClaimGenerationServiceTests`, mock-api
   routes for `participants/:id/claims(/from-shifts/preview|/from-shifts)`.

**Every existing reader of `ClaimLineItem.ParticipantBookingId`/`.ParticipantBooking`** must
be audited against the new nullability in PR 3 (all confirmed by direct read in this pass):

| File | Lines | Change needed |
|---|---|---|
| `ClaimGenerationService.cs` | 104 (writer) | None — always sets it for trip claims |
| `ClaimsController.cs` (`GetClaim`) | 96, 113-116 | Null-conditional / `Kind`-branch on `.ParticipantBooking.Participant` |
| `ClaimsController.cs` (`DeleteClaim`) | 209 | Filter nulls from `LineItems.Select(l => l.ParticipantBookingId)` before resetting booking `ClaimStatus` |
| `InvoiceService.cs` | 30, 37, 49 | None — `Where(l => l.ParticipantBookingId == bookingId)` already returns zero rows for a shift claim (invoice export is out of scope for shift claims, see below) |
| `BprCsvService.cs` | 14, 23, 33 | Null-guard on `.ThenInclude(li => li.ParticipantBooking)` and the `PlanTypeOverride ?? Participant?.PlanType` filter so a shift-kind line is excluded, not a null-reference |

## Open questions

1. Should PR 3 also ship invoice/BPR-CSV generation for `Kind == Shift` claims, or is a Draft
   claim with reviewable line items (no downstream document export) an acceptable first
   release? This design defers export entirely — a scope call for whoever schedules PR 3.
   **Partially resolved** by `docs/specs/2026-09-08-integration-framework-design.md` §2 (Xero
   push): a `Kind == Shift` claim that reaches `Status == Ready` gets pushed to Xero as one
   ACCREC invoice per claim, once that spec's PR 2 lands (after or alongside this spec's PR
   3) — BPR-CSV export for agency-managed shift claims remains unaddressed either way.
2. The tenant-timezone source for variance calculation (§3) is a hardcoded
   Australian-state → IANA-zone map keyed off `ProviderSettings.State`, since no timezone
   field exists anywhere today. Precise enough for production billing-adjacent use, or should
   a `ProviderSettings.TimeZoneId` field be added instead (its own small migration)?
3. Can the same worker who submitted Start/Finish also Approve their own shift if they hold a
   Coordinator role (a working coordinator covering their own shift)? Nothing in the brief
   addresses self-review, and `RosteringController`'s role gate has no self-exclusion
   anywhere else in the codebase to draw a precedent from.
