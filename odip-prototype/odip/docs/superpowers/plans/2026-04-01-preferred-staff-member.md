# Preferred Staff Member Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional preferred staff member to each participant, and surface a recommendation indicator on the schedule overview when that staff member's trip has the participant booked.

**Architecture:** `PreferredStaffId` nullable FK on `Participant` → EF migration → DTO + controller changes on both Participant and Schedule endpoints → frontend types + form field + detail display + schedule grid indicator.

**Tech Stack:** .NET 9 / EF Core 8, C# record DTOs, React 19, TypeScript, react-hook-form + Zod, TanStack Query

---

## File Map

| File | Change |
|------|--------|
| `backend/Odip.Domain/Entities/Participant.cs` | Add `PreferredStaffId` + `PreferredStaff` navigation |
| `backend/Odip.Infrastructure/Data/OdipDbContext.cs` | Configure optional FK relationship with `OnDelete(SetNull)` |
| `backend/Odip.Infrastructure/Migrations/` | New migration (generated) |
| `backend/Odip.Application/DTOs/DTOs.cs` | Add preference fields to Participant DTOs + `TripPreferenceDto` + schedule DTO fields |
| `backend/Odip.Api/Controllers/ParticipantsController.cs` | Include `PreferredStaff` in GetById; map fields on create/update |
| `backend/Odip.Api/Controllers/ScheduleController.cs` | Compute preference lookup; add to trip + staff DTOs |
| `frontend/src/api/types/participants.ts` | Add `preferredStaffId` + `preferredStaffName` to DTOs |
| `frontend/src/api/types/schedule.ts` | Add `preferredForTrips` + `preferenceMatchCount` |
| `frontend/src/pages/ParticipantCreatePage.tsx` | Add Zod field + select element + reset/submit handling |
| `frontend/src/pages/ParticipantDetailPage.tsx` | Show preferred staff name in Details tab |
| `frontend/src/pages/SchedulePage.tsx` | Trip header badge + staff pill star pip |

---

## Task 1: Domain entity + DbContext configuration

**Files:**
- Modify: `backend/Odip.Domain/Entities/Participant.cs`
- Modify: `backend/Odip.Infrastructure/Data/OdipDbContext.cs`

- [ ] **Step 1: Add FK and navigation property to Participant entity**

In `backend/Odip.Domain/Entities/Participant.cs`, add these two lines after the `PlanManagerContact` navigation property (after line `public Contact? PlanManagerContact { get; set; }`):

```csharp
public Guid? PreferredStaffId { get; set; }
public Staff? PreferredStaff { get; set; }
```

The full entity tail should now read:
```csharp
    public Guid? PlanManagerContactId { get; set; }
    public Contact? PlanManagerContact { get; set; }
    public Guid? PreferredStaffId { get; set; }
    public Staff? PreferredStaff { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
```

- [ ] **Step 2: Configure the relationship in OdipDbContext**

In `backend/Odip.Infrastructure/Data/OdipDbContext.cs`, inside the `modelBuilder.Entity<Participant>(entity => { ... })` block (after the existing index definitions), add:

```csharp
entity.HasOne(p => p.PreferredStaff)
    .WithMany()
    .HasForeignKey(p => p.PreferredStaffId)
    .OnDelete(DeleteBehavior.SetNull);
```

`DeleteBehavior.SetNull` means if a Staff record is deleted, `PreferredStaffId` on matching Participants becomes null rather than causing a FK violation.

- [ ] **Step 3: Generate and apply the migration**

