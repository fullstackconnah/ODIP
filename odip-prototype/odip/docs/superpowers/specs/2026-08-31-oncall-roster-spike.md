# ROSTER-01 — On-call nurse/manager roster spike

> **Recommendation: don't build now.** MED-01 ships fully from the MED-02 static tenant manager
> contact alone; ROSTER-01 is an optional, not required, dependency (see the backlog and "Build /
> don't-build recommendation" below). Greenlight condition: the product owner confirms a provider
> is large enough to actually rotate on-call duty across multiple people before this is picked up.

---

## PART 2 — ROSTER-01 spike: on-call nurse/manager roster

### What exists today

Rostering lives in `Odip.Domain/Rostering/RosteringEntities.cs`, `Odip.Api/Controllers/RosteringController.cs`,
`Odip.Domain/Rostering/Services/RosterConflictService.cs`, and the frontend at
`odip-prototype/odip/frontend/src/pages/rostering/`.

- **`Shift`** — one row = one staff member (`UserId`, nullable = unfilled) rostered to one
  **participant** (`ParticipantId`, required — not nullable) for one day/time window
  (`ServiceDate`, `StartTime`, `EndTime`, `EndsNextDay`). Every shift is inherently
  participant-scoped; there is no "org-wide" or "unassigned to a participant" shift concept
  anywhere in the model.
- **`ShiftPattern`** — a weekly-recurring template (day-of-week + time + participant + default
  staff) that `ShiftPatternExpander` materialises into concrete `Shift` rows.
- **`StaffParticipantCompatibility`** — sparse Preferred/Allowed/Excluded matrix, irrelevant here.
- **`RosterConflictService`** — pure rule engine (`WSC_EXPIRED` is the one Blocking finding;
  everything else — double-booking, unavailability, compatibility, expired credentials,
  competency gaps, 2:1 ratio shortfall, over-hours — is a Warning the coordinator can override
  with a reason). All rules assume a participant-scoped shift; several (ratio shortfall,
  competency-vs-participant-needs) are meaningless for an org-wide on-call role.
- `Position` enum (`Odip.Domain/Enums/Enums.cs`) is `SupportWorker | SeniorSupportWorker |
  Coordinator | TeamLeader | Other` — **no `Nurse` or `Manager` value exists.** Roles like
  Admin/SuperAdmin/Coordinator are a separate auth-role concept, not `Position`.
- `RosteringController` is gated `[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]` on every
  action, and the board's `groupBy=participant|staff` views both assume the participant-shift
  shape end to end (`RosterBoardDto.ParticipantRows`/`StaffRows`, `ShiftDto.ParticipantName`
  required, `RosterParticipantRowDto.DaysWithoutCover` computed per participant).
- Frontend: `RosterBoardPage.tsx` renders the week grid from that same participant/staff shape
  (`RosterGrid.tsx`, `RosterDayCell.tsx`); there's no "on-call" lane or unassigned-to-participant
  row anywhere in the UI.

**Conclusion: on-call is a fundamentally different shape than everything Shift currently models.**
An on-call nurse/manager assignment is org-wide (or region-wide), not tied to a participant, runs
for a rotation window (commonly a full day or a week), and doesn't need any of
`RosterConflictService`'s participant-shift rules (ratio, compatibility, competency-vs-participant
-needs). Forcing it into `Shift` means giving every on-call row a fake/dummy `ParticipantId`,
which breaks `ParticipantId` being a real FK, breaks the participant-mode board (an on-call row
would either need a fake participant to attach to or would vanish from that view), and drags in
irrelevant conflict-check rules that would need to be special-cased back out.

### Smallest sound design, if built: a new `OnCallAssignment` entity

Not a flag on `Shift`. A tiny, separate, tenant-scoped entity:

```csharp
public class OnCallAssignment : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid UserId { get; set; }
    public User? User { get; set; }

    public OnCallRole Role { get; set; }        // Nurse | Manager
    public DateOnly ServiceDate { get; set; }    // one calendar day per row, mirrors Shift.ServiceDate
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public bool EndsNextDay { get; set; }        // reuse Shift's own pattern for overnight on-call

    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public enum OnCallRole { Nurse, Manager }
```

Why this shape:
- Mirrors `Shift`'s day/time/`EndsNextDay` fields exactly, so the same "week grid" rendering
  and date-window overlap helpers (`ToWindow`/`Overlaps` already in `RosterConflictService`) are
  reusable rather than reinvented.
