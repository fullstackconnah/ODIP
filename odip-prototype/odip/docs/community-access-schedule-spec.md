# Community Access Scheduling — Feature Spec

Scoped against the current `odip-prototype` fork (2026-08-08). Grounded in the existing domain model (`Odip.Domain/Entities`) and the existing `SchedulePage`/`pages/schedule` module, which today only handles trip-based staff/vehicle assignment. Community access needs its own view because participants and staff relate day-by-day rather than trip-by-trip.

## 1. Why a new module, not a reuse of the trip Schedule

`StaffAssignment` is hard-wired to `TripInstance`, `ScheduledActivity` is hard-wired to `TripDay`, and `StaffAvailability.IsRecurring` is a free-text flag rather than a structured weekly pattern. None of that supports a participant-by-day grid, recurring weekly shifts, multi-staff ratios, or split/handover shifts. Community Access should be a parallel module that reuses existing look-and-feel (badges, availability editor pattern, permissions) but has its own entities.

## 2. Data model additions (backend)

- **`CommunityAccessShift`** (the occurrence row shown on the grid): `Id`, `TenantId`, `ParticipantId`, `ShiftDate`, `StartTime`, `EndTime`, `SupportRatio` (override of `Participant.SupportRatio` if set), `Status` (reuse `AssignmentStatus`: Proposed/Confirmed/Completed/Cancelled), `SeriesId` (nullable FK to the recurring pattern below), `IsException` (marks a one-off edit that breaks from its series), `Location`, `Notes`.
- **`ShiftStaffAssignment`**: `Id`, `ShiftId`, `StaffId`, `SegmentStart`/`SegmentEnd` (`TimeOnly`), `Role` (new enum: Primary/Secondary/Relief/Handover), `SortOrder`. One shift can have multiple rows — this is what makes ratios (2 staff : 1 participant) and split shifts (Staff A 8–12, Staff B 12–4) both representable without new tables per case.
- **`RecurringShiftPattern`** (the "Fixed Schedule" the user described): `Id`, `TenantId`, `ParticipantId`, `DayOfWeek`, `StartTime`, `EndTime`, `SupportRatio`, default staff, `EffectiveFrom`, `EffectiveTo` (nullable = ongoing), `IsActive`. Occurrences are materialised as real `CommunityAccessShift` rows on a rolling window (e.g. next 8–12 weeks), not computed on the fly — that's what lets a single occurrence be moved or cancelled without touching the rest of the series.
- **Extend `StaffAvailability`**: today it's a start/end datetime plus a free-text recurrence note. Add structured `DayOfWeek` + `StartTime`/`EndTime` fields (or a sibling `RecurringAvailability` entity) so "available Mon/Wed/Fri 9–3" is queryable, not just readable.
- **New enums**: `ShiftAssignmentRole` (Primary, Secondary, Relief, Handover); `RecurrenceEditScope` (ThisOccurrence, ThisAndFuture, EntireSeries) for the move/edit API payloads.
- **Ratio-linked shifts** (one staff covering several participants at once, e.g. 1:2): needs a way to tie multiple `CommunityAccessShift` rows together as one physical shift instance — a `GroupShiftId` or link table — so moving/editing one moves the linked set and the UI can show "shared with [Participant]".

## 3. Navigation & permissions

- New nav item "Community Access" → route `/community-access`, following the existing `AppLayout` + `PrivateRoute` + `PageKey` pattern in `App.tsx`.
- Add `communityAccess` to `lib/permissions.ts`. Confirm with John/Kay whether support workers get read-only access to their own shifts or no access at all — coordinators/admins get full write.
- Sub-views: Weekly Grid (default), Fixed Schedules (template manager), Staff Availability panel.

## 4. Weekly grid view (core screen)

- Axes exactly as described: days Mon–Sun across the X axis for the selected week (prev/next week nav + date picker), participants down the Y axis as rows.
- Each cell renders the shift(s) for that participant/day as stacked chips — staff name/initials, time range, ratio badge, status colour — supporting multiple shifts per participant per day.
- Click an empty cell → quick-add modal, participant + date pre-filled, choose time/staff/ratio.
- Click an existing chip → detail panel to edit time, reassign staff, cancel, or mark complete.
- Row header carries participant flags already on the `Participant` entity (wheelchair, high support, default ratio) so coordinators don't have to look them up elsewhere.
- Filter bar: by participant, staff, region, status. Export/print button (CSV/PDF), mirroring the existing `ItineraryPdf` pattern used for trips.

## 5. Staff availability & coverage table

