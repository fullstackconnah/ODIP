# Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add field-level audit logging for 7 high-risk entities, captured automatically via EF Core interceptor, surfaced to Admin users as a History tab on Trip and Participant detail pages.

**Architecture:** A single `AuditInterceptor : ISaveChangesInterceptor` reads the `ChangeTracker` before every save, captures Added/Modified/Deleted entries for the 7 audited entity types, serialises field diffs as JSON, and writes `AuditLog` rows in the same transaction. A `GET /api/audit/{entityType}/{entityId}` endpoint (Admin-only) serves the log. Two detail pages receive a new "History" pill tab rendered only for the Admin role.

**Tech Stack:** .NET 9, EF Core 8, ASP.NET Core `ISaveChangesInterceptor`, `IHttpContextAccessor`; React 19, TypeScript, TanStack Query v5, Tailwind CSS v4

---

## File Map

**Backend — New**
- `backend/Odip.Domain/Entities/AuditLog.cs` — AuditLog entity
- `backend/Odip.Infrastructure/Audit/AuditedEntities.cs` — static set of audited Types + excluded fields
- `backend/Odip.Infrastructure/Audit/AuditInterceptor.cs` — ISaveChangesInterceptor implementation
- `backend/Odip.Api/Controllers/AuditController.cs` — Admin-only GET audit endpoint

**Backend — Modified**
- `backend/Odip.Domain/Enums/Enums.cs` — append AuditAction enum
- `backend/Odip.Infrastructure/Data/OdipDbContext.cs` — add `DbSet<AuditLog>`, OnModelCreating config, register interceptor
- `backend/Odip.Api/Program.cs` — register `IHttpContextAccessor` + `AuditInterceptor`; update migration pre-population list
- `backend/Odip.Infrastructure/Migrations/` — new migration `AddAuditLog` (generated in Task 4)

**Frontend — New**
- `frontend/src/components/AuditHistoryTab.tsx` — shared history timeline component

**Frontend — Modified**
- `frontend/src/api/hooks.ts` — append `useAuditHistory` hook + types
- `frontend/src/pages/TripDetailPage.tsx` — add `'history'` tab (Admin only)
- `frontend/src/pages/ParticipantDetailPage.tsx` — add `'history'` tab (Admin only)

---

## Task 1: Domain — AuditLog Entity and AuditAction Enum

**Files:**
- Modify: `backend/Odip.Domain/Enums/Enums.cs`
- Create: `backend/Odip.Domain/Entities/AuditLog.cs`

- [ ] **Step 1: Read Enums.cs to understand the file structure**

Read `backend/Odip.Domain/Enums/Enums.cs` in full, then append the following enum at the end of the file:

```csharp
public enum AuditAction
{
    Created,
    Updated,
    Deleted
}
```

- [ ] **Step 2: Create AuditLog.cs**

Create `backend/Odip.Domain/Entities/AuditLog.cs`:

```csharp
namespace Odip.Domain.Entities;

public class AuditLog
{
    public Guid Id { get; set; }
    public string EntityType { get; set; } = string.Empty;
    public Guid EntityId { get; set; }
    public AuditAction Action { get; set; }
    public DateTimeOffset ChangedAt { get; set; }
    public Guid? ChangedById { get; set; }
    public string? ChangedByName { get; set; }
    /// <summary>JSON array of { field, old, new } objects.</summary>
    public string Changes { get; set; } = "[]";
}
```

- [ ] **Step 3: Build Domain project**

```bash
dotnet build backend/Odip.Domain/Odip.Domain.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Domain/Entities/AuditLog.cs backend/Odip.Domain/Enums/Enums.cs
git commit -m "feat: add AuditLog entity and AuditAction enum"
```

---

## Task 2: Infrastructure — AuditedEntities and AuditInterceptor

**Files:**
- Create: `backend/Odip.Infrastructure/Audit/AuditedEntities.cs`
- Create: `backend/Odip.Infrastructure/Audit/AuditInterceptor.cs`

- [ ] **Step 1: Create the Audit directory and AuditedEntities.cs**

Create `backend/Odip.Infrastructure/Audit/AuditedEntities.cs`:

