# M4 Rostering — pass 1 design

Status: approved 2026-08-21. Implements `Platform Plan/04-modules.md` M4 and step 6 of
`08-tripcore-fork-plan.md` §5, scoped per the confirmed design brief.

**In scope:** Shift entity, weekly shift patterns, staff-participant compatibility matrix,
the roster constraint engine, and the week roster board.
**Out of scope (own tasks):** timesheets and the Employment Hero export, open-shift
claiming, the staff mobile view, full merger of `StaffAssignment` into `Shift`.

## Decisions

1. **Bridge, don't merge.** Trip staffing stays in `StaffAssignment`. Both shifts and trip
   assignments are read by one `RosterConflictService`, so a trip blocks a community shift
   and vice versa. Trip work renders on the board as read-only spanning bars.
2. **One blocking rule.** Expired NDIS worker screening is the only hard stop — it is a
   regulatory prohibition, not a preference. Everything else is a warning the coordinator
   may override by supplying a reason, which is stored on the shift's `OverrideReason` field.
   `Shift` (along with `ShiftPattern` and `StaffParticipantCompatibility`) is registered in
   `AuditedEntities`, so every create/update/delete — including each edit to `OverrideReason`
   — writes an `AuditLog` row via `AuditInterceptor` whose `Changes` JSON carries the old and
   new value of every changed field, not just the fact that a change occurred; the override
   reason text itself is recoverable from the audit trail.
   Overlapping shifts are deliberately a warning: short overlaps are real handovers.
3. **Weekly recurrence only.** `ShiftPattern` is day-of-week + time + effective range. No
   RRULE, no monthly/nth-weekday. Generation is idempotent.
4. **Three-state compatibility.** Preferred / Allowed / Excluded. Not a score. Absence of a
   row means Allowed.
5. **A records gap is not a prohibition.** A worker screening that has never been entered
   (`WorkerScreeningExpiryDate` is null) is a data gap, not proof the worker is unscreened —
   it fires `WSC_MISSING` as a Warning, not `WSC_EXPIRED`. Blocking on missing data would make
   every staff member unrosterable on a fresh deployment until the whole roster's screening
   history is backfilled; only a screening verified to have lapsed against the shift's
   `ServiceDate` is treated as the regulatory hard stop.

## Domain — `Odip.Domain/Rostering/`

```csharp
public enum ShiftStatus { Draft, Published, Completed, Cancelled }
public enum CompatibilityLevel { Preferred, Allowed, Excluded }
public enum RosterFindingSeverity { Warning, Blocking }
```

### Shift : ITenantEntity

| Member | Type | Notes |
|---|---|---|
| Id, TenantId | Guid | |
| ParticipantId / Participant | Guid / Participant | required |
| StaffId / Staff | Guid? / Staff? | **null means unfilled** |
| ServiceDate | DateOnly | the day column the shift belongs to |
| StartTime, EndTime | TimeOnly | |
| EndsNextDay | bool | true for shifts crossing midnight |
| Ratio | SupportRatio | existing enum |
| NightType | SleepoverType | existing enum (None / ActiveNight / Sleepover) |
| Status | ShiftStatus | default Draft |
| ShiftPatternId | Guid? | provenance; null for one-offs |
| Notes | string? | |
| OverrideReason | string? | why warnings were accepted |
| AcknowledgedFindingCodes | string? | comma-separated codes the coordinator accepted |
| CreatedAt, UpdatedAt | DateTime | |

`DurationHours` is computed: `EndsNextDay ? (24 - Start) + End : End - Start`.

### ShiftPattern : ITenantEntity

ParticipantId, DefaultStaffId (Guid?), DayOfWeek, StartTime, EndTime, EndsNextDay, Ratio,
NightType, EffectiveFrom (DateOnly), EffectiveTo (DateOnly?), IsActive, Notes.

### StaffParticipantCompatibility : ITenantEntity

StaffId, ParticipantId, Level (CompatibilityLevel), Reason (string?), UpdatedAt.
Unique index on (TenantId, StaffId, ParticipantId).

### Staff — additive change

Add `WorkerScreeningNumber` (string?) and `WorkerScreeningExpiryDate` (DateOnly?). The
blocking rule needs them and M2 requires them anyway. Do not change the existing
`HasExpiredQualifications` computed property.

## RosterConflictService (pure domain, no EF)

```csharp
public sealed record RosterFinding(string Code, RosterFindingSeverity Severity, string Message);

public sealed record RosterCheckContext(
    Staff Staff,
    Participant Participant,
    IReadOnlyList<Shift> StaffShiftsInWeek,         // excluding the candidate
    IReadOnlyList<StaffAssignment> TripAssignments, // overlapping the candidate's date
    IReadOnlyList<StaffAvailability> Availability,
    CompatibilityLevel Compatibility,
    decimal WeeklyHoursThreshold);                  // default 38m

IReadOnlyList<RosterFinding> Check(Shift candidate, RosterCheckContext ctx);
```

Finding codes, all Warning except where marked:

