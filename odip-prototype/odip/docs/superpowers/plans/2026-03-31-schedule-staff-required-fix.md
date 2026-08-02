# Schedule Staff Required Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schedule overview cards show the ratio-calculated staff required instead of the manually-set estimate, falling back to the estimate only when no bookings exist.

**Architecture:** Add a computed `StaffRequired` field to `ScheduleTripDto` (backend DTO + controller projection) using `CalculatedStaffRequired > 0 ? ⌈CalculatedStaffRequired⌉ : MinStaffRequired`. The frontend type and display expression are updated to consume this field.

**Tech Stack:** .NET 9 / C# (backend), React 19 / TypeScript (frontend)

---

## Files Changed

| File | Change |
|------|--------|
| `backend/Odip.Application/DTOs/DTOs.cs` | Add `StaffRequired: int?` to `ScheduleTripDto` (line ~1072) |
| `backend/Odip.Api/Controllers/ScheduleController.cs` | Compute `StaffRequired` in projection (line ~57) |
| `frontend/src/api/types/schedule.ts` | Add `staffRequired: number \| null` to `ScheduleTripDto` |
| `frontend/src/pages/SchedulePage.tsx` | Use `trip.staffRequired` in header display (line ~728) |

---

## Task 1: Add `StaffRequired` to `ScheduleTripDto` (backend DTO)

**Files:**
- Modify: `backend/Odip.Application/DTOs/DTOs.cs:1058-1075`

- [ ] **Step 1: Open the ScheduleTripDto record**

The current record (lines 1058–1075) ends with `LeadCoordinatorName`:

```csharp
public record ScheduleTripDto
{
    public Guid Id { get; init; }
    public string TripName { get; init; } = string.Empty;
    public string? TripCode { get; init; }
    public string? Destination { get; init; }
    public string? Region { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public int DurationDays { get; init; }
    public TripStatus Status { get; init; }
    public int? MaxParticipants { get; init; }
    public int CurrentParticipantCount { get; init; }
    public int? MinStaffRequired { get; init; }
    public int StaffAssignedCount { get; init; }
    public int VehicleAssignedCount { get; init; }
    public string? LeadCoordinatorName { get; init; }
}
```

- [ ] **Step 2: Add `StaffRequired` after `MinStaffRequired`**

Replace the `MinStaffRequired` line with:

```csharp
    public int? MinStaffRequired { get; init; }
    public int? StaffRequired { get; init; }
```

The full record after the edit:

```csharp
public record ScheduleTripDto
{
    public Guid Id { get; init; }
    public string TripName { get; init; } = string.Empty;
    public string? TripCode { get; init; }
    public string? Destination { get; init; }
    public string? Region { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public int DurationDays { get; init; }
    public TripStatus Status { get; init; }
    public int? MaxParticipants { get; init; }
    public int CurrentParticipantCount { get; init; }
    public int? MinStaffRequired { get; init; }
    public int? StaffRequired { get; init; }
    public int StaffAssignedCount { get; init; }
    public int VehicleAssignedCount { get; init; }
    public string? LeadCoordinatorName { get; init; }
}
```

- [ ] **Step 3: Build the backend to verify no compile errors**

```bash
cd "F:/Projects/personal/Trip Planner"
dotnet build backend/Odip.Application/Odip.Application.csproj
```

Expected: `Build succeeded.`

---

## Task 2: Populate `StaffRequired` in `ScheduleController`

**Files:**
- Modify: `backend/Odip.Api/Controllers/ScheduleController.cs:41-62`

- [ ] **Step 1: Find the projection**

The current projection (lines 41–62):

```csharp
var tripDtos = trips.Select(t => new ScheduleTripDto
{
    Id = t.Id,
    TripName = t.TripName,
    TripCode = t.TripCode,
    Destination = t.Destination,
    Region = t.Region,
    StartDate = t.StartDate,
    EndDate = t.StartDate.AddDays(t.DurationDays - 1),
    DurationDays = t.DurationDays,
    Status = t.Status,
    MaxParticipants = t.MaxParticipants,
    CurrentParticipantCount = t.Bookings.Count(b =>
        b.BookingStatus != BookingStatus.Cancelled && b.BookingStatus != BookingStatus.NoLongerAttending),
    MinStaffRequired = t.MinStaffRequired,
    StaffAssignedCount = t.StaffAssignments.Count(a => a.Status != AssignmentStatus.Cancelled),
    VehicleAssignedCount = t.VehicleAssignments.Count(a =>
        a.Status != VehicleAssignmentStatus.Cancelled && a.Status != VehicleAssignmentStatus.Unavailable),
    LeadCoordinatorName = t.LeadCoordinator != null
        ? t.LeadCoordinator.FirstName + " " + t.LeadCoordinator.LastName : null,
}).ToList();
```

- [ ] **Step 2: Add `StaffRequired` after `MinStaffRequired`**

Replace the `MinStaffRequired = t.MinStaffRequired,` line with:

```csharp
    MinStaffRequired = t.MinStaffRequired,
    StaffRequired = t.CalculatedStaffRequired > 0
        ? (int)Math.Ceiling(t.CalculatedStaffRequired)
        : t.MinStaffRequired,
```

The full updated projection:

