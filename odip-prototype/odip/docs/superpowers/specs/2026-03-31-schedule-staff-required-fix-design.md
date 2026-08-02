# Schedule Overview — Staff Required Fix

**Date:** 2026-03-31  
**Status:** Approved

## Problem

The schedule overview card displays `staffAssignedCount / minStaffRequired` (e.g. "3/3 staff"). `minStaffRequired` is the user-entered estimate from trip creation and is not updated when bookings change. The trip detail page correctly shows the ratio-calculated value (e.g. 5 / 4.92), but the schedule card remains out of sync.

## Goal

The schedule overview card's required staff count must always reflect participant ratios once bookings exist, falling back to the initial estimate when none do.

## Decision Rule

```
effectiveStaffRequired =
  calculatedStaffRequired > 0
    ? ⌈calculatedStaffRequired⌉   // bookings exist → use ratio result
    : minStaffRequired             // no bookings → use initial estimate
```

`CalculatedStaffRequired` is already recalculated on every booking create/update/delete/cancel in `BookingsAccommodationController.RecalculateStaffRequired()`, so it is always current.

## Changes

### Backend — `ScheduleController.cs`

In the `ScheduleTripDto` projection, replace `MinStaffRequired = t.MinStaffRequired` with:

```csharp
StaffRequired = t.CalculatedStaffRequired > 0
    ? (int)Math.Ceiling(t.CalculatedStaffRequired)
    : t.MinStaffRequired,
```

Add `StaffRequired` (`int?`) to `ScheduleTripDto`. `MinStaffRequired` remains on the DTO for any other consumers; it is not removed.

### Frontend — `frontend/src/api/types/schedule.ts`

Add `staffRequired: number | null` to `ScheduleTripDto`.

### Frontend — `frontend/src/pages/SchedulePage.tsx`

Change the staff display expression (line ~725) from:

```tsx
{trip.staffAssignedCount}/{trip.minStaffRequired ?? '?'} staff
```

to:

```tsx
{trip.staffAssignedCount}/{trip.staffRequired ?? '?'} staff
```

## Files Changed

| File | Change |
|------|--------|
| `backend/Odip.Api/Controllers/ScheduleController.cs` | Compute `StaffRequired` using decision rule |
| `backend/Odip.Application/DTOs/DTOs.cs` | Add `StaffRequired: int?` to `ScheduleTripDto` |
| `frontend/src/api/types/schedule.ts` | Add `staffRequired: number \| null` |
| `frontend/src/pages/SchedulePage.tsx` | Use `staffRequired` in card display |

## Out of Scope

- No DB migration needed (no new columns)
- No change to `minStaffRequired` storage or edit behaviour
- No change to trip detail page (already correct)
