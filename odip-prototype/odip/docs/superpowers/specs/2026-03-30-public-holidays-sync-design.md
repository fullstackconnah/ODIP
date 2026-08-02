---
tags: [project/trip-planner, feature/public-holidays, tech/dotnet, tech/react]
date: 2026-03-30
project: Odip
---

# Public Holidays Auto-Sync — Design Spec

## Overview

Replace the existing hardcoded holiday seed data with an automated sync from the Nager.Date NuGet package. The sync runs on a yearly schedule and is also triggerable manually from the admin settings page. All Australian states are covered, with national holidays stored as state-less records.

---

## 1. Architecture

```
Nager.Date NuGet package
        │
        ▼
IPublicHolidaySyncService      ← core sync logic (Application layer)
        │
        ├── called by ──▶  HolidaySyncBackgroundService   (yearly timer, Infrastructure)
        │
        └── called by ──▶  POST /api/v1/public-holidays/sync  (manual trigger, API)
```

### Components

| Component | Layer | Responsibility |
|---|---|---|
| `IPublicHolidaySyncService` | Application | Fetch holidays for a year range, upsert into DB, return summary |
| `PublicHolidaySyncService` | Infrastructure | Implements interface, uses Nager.Date + EF Core |
| `HolidaySyncBackgroundService` | Infrastructure | BackgroundService, yearly timer, startup catch-up |
| `PublicHolidaysController` | API | Existing controller — gains `/sync` endpoint |
| Settings page (frontend) | Frontend | New card with schedule config + manual sync button |


---

## 2. Data Layer

### PublicHoliday entity (no changes)

Existing schema is sufficient:
- `Id` (Guid)
- `Date` (DateOnly)
- `Name` (string)
- `State` (string?, nullable — null = national holiday)
- Composite index on `(Date, State)` already in place

### Nager.Date → DB mapping

| Nager.Date field | Maps to |
|---|---|
| `Date` | `PublicHoliday.Date` |
| `LocalName` | `PublicHoliday.Name` |
| `Counties` = null/empty | `State = null` (national) |
| `Counties` = `["AU-VIC"]` | `State = "VIC"` (strip `AU-` prefix) |
| `Counties` = `["AU-VIC", "AU-NSW"]` | Two rows, one per state |

**Upsert key:** `(Date, State)` — insert if missing, update `Name` if changed.

### AppSettings — 3 new columns (EF migration required)

| Column | Type | Default | Purpose |
|---|---|---|---|
| `HolidaySyncFromYear` | `int` | `2025` | Catch-up start year on first run |
| `HolidaySyncScheduleMonth` | `int` | `11` (Nov) | Month the yearly job fires |
| `HolidaySyncScheduleDay` | `int` | `1` | Day of month |


---

## 3. Service Layer

### IPublicHolidaySyncService

```csharp
Task<SyncResult> SyncAsync(int fromYear, int toYear, CancellationToken ct = default);

record SyncResult(int YearsProcessed, int HolidaysAdded, int HolidaysUpdated, string[] Errors);
```

**Logic:**
1. Loop `fromYear..toYear`
2. Call `Nager.Date` for AU holidays per year (local computation — no HTTP)
3. Map to `PublicHoliday` records (one per state per holiday)
4. Bulk upsert via EF Core — match on `(Date, State)`
5. Return `SyncResult`

### HolidaySyncBackgroundService

**On startup:**
1. Load `AppSettings` → `HolidaySyncFromYear`
2. Check for missing years from `fromYear` to `nextYear`
3. If gaps found → call `SyncAsync` to catch up

**Yearly schedule loop:**
1. Compute next fire date from `HolidaySyncScheduleMonth` + `HolidaySyncScheduleDay`
2. `await Task.Delay(timeUntilNextRun, cancellationToken)`
3. Call `SyncAsync(currentYear, nextYear)`
4. Recalculate and loop

Respects `CancellationToken` for clean shutdown.

### POST /api/v1/public-holidays/sync

```
Auth:     Admin / SuperAdmin
Request:  { fromYear?: int, toYear?: int }   // defaults: current year, next year
Response: SyncResult { yearsProcessed, holidaysAdded, holidaysUpdated, errors[] }
```


---

## 4. Frontend — Settings Page

### New "Public Holidays" card on admin settings page

**Sync Schedule section** (saves via existing settings PATCH):
- Sync from year (number input, default 2025)
- Schedule month (dropdown Jan–Dec, default November)
- Schedule day (number input 1–28, default 1)

**Manual Sync section:**
- "Sync Now" button → `POST /api/v1/public-holidays/sync`
- Advanced toggle: exposes `fromYear` / `toYear` inputs
- Success: toast — `"Sync complete: 87 holidays added, 0 updated"`
- Error: toast with error message

**TanStack Query:**
- `useSyncHolidays` mutation — POST to sync endpoint
- Invalidates `usePublicHolidays` query on success

---

## 5. Error Handling

| Scenario | Behaviour |
|---|---|
| Nager.Date fails for a year | Log warning, continue other years, include in `SyncResult.Errors` |
| DB upsert fails | Log error, surface in response |
| Background service crashes | ASP.NET Core logs exception; catches up on next app start |
| Manual sync + auto-sync concurrent | Safe — upsert is idempotent |
| `AppSettings` row missing | Fall back to hardcoded defaults (2025, month 11, day 1) |


---

## 6. Files to Create / Modify

### Backend
| Action | File |
|---|---|
| Create | `Odip.Application/Interfaces/IPublicHolidaySyncService.cs` |
| Create | `Odip.Application/Models/SyncResult.cs` |
| Create | `Odip.Infrastructure/Services/PublicHolidaySyncService.cs` |
| Create | `Odip.Infrastructure/BackgroundServices/HolidaySyncBackgroundService.cs` |
| Modify | `Odip.Api/Controllers/PublicHolidaysController.cs` — add `/sync` endpoint |
| Modify | `Odip.Domain/Entities/AppSettings.cs` — add 3 new fields |
| Modify | `Odip.Api/Program.cs` — register services |
| Create | EF migration for AppSettings columns |
| Modify | `Odip.Infrastructure/Data/DbSeeder.cs` — remove hardcoded holiday seed |

### Frontend
| Action | File |
|---|---|
| Create | `frontend/src/api/holidays.ts` — `useSyncHolidays` mutation |
| Modify | Settings page component — add Public Holidays card |

---

## 7. Dependencies

- **Nager.Date** NuGet package — add to `Odip.Infrastructure.csproj`
- No new frontend packages required