```bash
cd "F:/Projects/personal/Trip Planner"
dotnet ef migrations add AddParticipantPreferredStaff --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
dotnet ef database update --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

Expected: migration file created in `backend/Odip.Infrastructure/Migrations/`, database updated with new nullable `preferred_staff_id` column on `Participants` table.

- [ ] **Step 4: Verify the backend builds**

```bash
dotnet build backend/Odip.Api
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add backend/Odip.Domain/Entities/Participant.cs
git add backend/Odip.Infrastructure/Data/OdipDbContext.cs
git add backend/Odip.Infrastructure/Migrations/
git commit -m "feat: add PreferredStaffId FK to Participant entity"
```

---

## Task 2: Participant DTOs

**Files:**
- Modify: `backend/Odip.Application/DTOs/DTOs.cs`

- [ ] **Step 1: Add fields to ParticipantDetailDto**

Find `public record ParticipantDetailDto : ParticipantListDto` in `DTOs.cs`. Add these two properties inside it, after `public DateTime UpdatedAt { get; init; }`:

```csharp
public Guid? PreferredStaffId { get; init; }
public string? PreferredStaffName { get; init; }
```

- [ ] **Step 2: Add field to CreateParticipantDto**

Find `public record CreateParticipantDto`. Add after `public string? Notes { get; init; }`:

```csharp
public Guid? PreferredStaffId { get; init; }
```

`UpdateParticipantDto` inherits from `CreateParticipantDto`, so it gets the field for free.

- [ ] **Step 3: Verify the build**

```bash
dotnet build backend/Odip.Api
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Application/DTOs/DTOs.cs
git commit -m "feat: add PreferredStaffId/Name to Participant DTOs"
```

---

## Task 3: ParticipantsController — include and map preferred staff

**Files:**
- Modify: `backend/Odip.Api/Controllers/ParticipantsController.cs`

- [ ] **Step 1: Include PreferredStaff in GetById**

In the `GetById` method, find:

```csharp
var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
```

Replace with:

```csharp
var p = await _db.Participants
    .Include(x => x.PreferredStaff)
    .FirstOrDefaultAsync(x => x.Id == id, ct);
```

- [ ] **Step 2: Map the new fields in the GetById projection**

In the same method, find the `new ParticipantDetailDto { ... }` object initialiser. Add these two lines at the end (before the closing `}`):

```csharp
PreferredStaffId = p.PreferredStaffId,
PreferredStaffName = p.PreferredStaff != null
    ? p.PreferredStaff.FirstName + " " + p.PreferredStaff.LastName
    : null,
```

- [ ] **Step 3: Map PreferredStaffId in Create**

Find the `Create` / `POST` endpoint. It maps `CreateParticipantDto` to a new `Participant`. Find where the entity is constructed and add:

```csharp
PreferredStaffId = dto.PreferredStaffId,
```

- [ ] **Step 4: Map PreferredStaffId in Update**

Find the `Update` / `PUT` endpoint. Locate where participant properties are updated from `dto`. Add:

```csharp
participant.PreferredStaffId = dto.PreferredStaffId;
```

- [ ] **Step 5: Verify the build**

```bash
dotnet build backend/Odip.Api
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 6: Smoke test the endpoint**

```bash
dotnet run --project backend/Odip.Api
```

Use a REST client (curl, Postman, or the Swagger UI at `http://localhost:5000/swagger`) to call `GET /api/v1/participants/{id}` for an existing participant. The response should include `"preferredStaffId": null` and `"preferredStaffName": null`.

- [ ] **Step 7: Commit**

```bash
git add backend/Odip.Api/Controllers/ParticipantsController.cs
git commit -m "feat: wire PreferredStaffId through ParticipantsController"
```

---

## Task 4: Schedule DTOs + ScheduleController preference query

**Files:**
- Modify: `backend/Odip.Application/DTOs/DTOs.cs`
- Modify: `backend/Odip.Api/Controllers/ScheduleController.cs`

- [ ] **Step 1: Add TripPreferenceDto record**

In `DTOs.cs`, in the Schedule DTOs section, add this new record (place it after `ScheduleStaffTripStatusDto`):

```csharp
public record TripPreferenceDto(Guid TripId, int ParticipantCount);
```

- [ ] **Step 2: Add PreferenceMatchCount to ScheduleTripDto**

Find `public record ScheduleTripDto`. Add after `public string? LeadCoordinatorName { get; init; }`:

```csharp
public int PreferenceMatchCount { get; init; }
```

- [ ] **Step 3: Add PreferredForTrips to ScheduleStaffDto**

Find `public record ScheduleStaffDto`. Add after `public List<StaffAvailabilityDto> Availability { get; init; } = new();`:

