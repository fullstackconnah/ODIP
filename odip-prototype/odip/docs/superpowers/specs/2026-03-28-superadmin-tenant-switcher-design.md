---
tags: [project/trip-planner, feature/superadmin-tenant-switcher, tech/efcore, tech/dotnet, tech/react]
date: 2026-03-28
project: Odip
---

# SuperAdmin Tenant Switcher Design

## Overview

Users with `Role = SuperAdmin` (specifically `info@connah.com.au`) can switch which tenant's data they are viewing from a dropdown in the navbar. All other users are unaffected. The feature builds on the multi-tenancy foundation already in place.

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SuperAdmin identity | `UserRole.SuperAdmin` on a regular tenant-scoped user | Login works via existing email-domain flow; no null-TenantId complexity |
| Tenant override mechanism | `X-View-As-Tenant` request header | Single interceptor change, slots into existing query filter system, no new endpoints |
| Default viewing context | Own tenant (Connah) on login | Safe default, avoids accidental cross-tenant confusion |
| Cache invalidation on switch | Full page reload | Clears all React Query caches cleanly without per-query invalidation logic |
| Tenant list source | `GET /api/v1/admin/tenants` (already exists) | No new endpoint needed |

---

## Data Model

No schema changes. The `Users` table already has `Role` (int) and `Email` (string) columns.

### New migration: SeedSuperAdmin

Seeds one user into the Connah tenant:

```sql
INSERT INTO "Users" ("Id", "TenantId", "Username", "Email", "PasswordHash",
                     "FirstName", "LastName", "Role", "IsActive", "CreatedAt", "UpdatedAt")
VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',  -- Connah tenant
  'admin',
  'info@connah.com.au',
  '<bcrypt hash of Admin123!>',
  'Admin',
  'User',
  4,          -- UserRole.SuperAdmin
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("Username", "TenantId") DO UPDATE SET "Role" = 4;
```

If the `admin` username already exists in the Connah tenant, it is promoted to SuperAdmin. **Change the password after first login.**

---

## Backend Implementation

### `CurrentTenant.cs` — header override

Add one block to the constructor after the existing JWT claim read:

```csharp
// If SuperAdmin, allow header-based tenant override for viewing another tenant's data
if (IsSuperAdmin)
{
    var header = accessor.HttpContext?.Request.Headers["X-View-As-Tenant"].FirstOrDefault();
    if (Guid.TryParse(header, out var overrideTenant))
        TenantId = overrideTenant;
}
```

**Behaviour table:**

| Scenario | TenantId | IsSuperAdmin | Query filter result |
|----------|----------|--------------|---------------------|
| Regular user (no header) | JWT tenant_id | false | Scoped to own tenant |
| SuperAdmin + `X-View-As-Tenant: <connah-guid>` | connah-guid | **false** | Scoped to Connah |
| SuperAdmin + `X-View-As-Tenant: <other-guid>` | other-guid | **false** | Scoped to that tenant |
| SuperAdmin, no header at all | JWT tenant_id | true | Bypasses filter — sees all tenants' data |

The last row only applies to direct API calls made without the header (e.g. curl). In normal app usage the interceptor always sends the header, so SuperAdmin is always scoped.

**When `X-View-As-Tenant` header is present for a SuperAdmin, treat them as a scoped user for query purposes:**

```csharp
public CurrentTenant(IHttpContextAccessor accessor)
{
    var user = accessor.HttpContext?.User;
    var claim = user?.FindFirst("tenant_id")?.Value;
    TenantId = Guid.TryParse(claim, out var parsed) ? parsed : null;
    IsSuperAdmin = user?.IsInRole("SuperAdmin") ?? false;

    // SuperAdmin header override: scope to a specific tenant
    if (IsSuperAdmin)
    {
        var header = accessor.HttpContext?.Request.Headers["X-View-As-Tenant"].FirstOrDefault();
        if (Guid.TryParse(header, out var overrideTenant))
        {
            TenantId = overrideTenant;
            IsSuperAdmin = false;  // Treat as scoped user for this request
        }
    }
}
```

This means: with the header, the SuperAdmin is scoped exactly like a regular user of that tenant. Without the header, they remain SuperAdmin (bypasses all filters — sees everything).

No changes to `TenantsController` — it still uses `IgnoreQueryFilters()` explicitly, so it is unaffected by the `IsSuperAdmin = false` override.

---

## Frontend Implementation

### `client.ts` — request interceptor addition

Add to the existing request interceptor:

```typescript
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('odip_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const viewingTenantId = localStorage.getItem('odip_viewing_tenant')
  if (viewingTenantId) {
    config.headers['X-View-As-Tenant'] = viewingTenantId
  }
  return config
})
```

Key: `odip_viewing_tenant` is set on login to the user's own `tenantId` (default) and updated when the dropdown changes.

### `LoginPage.tsx` — set default viewing tenant on login

After successful login, write the default:

```typescript
localStorage.setItem('odip_viewing_tenant', loginResponse.data.tenantId)
```

`AuthResponseDto` gains a `tenantId` field (the logged-in user's own tenant Guid — not just the name).

### `TenantSwitcher.tsx` — new component

Renders in the navbar top-right, only when `user.role === 'SuperAdmin'` (string value `"SuperAdmin"` from the stored user object).

Behaviour:
- On mount: fetches `GET /api/v1/admin/tenants` via React Query
- Displays current viewing tenant name with an "SA" badge
- Dropdown lists all active tenants; own tenant marked "(yours)"
- On select: writes `tenantId` to `localStorage.odip_viewing_tenant` → `window.location.reload()`
- On logout: `odip_viewing_tenant` is cleared alongside `odip_token` and `odip_user`

### `AppLayout.tsx` — mount the component

In the right side of the top bar, before the notifications bell:

```tsx
{user.role === 'SuperAdmin' && <TenantSwitcher />}
```

### `AuthResponseDto` — add tenantId

Backend: add `public Guid? TenantId { get; init; }` to `AuthResponseDto`.
Frontend: read `res.data.tenantId` in `LoginPage.tsx` and store as `odip_viewing_tenant`.

---

## Out of Scope

- SuperAdmin creating/managing other SuperAdmin accounts (done via DB/migration)
- Audit log of which tenant was viewed when
- "View all tenants" unfiltered mode (default Connah covers this need for now)
- Per-session persistence of viewing context after logout (clears on logout)