```csharp
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Audit;

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

    private static readonly HashSet<string> ExcludedProperties = new()
    {
        "CreatedAt", "UpdatedAt"
    };

    public static bool IsExcluded(string propertyName) =>
        ExcludedProperties.Contains(propertyName);
}
```

- [ ] **Step 2: Create AuditInterceptor.cs**

Create `backend/Odip.Infrastructure/Audit/AuditInterceptor.cs`:

```csharp
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Audit;

public sealed class AuditInterceptor : SaveChangesInterceptor
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public AuditInterceptor(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is not null)
        {
            var auditEntries = BuildAuditEntries(eventData.Context);
            if (auditEntries.Count > 0)
                eventData.Context.Set<AuditLog>().AddRange(auditEntries);
        }

        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private List<AuditLog> BuildAuditEntries(DbContext context)
    {
        var user = _httpContextAccessor.HttpContext?.User;
        Guid? changedById = null;
        string? changedByName = null;

        if (user?.Identity?.IsAuthenticated == true)
        {
            var idClaim = user.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (Guid.TryParse(idClaim, out var userId))
                changedById = userId;

            changedByName = user.FindFirst("fullName")?.Value
                ?? user.FindFirst(System.Security.Claims.ClaimTypes.Name)?.Value;
        }

        var entries = new List<AuditLog>();
        var now = DateTimeOffset.UtcNow;

        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (!AuditedEntities.Types.Contains(entry.Entity.GetType())) continue;
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)) continue;

            var entityId = GetEntityId(entry);
            if (entityId == Guid.Empty) continue;

            var action = entry.State switch
            {
                EntityState.Added => AuditAction.Created,
                EntityState.Deleted => AuditAction.Deleted,
                _ => AuditAction.Updated
            };

            var changes = BuildChanges(entry);
            // Skip Updated entries with no actual field changes (e.g. spurious EF tracking)
            if (action == AuditAction.Updated && changes.Count == 0) continue;

            entries.Add(new AuditLog
            {
                Id = Guid.NewGuid(),
                EntityType = entry.Entity.GetType().Name,
                EntityId = entityId,
                Action = action,
                ChangedAt = now,
                ChangedById = changedById,
                ChangedByName = changedByName,
                Changes = JsonSerializer.Serialize(changes)
            });
        }

        return entries;
    }

    private static Guid GetEntityId(EntityEntry entry)
    {
        var idProp = entry.Properties.FirstOrDefault(p => p.Metadata.Name == "Id");
        if (idProp?.CurrentValue is Guid guid) return guid;
        if (idProp?.OriginalValue is Guid origGuid) return origGuid;
        return Guid.Empty;
    }

    private static List<FieldChange> BuildChanges(EntityEntry entry)
    {
        var changes = new List<FieldChange>();

        foreach (var prop in entry.Properties)
        {
            if (prop.Metadata.Name == "Id") continue;
            if (AuditedEntities.IsExcluded(prop.Metadata.Name)) continue;

            switch (entry.State)
            {
                case EntityState.Added:
                    if (prop.CurrentValue is not null)
                        changes.Add(new FieldChange(prop.Metadata.Name, null, FormatValue(prop.CurrentValue)));
                    break;

                case EntityState.Deleted:
                    if (prop.OriginalValue is not null)
                        changes.Add(new FieldChange(prop.Metadata.Name, FormatValue(prop.OriginalValue), null));
                    break;

                case EntityState.Modified:
                    var orig = FormatValue(prop.OriginalValue);
                    var curr = FormatValue(prop.CurrentValue);
                    if (orig != curr)
                        changes.Add(new FieldChange(prop.Metadata.Name, orig, curr));
                    break;
            }
        }

        return changes;
    }

    private static string? FormatValue(object? value) => value switch
    {
        null => null,
        DateTime dt => dt.ToString("O"),
        DateTimeOffset dto => dto.ToString("O"),
        _ => value.ToString()
    };
}

internal record FieldChange(string Field, string? Old, string? New);
```

- [ ] **Step 3: Build Infrastructure project**

```bash
dotnet build backend/Odip.Infrastructure/Odip.Infrastructure.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Infrastructure/Audit/
git commit -m "feat: add AuditInterceptor and AuditedEntities"
```

