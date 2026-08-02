# Spec: Inline Availability CRUD in Schedule Overview

**Date:** 2026-03-19
**Status:** Approved

## Problem

The Schedule Overview table shows each staff member's availability status per trip (Available / Unavailable / Assigned / Conflict) but there is no way to add, edit, or remove availability records without leaving the page. Users need to block out leave directly from the schedule overview so they can immediately see which trips are affected.

## Solution

Replace the read-only `AvailabilityDetail` sub-row in the Schedule Overview with an inline editable `AvailabilityEditor` that supports full CRUD on `StaffAvailability` records. All mutations invalidate the `schedule-overview` query so the status badges refresh immediately.

## Scope

- **Frontend only** — all three backend endpoints already exist:
  - `POST /api/v1/staff-availability`
  - `PUT /api/v1/staff-availability/{id}`
  - `DELETE /api/v1/staff-availability/{id}`
- Only `Leave`-type records can be created from this UI (the type that blocks trip availability).
- Editing and deleting applies to all existing record types shown (Leave, Unavailable, Training, etc.).

## UX Flow

### Trigger
Clicking the expand chevron on a staff row (existing behaviour) reveals the `AvailabilityEditor` section below the row — no new trigger on the name cell is needed.

### Existing Records
Each `StaffAvailability` record renders as one inline row containing:

| Element | Detail |
|---|---|
| Type badge | Colour-coded, read-only (Leave = red, Unavailable = red, Training = purple, etc.) |
| Start date | `<input type="date">` — editable in place |
| End date | `<input type="date">` — editable in place |
| Notes | Small text input — editable in place |
| Save button | Appears only when a field is dirty; calls `PUT /api/v1/staff-availability/{id}` |
| Delete button | Trash icon; calls `DELETE /api/v1/staff-availability/{id}` immediately (no confirmation dialog) |

On success of Save or Delete: invalidate `schedule-overview` query → table status badges refresh.

### Adding a New Record
A `+ Add Leave` button sits at the bottom of the section. Clicking it inserts a new blank inline row with:

- Start date input (required)
- End date input (required)
- Notes input (optional)
- **Save** button — calls `POST /api/v1/staff-availability` with `availabilityType: "Leave"`
- **Cancel** button — removes the row with no API call

On Save success: invalidate `schedule-overview` query.

## Files Changed

| File | Change |
|---|---|
| `frontend/src/api/hooks.ts` | Add three mutation hooks: `useCreateStaffAvailability`, `useUpdateStaffAvailability`, `useDeleteStaffAvailability`. Each invalidates `['schedule-overview']` on success. |
| `frontend/src/pages/SchedulePage.tsx` | (a) Update the import line to include the three new hooks. (b) Replace the `AvailabilityDetail` component definition (lines 71–98) with a new `AvailabilityEditor` component. (c) Replace the `<AvailabilityDetail availability={s.availability} />` call site with `<AvailabilityEditor staffId={s.id} availability={s.availability} />`. |

## Data Model Reference

```
StaffAvailability {
  id: Guid
  staffId: Guid
  startDateTime: DateTime   // stored as UTC; UI uses date-only inputs
  endDateTime: DateTime
  availabilityType: AvailabilityType  // enum: Available | Unavailable | Leave | Training | Preferred | Tentative
  isRecurring: bool
  recurrenceNotes?: string
  notes?: string
}
```

`CreateStaffAvailabilityDto` fields required by the POST endpoint:
- `staffId`, `startDateTime`, `endDateTime`, `availabilityType`, `isRecurring` (false), `notes?`

`UpdateStaffAvailabilityDto` fields required by the PUT endpoint:
- All fields from Create (full replace semantics).

## Schedule Logic (Backend — unchanged)

A staff member shows `Unavailable` for a trip when any `StaffAvailability` record with `availabilityType == Unavailable || Leave` overlaps the trip's date range. Adding a Leave record via this UI will therefore immediately reflect in the refreshed table.

## Out of Scope

- Deleting records does not ask for confirmation (scope kept minimal).
- No support for `isRecurring` or `recurrenceNotes` in the UI (not relevant to the leave use-case).
- No ability to create non-Leave types from this UI.
- No vehicle availability editing.