```csharp
public List<TripPreferenceDto> PreferredForTrips { get; init; } = new();
```

- [ ] **Step 4: Add preference query to ScheduleController**

In `backend/Odip.Api/Controllers/ScheduleController.cs`, find the comment `// ── 2. Load all active staff` (around line 74). Insert the following block BEFORE it (after the early-return for empty trips):

```csharp
// ── 1b. Compute staff preference counts ──
var tripIds = trips.Select(t => t.Id).ToList();
var preferenceRows = await (
    from b in _db.ParticipantBookings
    join p in _db.Participants on b.ParticipantId equals p.Id
    where tripIds.Contains(b.TripInstanceId)
       && (b.BookingStatus == BookingStatus.Confirmed
           || b.BookingStatus == BookingStatus.Held)
       && p.PreferredStaffId != null
    select new { b.TripInstanceId, StaffId = p.PreferredStaffId!.Value }
).ToListAsync(ct);

// prefsByStaff[staffId][tripId] = count
var prefsByStaff = preferenceRows
    .GroupBy(p => p.StaffId!.Value)
    .ToDictionary(
        g => g.Key,
        g => g.GroupBy(x => x.TripInstanceId)
              .ToDictionary(t => t.Key, t => t.Count())
    );

// prefsByTrip[tripId] = total preference matches
var prefsByTrip = preferenceRows
    .GroupBy(p => p.TripInstanceId)
    .ToDictionary(g => g.Key, g => g.Count());
```

- [ ] **Step 5: Use prefsByTrip in tripDtos**

Find the `var tripDtos = trips.Select(t => new ScheduleTripDto` block. Add `PreferenceMatchCount` to the object initialiser, after `LeadCoordinatorName`:

```csharp
PreferenceMatchCount = prefsByTrip.GetValueOrDefault(t.Id, 0),
```

- [ ] **Step 6: Use prefsByStaff in staffDtos**

Find the `return new ScheduleStaffDto` block (inside `var staffDtos = allStaff.Select(s => {`). Add `PreferredForTrips` to the object initialiser, after `Availability = ...`:

```csharp
PreferredForTrips = prefsByStaff.TryGetValue(s.Id, out var staffPrefs)
    ? staffPrefs.Select(kv => new TripPreferenceDto(kv.Key, kv.Value)).ToList()
    : new List<TripPreferenceDto>(),
```

- [ ] **Step 7: Verify the build**

```bash
dotnet build backend/Odip.Api
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 8: Smoke test the schedule endpoint**

With the API running, call `GET /api/v1/schedule`. Each staff object should now include `"preferredForTrips": []`, and each trip object should include `"preferenceMatchCount": 0`.

- [ ] **Step 9: Commit**

```bash
git add backend/Odip.Application/DTOs/DTOs.cs
git add backend/Odip.Api/Controllers/ScheduleController.cs
git commit -m "feat: add preference counts to schedule overview response"
```

---

## Task 5: Frontend TypeScript types

**Files:**
- Modify: `frontend/src/api/types/participants.ts`
- Modify: `frontend/src/api/types/schedule.ts`

- [ ] **Step 1: Add fields to participant types**

In `frontend/src/api/types/participants.ts`:

Add to `ParticipantDetailDto` (after `updatedAt: string`):
```typescript
  preferredStaffId: string | null
  preferredStaffName: string | null
```

Add to `CreateParticipantDto` (after `notes?: string`):
```typescript
  preferredStaffId?: string | null
```

`UpdateParticipantDto` extends `CreateParticipantDto` so it inherits the field automatically.

- [ ] **Step 2: Add interface for preference entry**

In `frontend/src/api/types/schedule.ts`, add before `ScheduleStaffDto`:

```typescript
export interface TripPreferenceDto {
  tripId: string
  participantCount: number
}
```

- [ ] **Step 3: Add fields to schedule types**

In `frontend/src/api/types/schedule.ts`:

Add to `ScheduleTripDto` (after `leadCoordinatorName: string | null`):
```typescript
  preferenceMatchCount: number