---

## Task 3: DbContext — Wire Up AuditLog and Interceptor

**Files:**
- Modify: `backend/Odip.Infrastructure/Data/OdipDbContext.cs`
- Modify: `backend/Odip.Api/Program.cs`

- [ ] **Step 1: Read OdipDbContext.cs in full**

Read `backend/Odip.Infrastructure/Data/OdipDbContext.cs` before editing.

- [ ] **Step 2: Add DbSet<AuditLog>**

After the last existing `DbSet` property, add:

```csharp
public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
```

- [ ] **Step 3: Add AuditLog configuration in OnModelCreating**

Inside `OnModelCreating`, after the last existing entity config block, add:

```csharp
modelBuilder.Entity<AuditLog>(entity =>
{
    entity.HasKey(e => e.Id);
    entity.Property(e => e.EntityType).HasMaxLength(100).IsRequired();
    entity.Property(e => e.Changes).IsRequired();
    entity.Property(e => e.Action)
          .HasConversion<string>()
          .HasMaxLength(20)
          .IsRequired();
    entity.Property(e => e.ChangedByName).HasMaxLength(200);
    // Composite index for the primary query pattern: all entries for a given entity record
    entity.HasIndex(e => new { e.EntityType, e.EntityId });
    entity.HasIndex(e => e.ChangedAt);
    // No FK constraint on ChangedById — audit records must survive user deletion
});
```

- [ ] **Step 4: Read Program.cs in full**

Read `backend/Odip.Api/Program.cs` before editing.

- [ ] **Step 5: Update AddDbContext to use factory pattern and register interceptor**

Find the existing `builder.Services.AddDbContext<OdipDbContext>(...)` call and replace it with:

```csharp
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<AuditInterceptor>();

builder.Services.AddDbContext<OdipDbContext>((sp, options) =>
{
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection"));
    options.AddInterceptors(sp.GetRequiredService<AuditInterceptor>());
});
```

Add the using directive at the top of Program.cs:
```csharp
using Odip.Infrastructure.Audit;
```

- [ ] **Step 6: Build the full solution**

```bash
dotnet build backend/Odip.Api/Odip.Api.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 7: Commit**

```bash
git add backend/Odip.Infrastructure/Data/OdipDbContext.cs backend/Odip.Api/Program.cs
git commit -m "feat: wire AuditLog DbSet and AuditInterceptor into DbContext"
```

---

## Task 4: EF Core Migration — AddAuditLog

**Files:**
- Creates: `backend/Odip.Infrastructure/Migrations/<timestamp>_AddAuditLog.cs` (auto-generated)
- Modifies: `backend/Odip.Api/Program.cs` — migration pre-population list

- [ ] **Step 1: Generate the migration**

Run from the repo root:

```bash
dotnet ef migrations add AddAuditLog --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

Expected output ends with: `Done. To undo this action, use 'ef migrations remove'`

- [ ] **Step 2: Inspect the generated migration**

Read the generated `<timestamp>_AddAuditLog.cs` file in `backend/Odip.Infrastructure/Migrations/`. Confirm it contains a `CreateTable` call for `AuditLogs` with columns: `Id`, `EntityType`, `EntityId`, `Action`, `ChangedAt`, `ChangedById`, `ChangedByName`, `Changes`.

If any column is missing, check that `OdipDbContext.OnModelCreating` and `AuditLog.cs` are correct before proceeding.

- [ ] **Step 3: Update the migration pre-population list in Program.cs**

Read `backend/Odip.Api/Program.cs` and find the block that pre-populates EF migration history (look for `INSERT INTO "__EFMigrationsHistory"` or a list of migration IDs being added). Add the exact migration ID from the generated file (e.g. `"20260327143000_AddAuditLog"`) to that list.

- [ ] **Step 4: Build to confirm**

