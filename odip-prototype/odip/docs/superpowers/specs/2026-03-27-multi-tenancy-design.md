---
tags: [project/trip-planner, feature/multi-tenancy, tech/efcore, tech/dotnet]
date: 2026-03-27
project: Odip
---

# Multi-Tenancy Design

## Overview

Add SaaS-style multi-tenancy to Odip so that separate NDIS service provider organisations each have completely isolated data (staff, participants, trips, vehicles, accommodation, etc.) within a single shared database.

**Approach:** Shared database, shared schema — `TenantId` column on root aggregate tables, enforced by EF Core Global Query Filters. Tenant is resolved at login via email domain and embedded in the JWT.

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tenant model | Separate organisations (SaaS) | Each NDIS provider is a fully isolated tenant |
| Isolation level | Strict — no cross-tenant data visible | Users only see their own org's data; SuperAdmins see all |
| Database strategy | Shared DB, shared schema + TenantId | Simplest to operate; EF filters make missed-filter risk low |
| Tenant identification | Email domain at login | Zero extra input from users; deterministic |
| Filter enforcement | EF Core Global Query Filters | Single enforcement point in DbContext; `IgnoreQueryFilters()` for admin bypass |

---

## Data Model

### New Entity: Tenant

```csharp
// Odip.Domain/Entities/Tenant.cs
public class Tenant
{
    public Guid Id { get; set; }
    public string Name { get; set; }         // e.g. "Ability Options"
    public string EmailDomain { get; set; }  // e.g. "abilityoptions.com.au" — unique index
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }

    public ICollection<User> Users { get; set; }
}
```

### Root Entities — Add TenantId FK

The following entities gain a `Guid TenantId` property and FK to `Tenants`:

| Entity | Notes |
|--------|-------|
| `User` | Users belong to one tenant |
| `Participant` | NDIS clients are per-tenant |
| `Staff` | Staff records are per-tenant |
| `Vehicle` | Fleet is per-tenant |
| `AccommodationProperty` | Properties are per-tenant |
| `EventTemplate` | Trip templates are per-tenant |
| `TripInstance` | Trips are per-tenant |
| `AppSettings` | Becomes per-tenant (see below) |

### Child Entities — No Change

These entities are filtered transitively through their parent relationships and require no `TenantId`:

`ParticipantBooking`, `BookingTask`, `TripDocument`, `IncidentReport`, `StaffAssignment`, `VehicleAssignment`, `AccommodationReservation`, `TripDay`, `ScheduledActivity`, `Activity`, `StaffAvailability`, `SupportProfile`, `Contact` (via `ParticipantContacts`)

### AppSettings — Singleton → Per-Tenant

The current `Id = 1` singleton pattern is removed. `AppSettings` becomes a standard entity with a Guid PK and a unique index on `TenantId` (one row per tenant).

```csharp
// Before
[DatabaseGenerated(DatabaseGeneratedOption.None)]
public int Id { get; set; }  // Always 1

// After
public Guid Id { get; set; }
public Guid TenantId { get; set; }
public Tenant Tenant { get; set; }
public int QualificationWarningDays { get; set; } = 30;
```

The raw SQL seed in `Program.cs` is removed. Seeding moves into Migration 5.

### New UserRole: SuperAdmin

Add `SuperAdmin` to the `UserRole` enum. SuperAdmin users have `TenantId = null` and are platform operators only — not visible or assignable within any tenant's UI. SuperAdmin users must be created via a seeded migration or direct DB insert; there is no in-app creation flow for this role.

---

## Auth Flow

### Login

1. User POSTs `{ username, password, email }` to `POST /api/v1/auth/login`
2. Extract email domain: `domain = email.Split('@').Last().ToLower()`
3. Look up tenant: `Tenants.Where(t => t.EmailDomain == domain && t.IsActive)` — return `401` if not found
4. Verify user belongs to that tenant: `Users.IgnoreQueryFilters().Where(u => u.Username == username && u.TenantId == tenant.Id && u.IsActive)` — BCrypt verify password
5. Issue JWT with additional claim: `new Claim("tenant_id", tenant.Id.ToString())`
6. Include `tenantName` in the login response body

Note: `IgnoreQueryFilters()` is required in step 4 because `ICurrentTenant.TenantId` is null pre-authentication.

### Subsequent Requests

Every authenticated request flows through:

1. Existing JWT middleware validates token — no change
2. `ICurrentTenant` scoped service reads `tenant_id` claim from `HttpContext.User`
3. `OdipDbContext` holds an `ICurrentTenant` reference; Global Query Filters silently append `WHERE TenantId = @currentTenantId` to all root entity queries
4. SuperAdmin requests skip the filter via `IgnoreQueryFilters()` on admin-specific queries