```

Add to `ScheduleStaffDto` (after `availability: StaffAvailabilityDto[]`):
```typescript
  preferredForTrips: TripPreferenceDto[]
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "F:/Projects/personal/Trip Planner/frontend"
npm run build 2>&1 | head -30
```

Expected: No type errors in the changed files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types/participants.ts frontend/src/api/types/schedule.ts
git commit -m "feat: add preferred staff and schedule preference types"
```

---

## Task 6: Participant form — preferred staff field

**Files:**
- Modify: `frontend/src/pages/ParticipantCreatePage.tsx`

- [ ] **Step 1: Import useStaff hook**

At the top of `ParticipantCreatePage.tsx`, the existing import is:
```typescript
import { useCreateParticipant, useUpdateParticipant, useParticipant } from '@/api/hooks'
```

Replace with:
```typescript
import { useCreateParticipant, useUpdateParticipant, useParticipant, useStaff } from '@/api/hooks'
```

- [ ] **Step 2: Add preferredStaffId to Zod schema**

In the `participantSchema` object (top of the file), add after `notes: z.string().optional(),`:

```typescript
  preferredStaffId: z.string().optional().nullable(),
```

- [ ] **Step 3: Add staff query inside the component**

Inside `ParticipantCreatePage()`, after the existing hook calls (after `const mutation = ...`), add:

```typescript
const { data: staffList = [] } = useStaff()
const activeStaff = staffList.filter((s: any) => s.isActive)
```

- [ ] **Step 4: Add preferredStaffId to defaultValues**

In `useForm<ParticipantFormData>({ defaultValues: { ... } })`, add:

```typescript
    preferredStaffId: null,
```

- [ ] **Step 5: Add preferredStaffId to the reset call for edit mode**

In the `useEffect` that calls `reset({ ... })`, add after `notes: existing.notes ?? '',`:

```typescript
        preferredStaffId: existing.preferredStaffId ?? null,
```

- [ ] **Step 6: Add the new "Staff Preferences" section to the form**

In the JSX, find the closing `</div>` of the "Notes & Requirements" section (just before the `{/* Submit */}` comment). After it, add:

```tsx
        {/* Staff Preferences */}
        <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 space-y-4">
          <h3 className="font-semibold">Staff Preferences</h3>
          <div>
            <label className={labelClass}>Preferred Staff Member</label>
            <select {...register('preferredStaffId')} className={inputClass}>
              <option value="">None</option>
              {activeStaff.map((s: any) => (
                <option key={s.id} value={s.id}>{s.fullName}</option>
              ))}
            </select>
          </div>
        </div>
```

- [ ] **Step 7: Verify TypeScript compiles and the form renders**

```bash
cd "F:/Projects/personal/Trip Planner/frontend"
npm run build 2>&1 | head -30
```

Start the dev server and navigate to `/participants/new` — the "Staff Preferences" section should appear at the bottom of the form with a staff dropdown.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/ParticipantCreatePage.tsx
git commit -m "feat: add preferred staff member field to participant form"
```

---

## Task 7: Participant detail page — show preferred staff name

**Files:**
- Modify: `frontend/src/pages/ParticipantDetailPage.tsx`

- [ ] **Step 1: Add preferred staff row to Personal Information card**

In `ParticipantDetailPage.tsx`, find the Personal Information card grid. It currently ends with:

```tsx
              <span className="text-[var(--color-muted-foreground)]">Repeat Client</span><span>{p.isRepeatClient ? 'Yes' : 'No'}</span>
```

Add directly after it:

```tsx
              <span className="text-[var(--color-muted-foreground)]">Preferred Staff</span>
              <span>{p.preferredStaffName ?? '—'}</span>
```

- [ ] **Step 2: Verify the page renders**

Navigate to an existing participant's detail page. The Personal Information card should show "Preferred Staff — —" (dash when no preference set).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ParticipantDetailPage.tsx
git commit -m "feat: display preferred staff on participant detail page"
```

---

## Task 8: Schedule page — trip badge and staff pill star

**Files:**
- Modify: `frontend/src/pages/SchedulePage.tsx`

