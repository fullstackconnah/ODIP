# Event Template Management — Design Spec

**Date:** 2026-03-30
**Status:** Approved

## Problem

The platform supports using event templates for trips but provides no UI to create, edit, or delete them. Templates are read-only in Settings. There is also no way to create a template from an existing trip.

## Scope

Event template CRUD only. Activity library management is out of scope (next iteration).

## Decision Summary

| Question | Decision |
|----------|----------|
| Template editor UX | Slide-over panel (right side, list stays visible) |
| New template entry point | Blank form opens immediately; "Fill from trip" selector inside the form |
| Save as Template from trip | Slide-over pre-filled with trip data, user reviews before saving |
| Delete behaviour | Soft delete — sets `IsActive = false`, record preserved |

---

## Section 1: Backend

**One new endpoint:**

```
DELETE /api/v1/event-templates/{id}
```

- Sets `IsActive = false` and `UpdatedAt = DateTime.UtcNow` on the `EventTemplate`
- No row deletion — historical `TripInstance` records keep their `EventTemplateId` reference
- Returns `204 No Content`
- Role-restricted: `Admin`, `Coordinator`, `SuperAdmin` (same as POST/PUT)
- Located in `TasksDashboardController.cs` alongside existing event-template endpoints

GET, POST, and PUT already exist — no other backend changes needed.

---

## Section 2: Frontend API Layer

**New mutation hooks** (added to `frontend/src/api/hooks/activities.ts`):

```ts
useCreateEventTemplate()       // POST /event-templates
useUpdateEventTemplate()       // PUT /event-templates/{id}
useDeactivateEventTemplate()   // DELETE /event-templates/{id}
```

All three invalidate `['event-templates']` on success.

`CreateEventTemplateDto` and `UpdateEventTemplateDto` already exist in `frontend/src/api/types/events.ts` — no new types needed.

**Trip list for "Fill from trip":** uses existing `useTrips` hook — no new hook needed.

**Field mapping function** (co-located with `TemplateFormPanel`):

```ts
function mapTripToTemplate(trip: TripListDto): Partial<CreateEventTemplateDto> {
  return {
    eventName: trip.tripName,
    eventCode: trip.tripCode,
    defaultDestination: trip.destination ?? '',
    defaultRegion: trip.region ?? '',
    standardDurationDays: trip.durationDays,
  }
}
```

Fields with no trip equivalent (`preferredTimeOfYear`, `accessibilityNotes`, `typicalActivities`, accommodation notes) are left blank for the user to fill in.

---

## Section 3: `TemplateFormPanel` Component

**File:** `frontend/src/components/TemplateFormPanel.tsx`

**Props:**

```ts
interface TemplateFormPanelProps {
  isOpen: boolean
  onClose: () => void
  template?: EventTemplateDto   // present → edit mode; absent → create mode
  initialTrip?: TripListDto     // pre-seeds fields from "Save as Template" on trip screen
}
```

**Layout (slide-over, right side):**

- **Header:** "New Template" or "Edit Template" + close (×) button
- **Fill from trip selector** (create mode only): searchable dropdown of all trips. Selecting one calls `mapTripToTemplate()` and overwrites the mapped fields. Shows the `initialTrip` pre-selected when provided.
- **Form fields** (React Hook Form + Zod):
  - Event Name *(required)*
  - Event Code *(required)*
  - Default Destination
  - Default Region
  - Standard Duration (days)
  - Preferred Time of Year
  - Typical Activities *(textarea)*
  - Accessibility Notes *(textarea)*
  - Fully Modified Accommodation Notes, Semi Modified Accommodation Notes, Wheelchair Access Notes *(textareas, grouped in collapsible "Accessibility Details" section)*
- **Footer:**
  - Save + Cancel buttons
  - Edit mode only: "Deactivate" button (destructive styling). Clicking replaces it with an inline "Deactivate this template? Confirm / Cancel" prompt before calling `useDeactivateEventTemplate`.

**Behaviour:**
- Submits via `useCreateEventTemplate` (create) or `useUpdateEventTemplate` (edit)
- On success: closes panel, shows toast, cache invalidated by hook

---

## Section 4: Settings — Event Templates Tab

Changes to `SettingsPage.tsx`:

- **"+ New Template" button** in the tab header → opens `TemplateFormPanel` in create mode
- **Per-template actions** (shown on hover): Edit (pencil icon) → opens `TemplateFormPanel` with `template` prop
- **Inactive templates** (`isActive = false`) hidden from the list by default
- Local `useState` inside the tab section manages `isOpen` + selected template — no lifting to parent

---

## Section 5: Trip Detail — "Save as Template"

Changes to `TripDetailPage.tsx`:

- **"Save as Template" button** in the trip header area
- Shown only when `trip.eventTemplateId` is null (not already linked to a template)
- Role-restricted: Admin / Coordinator / SuperAdmin
- Clicking opens `TemplateFormPanel` in create mode with `initialTrip` set to the current trip
- On success: toast "Template created". The trip's own `eventTemplateId` is **not** updated — creating a template from a trip is a one-way copy, not a re-link.

---

## Files Changed

| File | Change |
|------|--------|
| `backend/Odip.Api/Controllers/TasksDashboardController.cs` | Add DELETE endpoint |
| `frontend/src/api/hooks/activities.ts` | Add 3 mutation hooks |
| `frontend/src/components/TemplateFormPanel.tsx` | New component |
| `frontend/src/pages/SettingsPage.tsx` | Wire up panel, add New/Edit/Deactivate actions |
| `frontend/src/pages/TripDetailPage.tsx` | Add "Save as Template" button |
