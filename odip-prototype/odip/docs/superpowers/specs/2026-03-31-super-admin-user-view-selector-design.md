---
tags: [project/trip-planner, feature/super-admin, feature/impersonation, tech/react, tech/dotnet]
date: 2026-03-31
project: Odip
---

# Super Admin User View Selector

## Overview

Super admin users can select a specific user within the currently-viewed tenant and see the application as that user would see it — including their role-based UI and their user-scoped data. This extends the existing tenant-switching pattern with a user-level layer.

## Goals

- Super admin can pick any user within the selected tenant from a dropdown
- The app reflects that user's role (navigation, buttons, access controls)
- API calls are scoped to that user so data filtering matches what they would see
- A persistent banner makes it clear the super admin is in "view as" mode
- Exiting restores the super admin view immediately

## Non-Goals

- No new JWT or token exchange — the super admin's original token is never replaced
- No audit log of impersonation sessions (can be added later)
- No permanent per-user query filter changes on the backend (tenant-level filtering covers most cases; `ViewAsUserId` is available if needed later)

---

## Architecture

### Data Flow

```
SuperAdmin selects tenant (existing TenantSwitcher)
  → localStorage: odip_viewing_tenant = {tenantId}

SuperAdmin selects user (new UserSwitcher)
  → localStorage: odip_viewing_user    = {userId}
  → localStorage: odip_user            = {selected user's AuthResponseDto shape}
  → localStorage: odip_superadmin_user = {original SuperAdmin user object — preserved for restore}

Every API call (client.ts interceptor):
  → Authorization: Bearer {superadmin JWT}   (unchanged)
  → X-View-As-Tenant: {tenantId}             (existing)
  → X-View-As-User: {userId}                 (new)

Backend (CurrentTenant.cs):
  → IsSuperAdmin = false, TenantId = selected tenant (from X-View-As-Tenant, existing)
  → ViewAsUserId = selected user ID (from X-View-As-User, new)
```

### localStorage Keys

| Key | Value | Notes |
|-----|-------|-------|
| `odip_token` | SuperAdmin JWT | Never changed during impersonation |
| `odip_user` | User object (role, name, etc.) | Overridden with selected user during impersonation |
| `odip_viewing_tenant` | Tenant UUID | Existing |
| `odip_viewing_user` | User UUID | New — presence indicates impersonation is active |
| `odip_superadmin_user` | SuperAdmin user object | New — stored on impersonation start, cleared on exit |

---

## Frontend

### New Component: `UserSwitcher`

**Location:** `frontend/src/components/layout/UserSwitcher.tsx`

- Rendered in `AppLayout` next to `TenantSwitcher`, only when:
  - `user.role === 'SuperAdmin'` (original role, checked via `odip_superadmin_user` or `odip_viewing_user` absence)
  - A tenant is currently selected (`odip_viewing_tenant` is set)
- Fetches users via `useAdminTenantUsers(tenantId)` hook
- Dropdown items: `"{fullName} — {role}"` (e.g. "Jane Smith — Support Worker")
- On select:
  1. Save current user object to `odip_superadmin_user` (if not already saved)
  2. Write selected user's `{id, fullName, role, tenantId, tenantName}` to `odip_user`
  3. Write selected user's `id` to `odip_viewing_user`
  4. `window.location.reload()`
- On clear (select placeholder "View as user…"):
  1. Remove `odip_viewing_user`
  2. Restore `odip_superadmin_user` → `odip_user`
  3. Remove `odip_superadmin_user`
  4. `window.location.reload()`

### Impersonation Banner

**Location:** Rendered in `AppLayout` between the header and main content area.

- Shown when `localStorage.getItem('odip_viewing_user')` is set
- Styling: amber background, distinct from normal UI
- Content: `"Viewing as {fullName} ({role})"`
- "Exit view" button triggers the same clear logic as UserSwitcher's clear action

### Role-Based UI (No Changes Needed)

All existing role checks (e.g. `user.role === 'Admin'`) read from `odip_user`, which is overridden during impersonation. Navigation items, buttons, and page guards all automatically reflect the impersonated role without modification.