| Code | Severity | Fires when |
|---|---|---|
| `WSC_EXPIRED` | **Blocking** | WorkerScreeningExpiryDate is earlier than ServiceDate |
| `WSC_MISSING` | Warning | WorkerScreeningExpiryDate is null — no screening recorded yet |
| `DOUBLE_BOOKED_SHIFT` | Warning | another shift for that staff overlaps in time |
| `DOUBLE_BOOKED_TRIP` | Warning | a StaffAssignment covers ServiceDate |
| `STAFF_UNAVAILABLE` | Warning | an Availability record marks the window unavailable |
| `COMPATIBILITY_EXCLUDED` | Warning | Level is Excluded |
| `CREDENTIAL_EXPIRED` | Warning | first aid / licence / manual handling / medication expiry earlier than ServiceDate |
| `COMPETENCY_MISSING` | Warning | see mapping below |
| `RATIO_SHORTFALL` | Warning | Ratio is TwoToOne and fewer than 2 staff cover the slot |
| `OVER_HOURS` | Warning | week total including the candidate exceeds WeeklyHoursThreshold |

Competency mapping (participant need to required staff flag), derived from fields that
actually exist today:

- `OvernightSupport != None` or `NightType != None` requires `IsOvernightEligible`
- `RequiresHoist || RequiresStandingMachine || MobilityAidWheelchair` requires `IsManualHandlingCompetent`
- `IsHighSupport || IsIntensiveSupport` requires `IsFirstAidQualified`

Messages name the person, the rule and the date:
`"Ben Turner's worker screening expired 12 Feb 2026 — cannot roster."`

## ShiftPatternExpander (pure domain)

`IReadOnlyList<DateOnly> Occurrences(ShiftPattern p, DateOnly from, DateOnly to)` — every
matching DayOfWeek inside the intersection of [from,to] and [EffectiveFrom,EffectiveTo],
with inactive patterns yielding none. Generation callers skip dates already carrying a
shift with that ShiftPatternId, so re-running is idempotent.

## API — `/api/v1/rostering`

Mirror `ScheduleController`'s authorisation posture exactly.

| Verb | Route | Purpose |
|---|---|---|
| GET | `/board?weekStart=` | the whole week in one payload |
| POST | `/shifts/check` | dry-run findings for a candidate; no writes |
| POST | `/shifts` | create |
| PUT | `/shifts/{id}` | update |
| DELETE | `/shifts/{id}` | delete |
| POST | `/shifts/{id}/assign` | set or clear StaffId |
| GET POST PUT DELETE | `/patterns`, `/patterns/{id}` | pattern CRUD |
| POST | `/patterns/{id}/generate?from=&to=` | materialise shifts |
| GET | `/compatibility?participantId=` | matrix rows |
| PUT | `/compatibility` | upsert one cell |

Write bodies carry `overrideReason` and `acknowledgedFindingCodes: string[]`. A request
carrying a Blocking finding is rejected 422 regardless of override. A request carrying
warnings without an `overrideReason` is rejected 422 with the findings listed; with one it
succeeds and stores both.

### DTO shapes (the frontend contract)

```ts
type RosterBoard = {
  weekStart: string                 // ISO date, Monday
  days: string[]                    // 7 ISO dates
  rows: RosterStaffRow[]
  unfilled: Shift[]
  exceptions: RosterException[]
}
type RosterStaffRow = {
  staffId: string; fullName: string; role: string
  compliance: 'Ok' | 'Warning' | 'Blocked'
  complianceNotes: string[]
  rosteredHours: number; targetHours: number
  shifts: Shift[]; tripBars: TripBar[]; leave: LeaveBar[]
}
type Shift = {
  id: string; participantId: string; participantName: string
  staffId: string | null; staffName: string | null
  serviceDate: string; startTime: string; endTime: string; endsNextDay: boolean
  durationHours: number; ratio: string; nightType: string; status: string
  shiftPatternId: string | null; notes: string | null
  overrideReason: string | null; findings: RosterFinding[]
}
type TripBar  = { tripInstanceId: string; tripCode: string; tripName: string; startDate: string; endDate: string; isDriver: boolean }
type LeaveBar = { startDate: string; endDate: string; availabilityType: string; notes: string | null }
type RosterFinding = { code: string; severity: 'Warning' | 'Blocking'; message: string }
type RosterException = { shiftId: string | null; participantName: string; serviceDate: string; finding: RosterFinding }
```

## Frontend

Routes `/rostering` (board), `/rostering/patterns`, `/rostering/compatibility`. New
`PageKey` `'rostering'`; not in `SUPPORT_WORKER_PAGES` this pass. Nav: a top-level
**Rostering** submenu directly after the Trips submenu.

Board layout: sticky staff column, seven day columns, Unfilled lane pinned at the top of
the grid. Trip bars are a visibly different material from shift chips — they are not
editable here. Colour means something is wrong; ordinary shifts are neutral surfaces.
Drag to assign via `@dnd-kit/core`, and **every drag action has a keyboard-reachable menu
equivalent**. The shift editor is a slide-over, not a modal. Transitions 150-250ms.