```bash
dotnet build backend/Odip.Api/Odip.Api.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 5: Commit**

```bash
git add backend/Odip.Infrastructure/Migrations/ backend/Odip.Api/Program.cs
git commit -m "feat: add EF Core migration for AuditLog table"
```

---

## Task 5: API — AuditController

**Files:**
- Create: `backend/Odip.Api/Controllers/AuditController.cs`

- [ ] **Step 1: Read an existing controller to confirm namespace and using pattern**

Read `backend/Odip.Api/Controllers/TripsController.cs` (first 30 lines) to confirm the namespace and typical using directives.

- [ ] **Step 2: Create AuditController.cs**

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "Admin")]
public class AuditController : ControllerBase
{
    private readonly OdipDbContext _db;

    public AuditController(OdipDbContext db)
    {
        _db = db;
    }

    [HttpGet("{entityType}/{entityId:guid}")]
    public async Task<IActionResult> GetAuditHistory(
        string entityType,
        Guid entityId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        var allowedTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "TripInstance", "Participant", "ParticipantBooking",
            "IncidentReport", "Staff", "StaffAssignment", "VehicleAssignment"
        };

        if (!allowedTypes.Contains(entityType))
            return BadRequest(new { error = "Invalid entity type." });

        var query = _db.AuditLogs
            .Where(a => a.EntityType == entityType && a.EntityId == entityId)
            .OrderByDescending(a => a.ChangedAt);

        var total = await query.CountAsync(ct);

        var entries = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => new
            {
                a.Id,
                Action = a.Action.ToString(),
                a.ChangedAt,
                a.ChangedByName,
                Changes = JsonSerializer.Deserialize<JsonElement>(a.Changes)
            })
            .ToListAsync(ct);

        return Ok(new { entries, total });
    }
}
```

- [ ] **Step 3: Build**

```bash
dotnet build backend/Odip.Api/Odip.Api.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 4: Smoke test — unauthenticated request returns 401**

```bash
dotnet run --project backend/Odip.Api &
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/audit/TripInstance/00000000-0000-0000-0000-000000000000
```

Expected: `401`

Stop the API process after confirming.

- [ ] **Step 5: Commit**

```bash
git add backend/Odip.Api/Controllers/AuditController.cs
git commit -m "feat: add AuditController with admin-only GET endpoint"
```

---

## Task 6: Frontend — useAuditHistory Hook

**Files:**
- Modify: `frontend/src/api/hooks.ts`

- [ ] **Step 1: Read the end of hooks.ts to find where to append**

Read `frontend/src/api/hooks.ts` — note the last export and the import section at the top (particularly the `apiClient` import path and `useQuery` import).

- [ ] **Step 2: Append types and hook to hooks.ts**

At the very end of `frontend/src/api/hooks.ts`, add:

```typescript
// ── Audit ────────────────────────────────────────────────────────────────────

export interface AuditChange {
  field: string;
  old: string | null;
  new: string | null;
}

export interface AuditEntry {
  id: string;
  action: 'Created' | 'Updated' | 'Deleted';
  changedAt: string;
  changedByName: string | null;
  changes: AuditChange[];
}

export interface AuditHistoryResponse {
  entries: AuditEntry[];
  total: number;
}

