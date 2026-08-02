---
tags: [project/trip-planner, feature/audit-trail, tech/efcore, tech/react]
date: 2026-03-27
project: Odip
---

# Audit Trail — Design Spec

## Overview

Add a full audit trail (change history) to Odip covering the 7 highest-regulatory-risk entities. Audit entries are captured automatically via an EF Core `ISaveChangesInterceptor` and surfaced to Admin users via a "History" tab on each entity detail page.

**Primary drivers:** NDIS compliance (prove who changed what and when) + operational visibility (coordinators understanding how a record reached its current state).

---

## Scope

### Audited Entities
1. `TripInstance`
2. `Participant`
3. `ParticipantBooking`
4. `IncidentReport`
5. `Staff`
6. `StaffAssignment`
7. `VehicleAssignment`

All other entities (TripDay, ScheduledActivity, StaffAvailability, BookingTask, etc.) are excluded to keep log volume manageable.

### Out of Scope
- Global audit log page (admin dashboard) — future enhancement
- Audit of AppSettings, EventTemplates, Activities, AccommodationProperties, Vehicles (low regulatory risk)
- Audit retention policy / purge — future enhancement
- Export to CSV / PDF — future enhancement

---

## Data Model

### `AuditLog` Table

| Column | Type | Notes |
|--------|------|-------|
| `Id` | `Guid` | PK |
| `EntityType` | `string(100)` | e.g. `"TripInstance"`, `"IncidentReport"` |
| `EntityId` | `Guid` | PK of the audited record |
| `Action` | `enum` | `Created \| Updated \| Deleted` |
| `ChangedAt` | `DateTimeOffset` | UTC timestamp of the save |
| `ChangedById` | `Guid?` | FK to `Users.Id` (nullable — system/migration events) |
| `ChangedByName` | `string?` | Denormalised display name — survives user deletion |
| `Changes` | `text` (jsonb) | JSON array of field diffs (see below) |

### `Changes` JSON Schema
```json
[
  { "field": "Status", "old": "Draft", "new": "Confirmed" },
  { "field": "LeadCoordinatorId", "old": null, "new": "3fa85f64-..." }
]
```

- **Created action:** all non-null fields recorded as `{ old: null, new: value }`
- **Updated action:** only fields whose value actually changed; skips `CreatedAt`, `UpdatedAt`
- **Deleted action:** all fields recorded as `{ old: value, new: null }` (full snapshot before deletion)

---

## Backend

### New Files

```
backend/Odip.Domain/Entities/AuditLog.cs
backend/Odip.Domain/Enums/AuditAction.cs
backend/Odip.Infrastructure/Audit/AuditInterceptor.cs
backend/Odip.Infrastructure/Audit/AuditedEntities.cs
backend/Odip.Api/Controllers/AuditController.cs
```

### Modified Files

```
backend/Odip.Infrastructure/Data/OdipDbContext.cs   — add DbSet<AuditLog>, register interceptor
backend/Odip.Api/Program.cs                             — register IHttpContextAccessor, interceptor DI
backend/Odip.Infrastructure/Migrations/                 — new migration: AddAuditLog
```

### `AuditInterceptor` Logic

Implements `ISaveChangesInterceptor`. Registered as a singleton and injected via `AddDbContext` options.

**Before save (`SavingChangesAsync`):**
1. Reads `IHttpContextAccessor.HttpContext?.User` to extract:
   - `ChangedById` — from `NameIdentifier` claim (Guid)
   - `ChangedByName` — from `Name` or `Email` claim
2. Iterates `ChangeTracker.Entries()` filtered to the 7 audited entity types
3. Per entry:
   - `EntityState.Added` → records all non-null property values as `{ old: null, new: value }`
   - `EntityState.Modified` → compares `OriginalValues` vs `CurrentValues`, records only changed fields; skips `CreatedAt`, `UpdatedAt`
   - `EntityState.Deleted` → records all property values as `{ old: value, new: null }`
4. Constructs `AuditLog` rows and adds them to the same DbContext (they are saved in the same transaction)

**Null/background guard:** If `HttpContext` is null (e.g. startup migration), `ChangedById` and `ChangedByName` are stored as null — no exception thrown.

### `AuditedEntities` — Static Configuration

```csharp
public static class AuditedEntities
{
    public static readonly HashSet<Type> Types = new()
    {
        typeof(TripInstance),
        typeof(Participant),
        typeof(ParticipantBooking),
        typeof(IncidentReport),
        typeof(Staff),
        typeof(StaffAssignment),
        typeof(VehicleAssignment),
    };
}
```

### API Endpoint

```
GET /api/audit/{entityType}/{entityId}?page=1&pageSize=50
```

- **Auth:** `[Authorize(Roles = "Admin")]`
- **Returns:**
```json
{
  "entries": [
    {
      "id": "guid",
      "action": "Updated",
      "changedAt": "2026-03-27T10:30:00Z",
      "changedByName": "Jane Smith",
      "changes": [
        { "field": "Status", "old": "Draft", "new": "Confirmed" }
      ]
    }
  ],
  "total": 12
}
```
- **Ordered:** newest first (`ChangedAt DESC`)
- **No write endpoints** — the audit log is append-only and immutable via API

---

## Frontend

### New Files

```
frontend/src/api/audit.ts                    — useAuditHistory(entityType, entityId) hook
frontend/src/components/AuditHistoryTab.tsx  — shared history tab component
```

### Modified Files (add History tab)

| Page | Entity Type String |
|------|-------------------|
| `TripDetailPage` | `"TripInstance"` |
| `ParticipantDetailPage` | `"Participant"` |
| Bookings tab (per booking row) | `"ParticipantBooking"` |
| `IncidentDetailPage` | `"IncidentReport"` |
| `StaffDetailPage` | `"Staff"` |

### `AuditHistoryTab` Component

- Calls `useAuditHistory(entityType, entityId)` — TanStack Query `GET /api/audit/{entityType}/{entityId}`
- **Role gate:** only rendered when `userRole === "Admin"` — uses existing JWT role check pattern
- **Timeline layout per entry:**
  - Date/time — relative (e.g. "3 hours ago") with absolute on hover tooltip
  - Actor chip — "Jane Smith" or "System" if null
  - Action badge — `Created` (green) / `Updated` (blue) / `Deleted` (red)
  - Collapsible field diff list: `Status: "Draft" → "Confirmed"`
- **Empty state:** "No history recorded yet"
- **Loading/error states:** skeleton + error message inline

### API Hook

```typescript
// api/audit.ts
export function useAuditHistory(entityType: string, entityId: string) {
  return useQuery({
    queryKey: ['audit', entityType, entityId],
    queryFn: () => api.get(`/audit/${entityType}/${entityId}`).then(r => r.data),
    enabled: !!entityId,
  });
}
```

---

## Migration

Single new migration: `AddAuditLog`

- Creates `AuditLogs` table with all columns above
- `ChangedById` has no FK constraint (Users table uses soft delete; we don't want cascade delete of audit records)
- `Changes` stored as `text` column (PostgreSQL will handle jsonb queries if needed later via raw SQL)
- Index on `(EntityType, EntityId, ChangedAt DESC)` for the primary query pattern

---

## Testing

- **Interceptor unit test:** mock DbContext change tracker with Modified entry → assert correct `AuditLog` row constructed
- **Integration test:** POST a trip status change → GET `/api/audit/TripInstance/{id}` → assert one Updated entry with correct field diff
- **Role test:** non-Admin GET `/api/audit/...` → 403
- **Frontend:** History tab hidden for non-Admin role; visible with correct entries for Admin