- No `ParticipantId` — correctly models that on-call is org-wide, not participant-scoped.
- `Role` distinguishes Nurse vs Manager on-call as separate rotations (a tenant may want both
  covered simultaneously), without needing to extend the `Position` enum (`Position` describes a
  staff member's day job; on-call is a rotation assignment, an orthogonal concept — a
  `TeamLeader` could easily be the rostered on-call manager).
- Deliberately **excluded** from `RosterConflictService.Check` — none of double-booked-shift,
  ratio-shortfall, or competency-vs-participant rules apply. The only conflict worth checking is
  "does this user already have an overlapping `OnCallAssignment` row" — a single, separate,
  much simpler check, not worth folding into the existing engine's per-participant assumptions.
- A day-granularity design (one row per calendar day, like `Shift.ServiceDate`) is sufficient —
  nothing in the backlog or in MED-01's use case calls for finer-grained on-call handoffs than a
  day, and matching `Shift`'s existing day-based grid keeps the UI pattern consistent.

New minimal API surface on `RosteringController` (or a small sibling `OnCallController`):
- `GET /api/v1/rostering/on-call?date=...` → returns the Nurse and Manager currently on call for
  a given date/time (this is the one MED-01 actually needs — see below).
- `GET/POST/PUT/DELETE /api/v1/rostering/on-call-assignments` — basic CRUD for the coordinator to
  build the rotation, same auth gate as the rest of `RosteringController`
  (`SuperAdmin,Admin,Coordinator`).

Frontend: a new lane/section on `RosterBoardPage.tsx` (or a dedicated small on-call tab) —
two rows (Nurse, Manager) across the existing day columns, assign-by-click like an unfilled
`Shift` slot. Does not need `RosterGrid.tsx`'s participant/shift complexity — a much simpler
7-cell-by-2-row picker is enough.

### How MED-01 surfaces "current on-call person" live

`GET /api/v1/rostering/on-call?date={today}&time={now}` (or simply `?date=today`, since
day-granularity is the recommended scope) resolves the current `OnCallAssignment` row(s) for
`Role.Nurse` and `Role.Manager`, joins to `User` for name + `Mobile` (the field already exists on
`User.cs:26`), and returns e.g.:

```json
{ "nurse": { "name": "...", "phone": "..." }, "manager": { "name": "...", "phone": "..." } }
```

MED-01's guidance card calls this endpoint when rendering and, if a `manager` on-call row exists
for right now, shows **that** person/number in step 1 instead of (or alongside) the MED-02 static
tenant manager contact — "on duty now" beats "the org's default manager," especially after hours.
If the on-call endpoint returns nothing (no rotation configured for today, or ROSTER-01 isn't
built), MED-01 falls back to the static MED-02 manager contact — this fallback path is exactly
why MED-01 lists ROSTER-01 as an *optional* dependency, not a hard one.

### Build / don't-build recommendation

**Don't build ROSTER-01 now.** Reasoning:

1. **MED-01 does not need it to ship.** The backlog itself marks ROSTER-01 as optional for MED-01
   and says "treat as a spike before building" — this document *is* that spike, and it confirms
   MED-01 v1 is fully deliverable from MED-02's static tenant setting alone.
2. **No signal of real demand yet.** Nothing else in the backlog (checked `odip-changes-todo.md`
   in full) references on-call rostering — it's a single "look into" bullet, not a
   requirement tied to a specific incident or provider complaint.
3. **Cost is non-trivial for a live-updating rotation.** A real on-call feature needs rotation
   editing UI, handoff notifications, and — if it's meant to be trustworthy at 2am — some
   resilience story for "nobody configured next week's rotation" (silent fallback to a stale or
   empty on-call contact is worse than not having the feature, since MED-01's guidance would
   otherwise present a wrong/no-answer number as authoritative).
4. **The static MED-02 contact already solves the actual problem** ("who do I call") for the
   common case of a small provider with one or two managers. Live on-call rotation only pays off
   once a provider is large enough to actually rotate the on-call duty across multiple people —
   worth confirming with the product owner that this scale exists before investing.

**If/when it is greenlit**, the design above (`OnCallAssignment` as a separate entity, excluded
from `RosterConflictService`, day-granularity, a single `/on-call` read endpoint for MED-01) is
the minimal sound build — small enough to be a single focused increment on top of the existing
Rostering module rather than a rearchitecture of `Shift`.
