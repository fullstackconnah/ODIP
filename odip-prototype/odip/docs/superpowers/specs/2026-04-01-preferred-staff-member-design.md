# Preferred Staff Member — Design Spec

**Date:** 2026-04-01  
**Status:** Approved

---

## Summary

Participants can optionally nominate a preferred staff member. When that participant is booked on a trip, the schedule overview surfaces a recommendation indicator on the preferred staff member's row — always visible regardless of whether they've been assigned yet, acting as a scheduling nudge.

---

## Data Model

### `Participant` entity — new fields

```csharp
public Guid? PreferredStaffId { get; set; }
public Staff? PreferredStaff { get; set; }   // null unless .Include()'d
```

- One nullable FK to `Staff` — one global preference per participant (not per-booking)
- Navigation property required for EF Core `.Include()` lambda syntax
- Follows existing project convention (`LeadCoordinatorId` / `LeadCoordinator` on `TripInstance`)

### Migration

Add `preferred_staff_id` column (nullable Guid FK → `Staff.Id`) to the `Participants` table. No backfill needed — nullable by design.

---

## DTOs

### `ParticipantDetailDto` — add:
```csharp
public Guid? PreferredStaffId { get; set; }
public string? PreferredStaffName { get; set; }  // read-only, populated from Include
```

### `CreateParticipantDto` / `UpdateParticipantDto` — add:
```csharp
public Guid? PreferredStaffId { get; set; }
```

### `ScheduleStaffDto` — add:
```csharp
public List<TripPreferenceDto> PreferredForTrips { get; set; } = [];
```

Where `TripPreferenceDto`:
```csharp
public record TripPreferenceDto(Guid TripId, int ParticipantCount);
```

Lists every trip in the current schedule window where ≥1 confirmed booked participant has `PreferredStaffId` matching this staff member.

### `ScheduleTripDto` — add:
```csharp
public int PreferenceMatchCount { get; set; }
```

Total number of participant–staff preference matches across all staff on this trip. Used for the trip card badge.

---

## Backend Changes

### `Participant.cs` (Odip.Domain)
- Add `PreferredStaffId` and `PreferredStaff` as above.

### `OdipDbContext.cs` (Odip.Infrastructure)
- Configure the optional FK relationship:
  ```csharp
  modelBuilder.Entity<Participant>()
      .HasOne(p => p.PreferredStaff)
      .WithMany()
      .HasForeignKey(p => p.PreferredStaffId)
      .OnDelete(DeleteBehavior.SetNull);
  ```
- `OnDelete(SetNull)` — if a staff member is deleted, the preference is cleared rather than blocking deletion.

### EF Core migration
- `dotnet ef migrations add AddParticipantPreferredStaff`

### `ParticipantsController.cs` (Odip.Api)
- Add `.Include(p => p.PreferredStaff)` to the queries used for `GetById` and `GetAll` (detail responses).
- Map `PreferredStaffName = participant.PreferredStaff?.FullName` in the DTO projection.
- Accept `preferredStaffId` in Create and Update endpoints.

### `ScheduleController.cs` (Odip.Api)
When building the schedule response, after fetching trips and staff:

1. Query all `ParticipantBookings` in the date window where the participant has a non-null `PreferredStaffId` and booking status is `Confirmed` (or `Held`).
2. Group by `(PreferredStaffId, TripInstanceId)` → count.
3. For each `ScheduleStaffDto`, populate `PreferredForTrips` from this group.
4. For each `ScheduleTripDto`, sum all matching counts → `PreferenceMatchCount`.

---

## Frontend Changes

### Types — `api/types/participants.ts`
- Add `preferredStaffId: string | null` and `preferredStaffName: string | null` to `ParticipantDetailDto`.
- Add `preferredStaffId?: string | null` to `CreateParticipantDto` and `UpdateParticipantDto`.

### Types — `api/types/schedule.ts`
- Add `preferredForTrips: { tripId: string; participantCount: number }[]` to `ScheduleStaffDto`.
- Add `preferenceMatchCount: number` to `ScheduleTripDto`.

### `ParticipantCreatePage.tsx` (and edit form)
Add a new **"Staff Preferences"** section at the bottom of the form (after Support Needs, before Notes):

```tsx
<section>
  <h3>Staff Preferences</h3>
  <FormField
    label="Preferred Staff Member"
    hint="Optional — a staff member this participant works best with"
  >
    <Dropdown
      variant="form"
      items={staffOptions}          // useStaff() hook, active staff only
      value={preferredStaffId}
      onChange={setPreferredStaffId}
      searchable
      placeholder="None"
    />
  </FormField>
</section>
```

- Uses existing `useStaff()` hook (already available).
- Dropdown items show `staff.fullName`, value is `staff.id`.
- Include a "None / clear" option (value: `null`).

### `ParticipantDetailPage.tsx`
Show preferred staff name in the participant's info panel as a read-only field. No special UI needed — plain label + value, consistent with other info fields.

### `SchedulePage.tsx`

**Trip card badge** — when `trip.preferenceMatchCount > 0`, render:
```tsx
<span className="preference-badge">★ {trip.preferenceMatchCount} matched</span>
```
Amber colour (`#f59e0b`), styled like the existing `AssignmentStatus` pills.

**Staff assignment pill** — when rendering a staff member's pill for a trip, check if `staff.preferredForTrips` contains an entry for that `tripId`. If yes, add a small amber star superscript `★` on the pill (absolute-positioned, top-right corner). No change to pill colour — the star is the only addition.

The indicator appears **regardless of assignment status** — Available, Assigned, Conflict, etc. The goal is to inform the scheduler before they assign, not to confirm after.

---

## Behaviour Details

| Scenario | Behaviour |
|----------|-----------|
| Participant has no preference | No indicators shown anywhere |
| Preferred staff not in schedule window (unavailable, no record) | Star still shows on pill if staff row is visible; trip badge counts them |
| Multiple participants prefer same staff on same trip | Count shows (e.g., "★ 2") |
| Preferred staff member deleted | `OnDelete(SetNull)` clears the FK; no indicator shown |
| Booking status is Cancelled / Waitlist | Not counted toward preference indicators (Confirmed + Held only) |

---

## Out of Scope

- Per-booking overrides of the preference
- "Staff to avoid" flags
- Notification / alert when preferred staff is unavailable for a booked trip
- Mobile app support

---

## Files to Change

| File | Change |
|------|--------|
| `Odip.Domain/Entities/Participant.cs` | Add FK + navigation property |
| `Odip.Infrastructure/Data/OdipDbContext.cs` | Configure relationship + OnDelete |
| `Odip.Infrastructure/Migrations/` | New migration |
| `Odip.Application/DTOs/ParticipantDtos.cs` | Add preference fields |
| `Odip.Application/DTOs/ScheduleDtos.cs` | Add preference fields to schedule DTOs |
| `Odip.Api/Controllers/ParticipantsController.cs` | Include + map preference |
| `Odip.Api/Controllers/ScheduleController.cs` | Compute preference counts in schedule query |
| `frontend/src/api/types/participants.ts` | Add TS types |
| `frontend/src/api/types/schedule.ts` | Add TS types |
| `frontend/src/pages/ParticipantCreatePage.tsx` | Add preferred staff dropdown section |
| `frontend/src/pages/ParticipantDetailPage.tsx` | Show preferred staff name |
| `frontend/src/pages/SchedulePage.tsx` | Trip badge + pill star indicator |