```csharp
var tripDtos = trips.Select(t => new ScheduleTripDto
{
    Id = t.Id,
    TripName = t.TripName,
    TripCode = t.TripCode,
    Destination = t.Destination,
    Region = t.Region,
    StartDate = t.StartDate,
    EndDate = t.StartDate.AddDays(t.DurationDays - 1),
    DurationDays = t.DurationDays,
    Status = t.Status,
    MaxParticipants = t.MaxParticipants,
    CurrentParticipantCount = t.Bookings.Count(b =>
        b.BookingStatus != BookingStatus.Cancelled && b.BookingStatus != BookingStatus.NoLongerAttending),
    MinStaffRequired = t.MinStaffRequired,
    StaffRequired = t.CalculatedStaffRequired > 0
        ? (int)Math.Ceiling(t.CalculatedStaffRequired)
        : t.MinStaffRequired,
    StaffAssignedCount = t.StaffAssignments.Count(a => a.Status != AssignmentStatus.Cancelled),
    VehicleAssignedCount = t.VehicleAssignments.Count(a =>
        a.Status != VehicleAssignmentStatus.Cancelled && a.Status != VehicleAssignmentStatus.Unavailable),
    LeadCoordinatorName = t.LeadCoordinator != null
        ? t.LeadCoordinator.FirstName + " " + t.LeadCoordinator.LastName : null,
}).ToList();
```

- [ ] **Step 3: Build the full backend to verify no compile errors**

```bash
cd "F:/Projects/personal/Trip Planner"
dotnet build backend/Odip.Api/Odip.Api.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Application/DTOs/DTOs.cs backend/Odip.Api/Controllers/ScheduleController.cs
git commit -m "feat: add StaffRequired to ScheduleTripDto using ratio-calculated value"
```

---

## Task 3: Update frontend type

**Files:**
- Modify: `frontend/src/api/types/schedule.ts`

- [ ] **Step 1: Add `staffRequired` to `ScheduleTripDto`**

Current interface (relevant section):

```typescript
export interface ScheduleTripDto {
  id: string
  tripName: string
  tripCode: string | null
  destination: string | null
  region: string | null
  startDate: string
  endDate: string
  durationDays: number
  status: TripStatus
  maxParticipants: number | null
  currentParticipantCount: number
  minStaffRequired: number | null
  staffAssignedCount: number
  vehicleAssignedCount: number
  leadCoordinatorName: string | null
}
```

Add `staffRequired` after `minStaffRequired`:

```typescript
export interface ScheduleTripDto {
  id: string
  tripName: string
  tripCode: string | null
  destination: string | null
  region: string | null
  startDate: string
  endDate: string
  durationDays: number
  status: TripStatus
  maxParticipants: number | null
  currentParticipantCount: number
  minStaffRequired: number | null
  staffRequired: number | null
  staffAssignedCount: number
  vehicleAssignedCount: number
  leadCoordinatorName: string | null
}
```

---

## Task 4: Update schedule card display

**Files:**
- Modify: `frontend/src/pages/SchedulePage.tsx:~728`

- [ ] **Step 1: Find the staff display expression**

Current line (~728):

```tsx
{trip.staffAssignedCount}/{trip.minStaffRequired ?? '?'} staff · {trip.currentParticipantCount}/{trip.maxParticipants ?? '?'} pax
```

- [ ] **Step 2: Replace `minStaffRequired` with `staffRequired`**

```tsx
{trip.staffAssignedCount}/{trip.staffRequired ?? '?'} staff · {trip.currentParticipantCount}/{trip.maxParticipants ?? '?'} pax
```

- [ ] **Step 3: Build the frontend**

```bash
cd "F:/Projects/personal/Trip Planner/frontend"
npm run build
```

Expected: `✓ built in ...` with no TypeScript errors.

- [ ] **Step 4: Lint**

```bash
cd "F:/Projects/personal/Trip Planner/frontend"
npm run lint
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types/schedule.ts frontend/src/pages/SchedulePage.tsx
git commit -m "feat: display ratio-calculated staff required in schedule overview card"
```

---

## Task 5: Manual verification

- [ ] **Step 1: Start the app**

```bash
cd "F:/Projects/personal/Trip Planner"
docker-compose up --build
```

Or run backend + frontend separately:

```bash
# Backend (terminal 1)
dotnet run --project backend/Odip.Api

# Frontend (terminal 2)
cd frontend && npm run dev
```

- [ ] **Step 2: Verify trip with bookings**

Open a trip that has confirmed bookings with mixed ratios (like "Gold Coast Beach Break — Winter 2026").

- Navigate to the Schedule page
- The card header should show `staffAssignedCount / <ratio-calculated value>` (e.g. `3/5`)
- The trip detail page → Bookings tab → "Staff Required" bottom-left should show the same ceiling value

- [ ] **Step 3: Verify trip with no bookings**

Open a trip that has no confirmed bookings.

- Schedule card should show `staffAssignedCount / <minStaffRequired estimate>` (falls back to the initial estimate)

- [ ] **Step 4: Verify trip with `CalculatedStaffRequired = 0` and no `MinStaffRequired`**

If a trip has no bookings and no initial estimate set, the card should show `? ` in the required slot — this is the existing `?? '?'` fallback and requires no change.
