# Super Admin User View Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-level impersonation selector for SuperAdmin users so they can choose a specific user within the selected tenant and see exactly what that user sees — both role-based UI and data scope.

**Architecture:** Extends the existing `X-View-As-Tenant` pattern. A new `UserSwitcher` component lets SuperAdmin pick a user; the frontend overrides `odip_user` in localStorage (so role-based UI reflects the impersonated user's role) and stores the selected user ID in `odip_viewing_user`. The API interceptor sends `X-View-As-User: {userId}` on every call. A persistent amber banner indicates impersonation is active with an "Exit view" button to restore. The backend gains `ViewAsUserId` on `ICurrentTenant` for future per-user query scoping.

**Tech Stack:** React 19, TypeScript, TanStack Query v5, Tailwind CSS v4, Axios (frontend); .NET 9, ASP.NET Core, EF Core 8, PostgreSQL (backend)

---

## File Map

| Action | File |
|--------|------|
| Modify | `backend/Odip.Application/DTOs/DTOs.cs` — add `TenantUserDto` record |
| Modify | `backend/Odip.Api/Controllers/TenantsController.cs` — return typed `ApiResponse<List<TenantUserDto>>` from `GetUsers` |
| Modify | `backend/Odip.Domain/Interfaces/ICurrentTenant.cs` — add `ViewAsUserId` property |
| Modify | `backend/Odip.Infrastructure/Services/CurrentTenant.cs` — populate `ViewAsUserId` from header |
| Modify | `frontend/src/api/types/index.ts` (or wherever `TenantDto` is defined) — add `TenantUserDto` type |
| Modify | `frontend/src/api/hooks/settings.ts` — add `useAdminTenantUsers` hook |
| Modify | `frontend/src/api/client.ts` — add `X-View-As-User` header to interceptor |
| Create | `frontend/src/components/layout/UserSwitcher.tsx` |
| Modify | `frontend/src/components/layout/AppLayout.tsx` — add UserSwitcher, impersonation banner, fix logout |
| Modify | `frontend/src/components/layout/TenantSwitcher.tsx` — clear impersonation on tenant switch |

---

## Task 1: Backend — Add TenantUserDto and fix GetUsers endpoint

**Files:**
- Modify: `backend/Odip.Application/DTOs/DTOs.cs` (after the `UpdateTenantDto` record, ~line 1236)
- Modify: `backend/Odip.Api/Controllers/TenantsController.cs` (`GetUsers` method, ~lines 65-78)

- [ ] **Step 1: Add TenantUserDto to DTOs.cs**

  Find the block after `UpdateTenantDto` in `backend/Odip.Application/DTOs/DTOs.cs`:

  ```csharp
  public record UpdateTenantDto(
      string Name,
      string EmailDomain,
      bool IsActive);
  ```

  Add immediately after it:

  ```csharp
  public record TenantUserDto(
      Guid Id,
      string FullName,
      string Role,
      bool IsActive);
  ```

- [ ] **Step 2: Update TenantsController.GetUsers to return typed response**

  Find the `GetUsers` method in `backend/Odip.Api/Controllers/TenantsController.cs`:

  ```csharp
  // GET api/v1/admin/tenants/{id}/users
  [HttpGet("{id:guid}/users")]
  public async Task<IActionResult> GetUsers(Guid id)
  {
      var tenant = await _db.Tenants.FindAsync(id);
      if (tenant is null)
          return NotFound();

      var users = await _db.Users
          .IgnoreQueryFilters()
          .Where(u => u.TenantId == id)
          .Select(u => new { u.Id, u.Username, u.FullName, u.Role, u.IsActive })
          .ToListAsync();
      return Ok(users);
  }
  ```

  Replace it with:

  ```csharp
  // GET api/v1/admin/tenants/{id}/users
  [HttpGet("{id:guid}/users")]
  public async Task<IActionResult> GetUsers(Guid id)
  {
      var tenant = await _db.Tenants.FindAsync(id);
      if (tenant is null)
          return NotFound();

      var users = await _db.Users
          .IgnoreQueryFilters()
          .Where(u => u.TenantId == id)
          .OrderBy(u => u.FullName)
          .Select(u => new TenantUserDto(u.Id, u.FullName, u.Role.ToString(), u.IsActive))
          .ToListAsync();
      return Ok(ApiResponse<List<TenantUserDto>>.Ok(users));
  }
  ```

- [ ] **Step 3: Build backend to verify no errors**

  ```bash
  dotnet build backend/Odip.Api
  ```

  Expected: `Build succeeded.`

- [ ] **Step 4: Commit**

  ```bash
  git add backend/Odip.Application/DTOs/DTOs.cs backend/Odip.Api/Controllers/TenantsController.cs
  git commit -m "feat: add TenantUserDto and fix GetUsers endpoint to return typed response"
  ```

---

## Task 2: Backend — Add ViewAsUserId to ICurrentTenant and CurrentTenant

**Files:**
- Modify: `backend/Odip.Domain/Interfaces/ICurrentTenant.cs`
- Modify: `backend/Odip.Infrastructure/Services/CurrentTenant.cs`

- [ ] **Step 1: Add ViewAsUserId to the interface**

  Replace the entire contents of `backend/Odip.Domain/Interfaces/ICurrentTenant.cs` with:

  ```csharp
  namespace Odip.Domain.Interfaces;

  /// <summary>
  /// Provides the tenant context for the current HTTP request.
  /// Resolved from the JWT "tenant_id" claim.
  /// SuperAdmin users have TenantId = null and IsSuperAdmin = true.
  /// </summary>
  public interface ICurrentTenant
  {
      /// <summary>The current tenant's Guid, or null for SuperAdmin users.</summary>
      Guid? TenantId { get; }

      /// <summary>True when the authenticated user has the SuperAdmin role.</summary>
      bool IsSuperAdmin { get; }

      /// <summary>
      /// Set when a SuperAdmin is viewing as a specific user via X-View-As-User header.
      /// Null when not impersonating.
      /// </summary>
      Guid? ViewAsUserId { get; }
  }
  ```

- [ ] **Step 2: Populate ViewAsUserId in CurrentTenant**

  Replace the entire contents of `backend/Odip.Infrastructure/Services/CurrentTenant.cs` with:

  ```csharp
  using System.Security.Claims;
  using Microsoft.AspNetCore.Http;
  using Odip.Domain.Interfaces;

  namespace Odip.Infrastructure.Services;

  /// <summary>
  /// Reads the current tenant from the JWT "tenant_id" claim via IHttpContextAccessor.
  /// When a SuperAdmin sends X-View-As-Tenant header, scopes them to that tenant.
  /// When X-View-As-User header is also present, sets ViewAsUserId for per-user scoping.
  /// Registered as Scoped in DI — one instance per HTTP request.
  /// </summary>
  public sealed class CurrentTenant : ICurrentTenant
  {
      public Guid? TenantId { get; private set; }
      public bool IsSuperAdmin { get; private set; }
      public Guid? ViewAsUserId { get; private set; }

      public CurrentTenant(IHttpContextAccessor accessor)
      {
          var user = accessor.HttpContext?.User;
          var claim = user?.FindFirst("tenant_id")?.Value;
          TenantId = Guid.TryParse(claim, out var parsed) ? parsed : null;
          IsSuperAdmin = user?.IsInRole("SuperAdmin") ?? false;

          // SuperAdmin header override: scope to a specific tenant for this request
          if (IsSuperAdmin)
          {
              var header = accessor.HttpContext?.Request.Headers["X-View-As-Tenant"].FirstOrDefault();
              if (Guid.TryParse(header, out var overrideTenant))
              {
                  TenantId = overrideTenant;
                  IsSuperAdmin = false;
              }
          }

          // User-level view-as: record which user we're impersonating
          if (TenantId.HasValue)
          {
              var userHeader = accessor.HttpContext?.Request.Headers["X-View-As-User"].FirstOrDefault();
              if (Guid.TryParse(userHeader, out var viewUserId))
                  ViewAsUserId = viewUserId;
          }
      }
  }
  ```

- [ ] **Step 3: Build backend to verify no errors**

  ```bash
  dotnet build backend/Odip.Api
  ```

  Expected: `Build succeeded.`

- [ ] **Step 4: Commit**

  ```bash
  git add backend/Odip.Domain/Interfaces/ICurrentTenant.cs backend/Odip.Infrastructure/Services/CurrentTenant.cs
  git commit -m "feat: add ViewAsUserId to ICurrentTenant for per-user view scoping"
  ```

---

## Task 3: Frontend — Types, hook, and API interceptor

**Files:**
- Modify: `frontend/src/api/types/index.ts` (or wherever `TenantDto` is defined — search for `TenantDto` in `frontend/src/api/`)
- Modify: `frontend/src/api/hooks/settings.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Add TenantUserDto frontend type**

  Find the file where `TenantDto` is defined (run: `grep -r "TenantDto" frontend/src/api/types`). In that file, add after the `TenantDto` definition:

  ```typescript
  export interface TenantUserDto {
    id: string
    fullName: string
    role: string
    isActive: boolean
  }
  ```

- [ ] **Step 2: Add useAdminTenantUsers hook to settings.ts**

  In `frontend/src/api/hooks/settings.ts`, add `TenantUserDto` to the imports at the top:

  ```typescript
  import type { AppSettingsDto, UpdateAppSettingsDto, ApiResponse, TenantDto, TenantUserDto } from '../types'
  ```

  Then add this hook at the bottom of the file:

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

- [ ] **Step 3: Add X-View-As-User header to the API interceptor**

  In `frontend/src/api/client.ts`, find the JWT interceptor block:

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

  Replace it with:

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
    const viewingUserId = localStorage.getItem('odip_viewing_user')
    if (viewingUserId) {
      config.headers['X-View-As-User'] = viewingUserId
    }
    return config
  })
  ```

- [ ] **Step 4: Also clear impersonation keys on 401 logout**

  In `client.ts`, find the 401 error handler block that clears localStorage:

  ```typescript
  localStorage.removeItem('odip_token')
  localStorage.removeItem('odip_user')
  localStorage.removeItem('odip_viewing_tenant')
  window.location.href = '/login'
  ```

  Replace it with:

  ```typescript
  localStorage.removeItem('odip_token')
  localStorage.removeItem('odip_user')
  localStorage.removeItem('odip_viewing_tenant')
  localStorage.removeItem('odip_viewing_user')
  localStorage.removeItem('odip_superadmin_user')
  window.location.href = '/login'
  ```

- [ ] **Step 5: Build frontend to verify no type errors**

  ```bash
  cd frontend && npm run build
  ```

  Expected: build completes with no TypeScript errors.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/api/types/index.ts frontend/src/api/hooks/settings.ts frontend/src/api/client.ts
  git commit -m "feat: add TenantUserDto type, useAdminTenantUsers hook, and X-View-As-User header"
  ```

---

## Task 4: Frontend — Create UserSwitcher component

**Files:**
- Create: `frontend/src/components/layout/UserSwitcher.tsx`

- [ ] **Step 1: Create the component**

  Create `frontend/src/components/layout/UserSwitcher.tsx` with:

  ```typescript
  import { useState, useRef, useEffect } from 'react'
  import { useAdminTenantUsers } from '@/api/hooks'
  import type { TenantUserDto, ApiResponse } from '@/api/types'

  export default function UserSwitcher() {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    const viewingTenantId = localStorage.getItem('odip_viewing_tenant')
    const viewingUserId = localStorage.getItem('odip_viewing_user')

    const { data } = useAdminTenantUsers(viewingTenantId)
    const users: TenantUserDto[] = (data as ApiResponse<TenantUserDto[]>)?.data ?? []
    const currentViewUser = users.find(u => u.id === viewingUserId)

    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
      }
      document.addEventListener('mousedown', handler)
      return () => document.removeEventListener('mousedown', handler)
    }, [])

    const selectUser = (user: TenantUserDto) => {
      // Preserve original SuperAdmin user object before first impersonation
      if (!localStorage.getItem('odip_superadmin_user')) {
        localStorage.setItem('odip_superadmin_user', localStorage.getItem('odip_user') || '{}')
      }

      // Override odip_user with impersonated user's role and name
      const currentUser = JSON.parse(localStorage.getItem('odip_user') || '{}')
      const overriddenUser = { ...currentUser, fullName: user.fullName, role: user.role }
      localStorage.setItem('odip_user', JSON.stringify(overriddenUser))
      localStorage.setItem('odip_viewing_user', user.id)

      setOpen(false)
      window.location.reload()
    }

    const clearUser = () => {
      const savedAdmin = localStorage.getItem('odip_superadmin_user')
      if (savedAdmin) {
        localStorage.setItem('odip_user', savedAdmin)
        localStorage.removeItem('odip_superadmin_user')
      }
      localStorage.removeItem('odip_viewing_user')
      window.location.reload()
    }

    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 bg-[#fff7ed] border border-[#fed7aa] rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-[#ffedd5] transition-colors"
        >
          <span className="text-[10px] bg-[#ea580c] text-white px-1.5 py-0.5 rounded font-bold tracking-wide">USR</span>
          <span className="text-sm font-semibold text-[#9a3412]">
            {currentViewUser?.fullName ?? 'View as user…'}
          </span>
          <span className="text-[#ea580c] text-xs">▾</span>
        </button>

        {open && (
          <div className="absolute right-0 mt-1 w-64 bg-[#1e2030] border border-[#334155] rounded-xl shadow-2xl overflow-hidden z-50">
            <div className="px-3 py-2 border-b border-[#334155] text-[10px] text-[#64748b] uppercase tracking-wider">
              View as user
            </div>
            <div className="p-1.5">
              {viewingUserId && (
                <button
                  onClick={clearUser}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-[rgba(255,255,255,0.05)] mb-1 border-b border-[#334155] pb-2"
                >
                  <span className="text-sm text-[#64748b]">↩ Exit view</span>
                </button>
              )}
              {users.length === 0 && (
                <p className="px-2.5 py-2 text-sm text-[#64748b]">No users in this tenant</p>
              )}
              {users.map(user => (
                <button
                  key={user.id}
                  onClick={() => selectUser(user)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                    user.id === viewingUserId
                      ? 'bg-[rgba(234,88,12,0.15)]'
                      : 'hover:bg-[rgba(255,255,255,0.05)]'
                  } ${!user.isActive ? 'opacity-50' : ''}`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${user.isActive ? 'bg-[#22c55e]' : 'bg-[#ef4444]'}`} />
                  <span className={`text-sm flex-1 ${user.id === viewingUserId ? 'text-[#e2e8f0] font-medium' : 'text-[#94a3b8]'}`}>
                    {user.fullName}
                  </span>
                  <span className="text-[10px] text-[#64748b]">{user.role}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 2: Build to verify no type errors**

  ```bash
  cd frontend && npm run build
  ```

  Expected: build completes with no TypeScript errors.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/layout/UserSwitcher.tsx
  git commit -m "feat: add UserSwitcher component for SuperAdmin user impersonation"
  ```

---

## Task 5: Frontend — Update AppLayout with UserSwitcher and impersonation banner

**Files:**
- Modify: `frontend/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Add UserSwitcher import and isSuperAdmin detection**

  In `frontend/src/components/layout/AppLayout.tsx`, find the import line for TenantSwitcher:

  ```typescript
  import TenantSwitcher from '@/components/layout/TenantSwitcher'
  ```

  Replace it with:

  ```typescript
  import TenantSwitcher from '@/components/layout/TenantSwitcher'
  import UserSwitcher from '@/components/layout/UserSwitcher'
  ```

- [ ] **Step 2: Update user reading and add isSuperAdmin / impersonation state**

  Find in the `AppLayout` function body:

  ```typescript
  const user = JSON.parse(localStorage.getItem('odip_user') || '{}')
  ```

  Replace it with:

  ```typescript
  const user = JSON.parse(localStorage.getItem('odip_user') || '{}')
  const isSuperAdmin = user.role === 'SuperAdmin' || !!localStorage.getItem('odip_superadmin_user')
  const viewingUserId = localStorage.getItem('odip_viewing_user')
  const viewingTenantId = localStorage.getItem('odip_viewing_tenant')
  const savedAdminUser = JSON.parse(localStorage.getItem('odip_superadmin_user') || '{}')
  ```

- [ ] **Step 3: Update the logout handler to clear impersonation keys**

  Find the `handleLogout` function:

  ```typescript
  const handleLogout = () => {
    localStorage.removeItem('odip_token')
    localStorage.removeItem('odip_user')
    localStorage.removeItem('odip_viewing_tenant')
    window.location.href = '/login'
  }
  ```

  Replace it with:

  ```typescript
  const handleLogout = () => {
    localStorage.removeItem('odip_token')
    localStorage.removeItem('odip_user')
    localStorage.removeItem('odip_viewing_tenant')
    localStorage.removeItem('odip_viewing_user')
    localStorage.removeItem('odip_superadmin_user')
    window.location.href = '/login'
  }
  ```

- [ ] **Step 4: Update the TenantSwitcher rendering to also show UserSwitcher**

  Find the header's right-side controls block:

  ```typescript
  {user.role === 'SuperAdmin' && <TenantSwitcher />}
  ```

  Replace it with:

  ```typescript
  {isSuperAdmin && <TenantSwitcher />}
  {isSuperAdmin && viewingTenantId && <UserSwitcher />}
  ```

- [ ] **Step 5: Add the impersonation banner**

  Find the `<main>` element:

  ```typescript
  {/* Page content */}
  <main className="flex-1 p-4 md:p-6 lg:p-8 pb-24 lg:pb-8">
    <Outlet />
  </main>
  ```

  Replace it with:

  ```typescript
  {/* Impersonation banner */}
  {viewingUserId && (
    <div className="bg-amber-50 border-b border-amber-200 px-4 md:px-6 py-2 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <span className="text-amber-600 text-xs font-bold uppercase tracking-wide">Viewing as</span>
        <span className="text-amber-800 text-sm font-semibold">{user.fullName}</span>
        <span className="text-amber-600 text-xs">({user.role})</span>
      </div>
      <button
        onClick={() => {
          if (savedAdminUser.role) {
            localStorage.setItem('odip_user', JSON.stringify(savedAdminUser))
            localStorage.removeItem('odip_superadmin_user')
          }
          localStorage.removeItem('odip_viewing_user')
          window.location.reload()
        }}
        className="text-xs text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2"
      >
        Exit view
      </button>
    </div>
  )}

  {/* Page content */}
  <main className="flex-1 p-4 md:p-6 lg:p-8 pb-24 lg:pb-8">
    <Outlet />
  </main>
  ```

- [ ] **Step 6: Build to verify no type errors**

  ```bash
  cd frontend && npm run build
  ```

  Expected: build completes with no TypeScript errors.

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/src/components/layout/AppLayout.tsx
  git commit -m "feat: add UserSwitcher and impersonation banner to AppLayout"
  ```

---

## Task 6: Frontend — Update TenantSwitcher to clear impersonation on tenant switch + verify end-to-end

**Files:**
- Modify: `frontend/src/components/layout/TenantSwitcher.tsx`

- [ ] **Step 1: Clear impersonation when switching tenants**

  In `frontend/src/components/layout/TenantSwitcher.tsx`, find the `switchTenant` function:

  ```typescript
  const switchTenant = (tenantId: string) => {
    localStorage.setItem('odip_viewing_tenant', tenantId)
    localStorage.setItem('odip_last_tenant', tenantId)
    window.location.reload()
  }
  ```

  Replace it with:

  ```typescript
  const switchTenant = (tenantId: string) => {
    // Restore original SuperAdmin user if we were impersonating
    const savedAdmin = localStorage.getItem('odip_superadmin_user')
    if (savedAdmin) {
      localStorage.setItem('odip_user', savedAdmin)
      localStorage.removeItem('odip_superadmin_user')
    }
    localStorage.removeItem('odip_viewing_user')
    localStorage.setItem('odip_viewing_tenant', tenantId)
    localStorage.setItem('odip_last_tenant', tenantId)
    window.location.reload()
  }
  ```

- [ ] **Step 2: Build final check**

  ```bash
  dotnet build backend/Odip.Api && cd frontend && npm run build
  ```

  Expected: both build with no errors.

- [ ] **Step 3: Manual smoke test**

  Start the full stack:
  ```bash
  docker-compose up --build
  ```

  Verify:
  1. Log in as SuperAdmin → TenantSwitcher visible, UserSwitcher not yet visible
  2. Select a tenant → UserSwitcher appears
  3. Click UserSwitcher → dropdown lists users from that tenant
  4. Select a user with a different role (e.g., SupportWorker) → page reloads, amber banner appears: "Viewing as {name} (SupportWorker)"
  5. Navigation changes to reflect SupportWorker role (Admin-only items hidden)
  6. TenantSwitcher and UserSwitcher still visible (isSuperAdmin check)
  7. Click "Exit view" in banner → SuperAdmin state restored, banner gone
  8. Switch tenant while impersonating → impersonation cleared, new tenant selected
  9. Log out while impersonating → all localStorage keys cleared, redirect to /login

- [ ] **Step 4: Final commit**

  ```bash
  git add frontend/src/components/layout/TenantSwitcher.tsx
  git commit -m "feat: clear user impersonation on tenant switch"
  ```