export function useAuditHistory(entityType: string, entityId: string | undefined) {
  return useQuery<AuditHistoryResponse>({
    queryKey: ['audit', entityType, entityId],
    queryFn: () =>
      apiClient
        .get<AuditHistoryResponse>(`/audit/${entityType}/${entityId}`)
        .then((r) => r.data),
    enabled: !!entityId,
  });
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/hooks.ts
git commit -m "feat: add useAuditHistory hook and types"
```

---

## Task 7: Frontend — AuditHistoryTab Component

**Files:**
- Create: `frontend/src/components/AuditHistoryTab.tsx`

- [ ] **Step 1: Create AuditHistoryTab.tsx**

Create `frontend/src/components/AuditHistoryTab.tsx`:

```tsx
import { useAuditHistory, type AuditEntry, type AuditChange } from '../api/hooks';

interface Props {
  entityType: string;
  entityId: string;
}

const ACTION_STYLES: Record<string, string> = {
  Created: 'bg-[#d4edda] text-[#155724]',
  Updated: 'bg-[#cce5ff] text-[#004085]',
  Deleted: 'bg-[#f8d7da] text-[#721c24]',
};

function formatRelative(iso: string): { relative: string; absolute: string } {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  let relative: string;
  if (diffMins < 1) relative = 'Just now';
  else if (diffMins < 60) relative = `${diffMins}m ago`;
  else if (diffHours < 24) relative = `${diffHours}h ago`;
  else if (diffDays === 1) relative = 'Yesterday';
  else relative = `${diffDays}d ago`;

  const absolute = date.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return { relative, absolute };
}

function FieldDiff({ field, old: oldVal, new: newVal }: AuditChange) {
  return (
    <div className="flex items-start gap-2 text-xs text-[#43493a]">
      <span className="font-medium min-w-[140px] shrink-0 text-[#6b7280]">{field}</span>
      <span className="line-through text-[#9ca3af]">{oldVal ?? '—'}</span>
      <span className="text-[#6b7280]">→</span>
      <span className="font-medium">{newVal ?? '—'}</span>
    </div>
  );
}

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const { relative, absolute } = formatRelative(entry.changedAt);

  return (
    <div className="flex gap-3 py-4 border-b border-[#e8e8e3] last:border-0">
      <div className="w-2 h-2 rounded-full bg-[#396200] mt-[7px] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              ACTION_STYLES[entry.action] ?? 'bg-[#efeeea] text-[#43493a]'
            }`}
          >
            {entry.action}
          </span>
          <span className="text-xs text-[#6b7280]">
            by {entry.changedByName ?? 'System'}
          </span>
          <span className="text-xs text-[#9ca3af] cursor-help" title={absolute}>
            {relative}
          </span>
        </div>
        {entry.changes.length > 0 && (
          <div className="flex flex-col gap-1 mt-2 pl-3 border-l-2 border-[#e8e8e3]">
            {entry.changes.map((c, i) => (
              <FieldDiff key={i} {...c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuditHistoryTab({ entityType, entityId }: Props) {
  const { data, isLoading, isError } = useAuditHistory(entityType, entityId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 py-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 bg-[#efeeea] rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-8 text-center text-sm text-[#b91c1c]">
        Failed to load history. Please try again.
      </div>
    );
  }

  if (!data || data.entries.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-[#6b7280]">
        No history recorded yet.
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-[#6b7280] mb-4">{data.total} event{data.total !== 1 ? 's' : ''} recorded</p>
      <div>
        {data.entries.map((entry) => (
          <AuditEntryRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AuditHistoryTab.tsx
git commit -m "feat: add AuditHistoryTab component"
```

---

## Task 8: Frontend — History Tab on TripDetailPage

**Files:**
- Modify: `frontend/src/pages/TripDetailPage.tsx`

- [ ] **Step 1: Read TripDetailPage.tsx in full**

Read `frontend/src/pages/TripDetailPage.tsx`. Note:
- The `Tab` type definition line
- The `tabs` constant array line numbers
- The last tab content render block
- The existing lucide-react imports

- [ ] **Step 2: Add import for ClockIcon and AuditHistoryTab**

Add to the lucide-react import at the top of the file: `, ClockIcon` (or `ClockIcon` if not already imported).

Add after the last component import:
```tsx
import AuditHistoryTab from '../components/AuditHistoryTab';
```

- [ ] **Step 3: Add role check near the top of the component function**

After the first `useState` declarations inside the component, add:

```tsx
const currentUser = JSON.parse(localStorage.getItem('odip_user') || '{}');
const isAdmin = currentUser.role === 'Admin';
```

- [ ] **Step 4: Add 'history' to the Tab type**

Find: `type Tab = 'overview' | 'bookings' | ...`

Change to append `| 'history'` at the end.

- [ ] **Step 5: Add the History tab to the tabs array**

The `tabs` array is a `const` with entries like `{ key: 'overview', label: 'Overview', icon: HomeIcon }`. Add a conditional History entry at the end of the array:

```tsx
...(isAdmin ? [{ key: 'history' as Tab, label: 'History', icon: ClockIcon }] : []),
```

- [ ] **Step 6: Add History tab content**

After the last `{activeTab === '...' && <div>...</div>}` block, add:

```tsx
{activeTab === 'history' && isAdmin && trip && (
  <AuditHistoryTab entityType="TripInstance" entityId={String(trip.id)} />
)}
```

(Use `String(trip.id)` to handle whether `trip.id` is a number or string — check the type from context.)

- [ ] **Step 7: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors. Fix any type issues before committing.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/TripDetailPage.tsx
git commit -m "feat: add History tab to TripDetailPage (admin only)"
```

---

## Task 9: Frontend — History Tab on ParticipantDetailPage

**Files:**
- Modify: `frontend/src/pages/ParticipantDetailPage.tsx`

- [ ] **Step 1: Read ParticipantDetailPage.tsx in full**

Read `frontend/src/pages/ParticipantDetailPage.tsx`. Note:
- The `tab` state type definition
- The tab button render section
- The last tab content block
- How `participant.id` is typed

- [ ] **Step 2: Add imports**

Add to imports:
```tsx
import AuditHistoryTab from '../components/AuditHistoryTab';
```

- [ ] **Step 3: Add role check**

Near the top of the component function, after existing state declarations:

```tsx
const currentUser = JSON.parse(localStorage.getItem('odip_user') || '{}');
const isAdmin = currentUser.role === 'Admin';
```

- [ ] **Step 4: Add 'history' to the tab type**

Find the `tab` state type (e.g. `type tab = 'details' | 'bookings' | 'support'`) and add `| 'history'`.

- [ ] **Step 5: Add History tab button in the tab bar**

ParticipantDetailPage uses an underline tab pattern. Inside the tab button list, after the last tab button, add:

```tsx
{isAdmin && (
  <button
    onClick={() => setTab('history')}
    className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
      tab === 'history'
        ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
        : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
    }`}
  >
    History
  </button>
)}
```

- [ ] **Step 6: Add History tab content**

After the last tab content block, add:

```tsx
{tab === 'history' && isAdmin && participant && (
  <AuditHistoryTab entityType="Participant" entityId={String(participant.id)} />
)}
```

- [ ] **Step 7: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Run the full frontend build**

```bash
cd frontend && npm run build
```

Expected: build completes with no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/ParticipantDetailPage.tsx
git commit -m "feat: add History tab to ParticipantDetailPage (admin only)"
```

---

## Task 10: End-to-End Verification

- [ ] **Step 1: Start the API (applies migration automatically)**

```bash
dotnet run --project backend/Odip.Api
```

Confirm in logs: migration applied or "Database is up to date". The `AuditLogs` table should now exist.

- [ ] **Step 2: Start the frontend dev server**

In a separate terminal:
```bash
cd frontend && npm run dev
```

- [ ] **Step 3: Log in as Admin and open a Trip detail page**

Navigate to `http://localhost:5173`. Log in with an Admin account. Open any existing trip. Confirm a "History" tab appears in the pill tab bar.

- [ ] **Step 4: Verify a write creates an audit entry**

Edit the trip (e.g. change the trip name or status) and save. Click the "History" tab. Confirm one "Updated" entry appears showing the changed field(s) with old and new values, the actor name, and timestamp.

- [ ] **Step 5: Verify History tab is hidden for Coordinators**

Log out. Log in as a Coordinator. Open the same trip — confirm no "History" tab appears.

- [ ] **Step 6: Verify Participant history**

Log back in as Admin. Open a Participant detail page. Confirm History tab appears. Edit a participant field and save. Confirm the audit entry appears.

- [ ] **Step 7: Commit any verification fixes**

```bash
git add -A
git commit -m "fix: audit trail verification adjustments"
```

---

## Notes

- **IncidentReport and Staff audit tabs:** No `IncidentDetailPage` or `StaffDetailPage` exists. The interceptor captures changes to these entities and the API endpoint serves them — the UI tabs will be added when dedicated detail pages are built.
- **ParticipantBooking history:** Booking changes are captured. A per-booking history view (expandable row within the Trip Bookings tab) can be added as a future enhancement.
- **No FK on ChangedById:** Intentional — audit records must survive user deletion. `ChangedById` is stored as a plain `Guid?` for traceability only.
- **Migration pre-population:** The timestamp in Step 3 of Task 4 must match the exact filename generated by `dotnet ef migrations add`.