---

## Backend Implementation

### ICurrentTenant Service

```csharp
// Odip.Application/Services/ICurrentTenant.cs
public interface ICurrentTenant
{
    Guid? TenantId { get; }
    bool IsSuperAdmin { get; }
}

// Odip.Infrastructure/Services/CurrentTenant.cs
public class CurrentTenant : ICurrentTenant
{
    public Guid? TenantId { get; }
    public bool IsSuperAdmin { get; }

    public CurrentTenant(IHttpContextAccessor accessor)
    {
        var user = accessor.HttpContext?.User;
        var claim = user?.FindFirst("tenant_id")?.Value;
        TenantId = claim != null ? Guid.Parse(claim) : null;
        IsSuperAdmin = user?.IsInRole("SuperAdmin") ?? false;
    }
}
```

Registration in `Program.cs`:
```csharp
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();
```

### DbContext — Global Query Filters

`OdipDbContext` constructor accepts `ICurrentTenant`. `OnModelCreating` adds one `HasQueryFilter` per root entity (same pattern × 8):

```csharp
public OdipDbContext(DbContextOptions<OdipDbContext> options, ICurrentTenant tenant)
    : base(options) => _tenant = tenant;

// In OnModelCreating:
modelBuilder.Entity<Participant>()
    .HasQueryFilter(p => _tenant.IsSuperAdmin || p.TenantId == _tenant.TenantId);

modelBuilder.Entity<Staff>()
    .HasQueryFilter(s => _tenant.IsSuperAdmin || s.TenantId == _tenant.TenantId);

// ... same pattern for User, Vehicle, AccommodationProperty,
//     EventTemplate, TripInstance, AppSettings
```

### TenantsController (SuperAdmin only)

New controller at `/api/v1/admin/tenants`, decorated `[Authorize(Roles = "SuperAdmin")]`:

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/v1/admin/tenants` | List all tenants |
| `POST` | `/api/v1/admin/tenants` | Create a new tenant |
| `PUT` | `/api/v1/admin/tenants/{id}` | Update name / email domain / active status |
| `GET` | `/api/v1/admin/tenants/{id}/users` | List users for a specific tenant |

All queries in this controller use `IgnoreQueryFilters()`.

---

## Migration Strategy

Five EF Core migrations, applied in order as a single release alongside the code deployment.

### Migration 1 — AddTenants
Create `Tenants` table. Seed the "Default" tenant with a fixed, well-known Guid (e.g. `00000000-0000-0000-0000-000000000001`) — update `Name` and `EmailDomain` to match the current organisation before deploying.

### Migration 2 — AddTenantIdToRoots (nullable)
Add nullable `UUID` column `TenantId` to all 8 root entity tables.

### Migration 3 — BackfillTenantId
`UPDATE` all 8 tables to set `TenantId = '00000000-0000-0000-0000-000000000001'` (the Default tenant Guid).

### Migration 4 — MakeTenantIdRequired
For each of the 8 tables:
- `ALTER COLUMN "TenantId" SET NOT NULL`
- Add FK constraint to `Tenants`
- Create index `IX_<Table>_TenantId`

### Migration 5 — FixAppSettings
- Change `AppSettings.Id` from `int` (always 1) to `Guid` PK
- Add `TenantId` FK (covered by Migration 2–4 pattern, but `AppSettings` needs additional handling)
- Add unique index on `AppSettings.TenantId`
- Remove the raw SQL seed from `Program.cs`; seed one row per existing tenant in this migration

**Rollout:** Run `dotnet ef database update` during deployment. The app must not serve traffic between migration and code deployment — deploy as a coordinated release.

---

## Frontend Changes

### Login Response

Add `tenantName` to the existing login response body (no breaking change — additive):

```json
{
  "token": "eyJ...",
  "user": { "role": "Coordinator", "fullName": "Jane Smith", ... },
  "tenantName": "Ability Options"
}
```

Store `tenantName` in the existing `odip_user` localStorage object.

### Navbar

Display a small org name pill in the navbar alongside the existing user name display. No other UI changes.

### Unchanged

- `client.ts` axios interceptor — no change
- All React Query hooks — no change
- All routes — no change
- 401 → redirect-to-login flow — no change

---

## Out of Scope

- Tenant self-registration / sign-up flow
- Per-tenant billing or subscription management
- Tenant-level custom branding
- PostgreSQL Row-Level Security (can be added later as a hardening layer)
- Cross-tenant staff sharing (e.g. staff covering another branch)
- Subdomain-based tenant routing