The `UserSwitcher` and `TenantSwitcher` components check for the presence of `odip_superadmin_user` (or `odip_viewing_user`) to remain visible even when the overridden user object has a non-SuperAdmin role.

### New API Hook: `useAdminTenantUsers`

**Location:** `frontend/src/api/hooks/settings.ts` (alongside `useAdminTenants`)

```typescript
export function useAdminTenantUsers(tenantId: string | null) {
  return useQuery({
    queryKey: ['admin-tenant-users', tenantId],
    queryFn: () =>
      apiClient
        .get<ApiResponse<TenantUserDto[]>>(`/admin/tenants/${tenantId}/users`)
        .then(r => r.data),
    enabled: !!tenantId,
  })
}
```

### API Client (`client.ts`)

Add `X-View-As-User` header in the existing interceptor:

```typescript
const viewingUserId = localStorage.getItem('odip_viewing_user')
if (viewingUserId) {
  config.headers['X-View-As-User'] = viewingUserId
}
```

---

## Backend

### New DTO

```csharp
public record TenantUserDto(Guid Id, string FullName, string Role, string Email);
```

### New Endpoint: `GET /admin/tenants/{tenantId}/users`

**Controller:** `TenantsController` (extends existing)

```csharp
[HttpGet("{tenantId}/users")]
[Authorize(Roles = "SuperAdmin")]
public async Task<IActionResult> GetTenantUsers(Guid tenantId)
{
    var users = await _db.Users
        .IgnoreQueryFilters()
        .Where(u => u.TenantId == tenantId)
        .OrderBy(u => u.FullName)
        .Select(u => new TenantUserDto(u.Id, u.FullName, u.Role.ToString(), u.Email))
        .ToListAsync();
    return Ok(ApiResponse<List<TenantUserDto>>.Ok(users));
}
```

Note: `.IgnoreQueryFilters()` required because at this point `IsSuperAdmin` may be `false` (tenant is already selected via `X-View-As-Tenant`).

### `ICurrentTenant` / `CurrentTenant`

Add `ViewAsUserId` property for future use:

```csharp
// Interface
Guid? ViewAsUserId { get; }

// Implementation — after existing X-View-As-Tenant handling:
if (TenantId.HasValue)
{
    var userHeader = accessor.HttpContext?.Request.Headers["X-View-As-User"].FirstOrDefault();
    if (Guid.TryParse(userHeader, out var viewUserId))
        ViewAsUserId = viewUserId;
}
```

This property is available to any query that needs user-level scoping but is not wired into global query filters in this iteration.

---

## Component Hierarchy (Updated AppLayout)

```
AppLayout
  Header
    TenantSwitcher    ← existing, SuperAdmin only
    UserSwitcher      ← new, SuperAdmin only + tenant selected
  ImpersonationBanner ← new, shown when odip_viewing_user is set
  Outlet (page content)
```

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| SuperAdmin switches tenant while impersonating a user | Clear `odip_viewing_user` and `odip_superadmin_user` on tenant change, reload |
| SuperAdmin logs out while impersonating | Logout clears all localStorage keys — no residual state |
| Selected user is deleted | API calls fail gracefully (backend returns 404/403); banner remains with "Exit view" available |
| Tenant has no users | UserSwitcher shows empty state: "No users in this tenant" |

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/layout/UserSwitcher.tsx` | New component |
| `frontend/src/components/layout/AppLayout.tsx` | Add UserSwitcher + ImpersonationBanner |
| `frontend/src/api/client.ts` | Add X-View-As-User header to interceptor |
| `frontend/src/api/hooks/settings.ts` | Add useAdminTenantUsers hook |
| `frontend/src/api/types/` | Add TenantUserDto type |
| `backend/Odip.Api/Controllers/TenantsController.cs` | Add GET /{tenantId}/users endpoint |
| `backend/Odip.Application/DTOs/DTOs.cs` | Add TenantUserDto record |
| `backend/Odip.Infrastructure/Services/CurrentTenant.cs` | Add ViewAsUserId property |
| `backend/Odip.Application/Interfaces/ICurrentTenant.cs` | Add ViewAsUserId to interface |