- [ ] **Step 1: Add preference badge to trip column headers**

In `SchedulePage.tsx`, find the trip column header block (around line 716). It renders `<th>` elements for each trip. The current content ends with:

```tsx
                        <div className="text-[10px] text-[var(--color-muted-foreground)]">
                          {trip.staffAssignedCount}/{trip.staffRequired ?? '?'} staff · {trip.currentParticipantCount}/{trip.maxParticipants ?? '?'} pax
                        </div>
```

After that `</div>`, add:

```tsx
                        {trip.preferenceMatchCount > 0 && (
                          <div className="text-[10px] font-medium" style={{ color: '#f59e0b' }}>
                            ★ {trip.preferenceMatchCount} preferred
                          </div>
                        )}
```

- [ ] **Step 2: Add star pip to staff assignment pills**

In `SchedulePage.tsx`, find the staff pill rendering section. Currently it's:

```tsx
                      {s.tripStatuses?.map((ts: any, idx: number) => {
                        const trip = trips[idx]
                        const isAvailable = ts.status === 'Available'
                        return (
                          <td key={ts.tripId} className="px-3 py-2.5">
                            <StatusBadge
                              status={ts.status}
                              role={ts.assignmentRole}
                              clickable={isAvailable}
                              onClick={isAvailable ? () => setAssignModal({ type: 'staff', resource: s, trip }) : undefined}
                              onUnassign={ts.status === 'Assigned' && ts.assignmentId ? () => staffUnassign.mutate(ts.assignmentId, {
                                onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule-overview'] })
                              }) : undefined}
                            />
                          </td>
                        )
                      })}
```

Replace with:

```tsx
                      {s.tripStatuses?.map((ts: any, idx: number) => {
                        const trip = trips[idx]
                        const isAvailable = ts.status === 'Available'
                        const prefEntry = s.preferredForTrips?.find((p: any) => p.tripId === ts.tripId)
                        return (
                          <td key={ts.tripId} className="px-3 py-2.5">
                            <div className="relative inline-block">
                              <StatusBadge
                                status={ts.status}
                                role={ts.assignmentRole}
                                clickable={isAvailable}
                                onClick={isAvailable ? () => setAssignModal({ type: 'staff', resource: s, trip }) : undefined}
                                onUnassign={ts.status === 'Assigned' && ts.assignmentId ? () => staffUnassign.mutate(ts.assignmentId, {
                                  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule-overview'] })
                                }) : undefined}
                              />
                              {prefEntry && (
                                <span
                                  className="absolute -top-1.5 -right-1.5 text-[9px] font-bold leading-none px-1 py-0.5 rounded-full"
                                  style={{ background: '#f59e0b', color: '#000' }}
                                  title={`${prefEntry.participantCount} participant${prefEntry.participantCount > 1 ? 's' : ''} prefer this staff member`}
                                >
                                  ★{prefEntry.participantCount > 1 ? ` ${prefEntry.participantCount}` : ''}
                                </span>
                              )}
                            </div>
                          </td>
                        )
                      })}
```

- [ ] **Step 3: Build and verify**

```bash
cd "F:/Projects/personal/Trip Planner/frontend"
npm run build 2>&1 | head -30
```

Expected: No TypeScript errors.

- [ ] **Step 4: End-to-end test**

1. Start the full stack: `docker-compose up` or run backend + frontend separately.
2. Edit a participant — set a preferred staff member and save.
3. Open that participant's detail page — confirm "Preferred Staff: [Name]" shows in Personal Information.
4. Navigate to the Schedule page — find a trip the participant is booked on.
5. Confirm: the trip column header shows "★ 1 preferred".
6. Find the preferred staff member's row — their pill for that trip should show a small amber ★ superscript.
7. Edit the participant again — set preferred staff back to "None" and save. Confirm all indicators disappear from the schedule.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SchedulePage.tsx
git commit -m "feat: show preferred staff indicators on schedule overview"
```

---

## Done

All 8 tasks complete. Participants now have an optional preferred staff member; the schedule overview surfaces amber ★ indicators at both the trip level (count badge) and individual staff pill level (superscript pip).
