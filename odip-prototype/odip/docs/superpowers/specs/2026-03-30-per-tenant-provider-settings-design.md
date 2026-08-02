---
tags: [project/trip-planner, feature/multi-tenancy, feature/provider-settings]
date: 2026-03-30
project: Odip
---

# Per-Tenant Provider Settings

## Problem

`ProviderSettings` is currently a global singleton — one record shared across all tenants. This means every tenant shares the same ABN, registration number, bank account details, and invoice footer. In a multi-tenant system, each tenant needs their own provider identity.

`AppSettings` already correctly follows the per-tenant pattern; `ProviderSettings` needs to match it.

## Approach

Follow the established `ITenantEntity` pattern used by `AppSettings` and all other tenant-scoped entities. No new patterns; no new abstractions.

## Changes

### 1. Domain — `ProviderSettings` entity

**File:** `backend/Odip.Domain/Entities/ProviderSettings.cs`

- Implement `ITenantEntity`
- Add `TenantId` (`Guid`) property
- Add `Tenant?` navigation property

```csharp
public class ProviderSettings : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    // ... all existing fields unchanged
}
```

### 2. Infrastructure — DbContext

**File:** `backend/Odip.Infrastructure/Data/OdipDbContext.cs`

Add to `OnModelCreating`:
```csharp
modelBuilder.Entity<ProviderSettings>()
    .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
modelBuilder.Entity<ProviderSettings>()
    .HasIndex(e => e.TenantId);
```

`SaveChangesAsync` already auto-populates `TenantId` for all `ITenantEntity` types — no change needed.

### 3. Infrastructure — EF Migration

Generate a new migration: `MakeProviderSettingsPerTenant`

Migration steps:
1. Add `TenantId` column as nullable initially
2. Backfill: `UPDATE "ProviderSettings" SET "TenantId" = (SELECT "Id" FROM "Tenants" WHERE "Name" = 'Demo') WHERE "TenantId" IS NULL`
3. Alter column to `NOT NULL`
4. Add FK constraint to `Tenants.Id`
5. Add index on `TenantId`

Down migration drops the FK, index, and column.

### 4. API — `ProviderSettingsController`

**File:** `backend/Odip.Api/Controllers/ProviderSettingsController.cs`

No logic changes required. The DbContext query filter automatically scopes all queries to the current tenant:

- **GET** — `FirstOrDefaultAsync` returns the current tenant's row (or null if not yet configured)
- **PUT** — upsert finds only the current tenant's row; on insert, `TenantId` is auto-populated by `SaveChangesAsync`

SuperAdmin access via `X-View-As-Tenant` header works automatically (same as all other tenant-scoped entities).

### 5. Frontend

No changes required. The API contract (`ProviderSettingsDto`, `UpsertProviderSettingsDto`) is unchanged.

## Data Migration

The existing global `ProviderSettings` row is assigned to the `Demo` tenant by name lookup in the migration SQL. If no demo tenant exists at migration time, the row remains unassigned and will not appear in any tenant's view until manually assigned.

## What Does NOT Change

- DTO shapes — no breaking API changes
- Authorization rules — `Admin, Coordinator, SuperAdmin` roles unchanged
- Frontend — no changes
- `AppSettings` — untouched
- Any other entity — untouched

## Success Criteria

- Each tenant can independently configure their own registration number, ABN, bank details, and invoice footer
- Tenant A cannot read or modify Tenant B's provider settings
- SuperAdmin can view/edit any tenant's provider settings via `X-View-As-Tenant`
- Existing demo tenant data is preserved and assigned correctly
- All existing NDIS claiming workflows that read provider settings continue to work (they now read the current tenant's settings automatically)