- Secondary table, staff on rows / days on columns, showing Available / Unavailable / Leave / Training blocks — reuse the `AvailabilityType` enum and the existing `AvailabilityEditor` component pattern from the trip schedule module rather than building a new one.
- Per-day coverage indicator: rostered hours vs. available hours, flag under/over-staffed days.
- "Recommend staff" on a partially-filled cell → ranked candidates scored on availability match, required qualifications (from `Participant`/`SupportProfile` flags — first aid, manual handling, medication), `Participant.PreferredStaffId`, no same-day conflict, region match, and hours-balance across the week.
- "Auto-fill week" runs the same scoring across every unassigned cell and produces a draft roster for review — it should never commit without an explicit confirm step.

## 6. Fixed/recurring schedule menu

- Per-participant (or a global "Fixed Schedules" list): define one or more weekly patterns — day of week, time window, ratio, optional default staff.
- Saving a pattern generates/extends the rolling window of real shift rows via a background job or an "extend to [date]" action.
- Editing a pattern offers the same scope choice as moving a shift on the grid (see §7): future occurrences only, or also regenerate ones already generated but not yet started.
- Ending a pattern (`EffectiveTo`) stops future generation without touching historical/completed shifts.

## 7. Click-and-drag rescheduling

- Drag a chip to a different day (same participant row) or a different participant (reassign) triggers a move.
- If the shift belongs to a series (`SeriesId` set), prompt on drop: **"Move just this day"** vs **"Move this and all future occurrences"** — matching the Outlook/Google Calendar pattern the user described. A one-off (non-recurring) shift moves immediately, no prompt.
- Dropping onto a slot that creates a conflict (staff double-booked, participant already has an overlapping shift) should block or warn-and-confirm, reusing the `HasConflict` pattern already present on `StaffAssignment`.
- **Technical note:** the frontend has no drag-and-drop library today (`package.json` has none). Recommend `@dnd-kit/core` (+ `@dnd-kit/sortable` if needed) over native HTML5 drag-and-drop — better React 19/Tailwind fit and far easier to animate/style for a grid.

## 8. Ratios & split shifts

- Ratio badge per shift, from `Participant.SupportRatio` or a per-shift override, covering everything already in the `SupportRatio` enum (1:1 up to 1:5, 2:1, shared support).
- **Multiple staff → one participant** (e.g. 2:1): multiple `ShiftStaffAssignment` rows on one `CommunityAccessShift`.
- **One staff → multiple participants** (e.g. 1:2): the group-shift link described in §2, shown on the grid as tied/linked chips.
- **Split shift with handover**: 2+ `ShiftStaffAssignment` rows with non-overlapping `SegmentStart`/`SegmentEnd` spanning the full shift window (e.g. Staff A 8:00–12:00, Staff B 12:00–16:00). Render as one chip visually divided at the handover point. Validate that segments are contiguous with no coverage gap.

## 9. Validation rules

- Staff double-booked across any overlapping window.
- Participant with overlapping shifts unless intentionally ratio-linked or split.
- Staff availability must be Available/Preferred for the window (not Unavailable/Leave).
- Required qualifications present (medication competency, manual handling, etc. per participant support profile).
- Split-shift segments contiguous with no gaps/overlaps.
- Surface conflicts inline using the same visual language (red border/icon on the chip) as `StatusBadge`/`HasConflict` elsewhere in the app.

## 10. Reporting & future billing hook

- Each completed shift should be able to feed the existing `Billing` vertical slice (`BillableEvent`/`ClaimBatch`) the same way trip claims do — not needed for MVP, but the shift entity should carry the fields a `SupportCatalogueItem` line-item mapping will need later so this isn't a rework.
- Weekly roster export (PDF/CSV) for staff who don't log into the app.
- A "Community Access" summary tile on `DashboardPage` (shifts today, unassigned shifts, conflicts) alongside the existing trip/task tiles.

## 11. Suggested build order

1. **MVP:** read + manual-assign weekly grid, single shift per participant/day, default ratio only, edit-via-modal (no drag), fixed-schedule templates that generate real occurrence rows, double-booking conflict check only.
2. Drag-and-drop with the occurrence-vs-series prompt; staff availability table with coverage indicator; multiple shifts per participant per day.
3. Ratios (multi-staff and multi-participant/linked shifts); split shifts with handover.
4. Recommendation engine / auto-fill roster; qualification-aware conflict checks.
5. Billing/claims integration, exports, dashboard tile.

Phasing this way means every phase ships something usable on its own, and the data model (§2) is designed so later phases don't require re-migrating earlier data.
