# Qualification Expiry Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a qualification expiry dashboard — a clickable metric tile on the dashboard, a dedicated Qualifications page with inline edit, and a configurable warning threshold in Settings.

**Architecture:** Backend adds an `AppSettings` entity (single-row table, seeded via raw SQL in `Program.cs`) and a `SettingsController` with GET/PUT. Frontend adds `useSettings`/`useUpdateSettings` hooks, a new "Qualification Warnings" tab on the existing Settings page, a new `QualificationsPage` (filterable table + inline edit via existing staff PUT endpoint), a nav link, and a clickable metric tile on `DashboardPage`.

**Tech Stack:** .NET 9, EF Core 8, PostgreSQL (raw SQL schema seeding); React 19, TypeScript, TanStack Query v5, Tailwind CSS v4, React Router v6

---

## File Map

| File | Change |
|------|--------|
| `backend/Odip.Domain/Entities/AppSettings.cs` | **Create** — single-row settings entity |
| `backend/Odip.Infrastructure/Data/OdipDbContext.cs` | **Modify** — add `DbSet<AppSettings>` |
| `backend/Odip.Api/Program.cs` | **Modify** — add CREATE TABLE + INSERT seed SQL |
| `backend/Odip.Application/DTOs/DTOs.cs` | **Modify** — add `AppSettingsDto`, `UpdateAppSettingsDto`; add `Notes` to `StaffListDto`; remove `Notes` from `StaffDetailDto` (inherits from base) |
| `backend/Odip.Api/Controllers/VehiclesStaffController.cs` | **Modify** — map `Notes` in `StaffController.GetAll` |
| `backend/Odip.Api/Controllers/SettingsController.cs` | **Create** — GET + PUT `/api/v1/settings` |
| `frontend/src/api/hooks.ts` | **Modify** — add `useSettings`, `useUpdateSettings` |
| `frontend/src/pages/SettingsPage.tsx` | **Modify** — add "Qualification Warnings" tab |
| `frontend/src/pages/QualificationsPage.tsx` | **Create** — filterable table + inline edit |
| `frontend/src/App.tsx` | **Modify** — add `/qualifications` route |
| `frontend/src/components/layout/AppLayout.tsx` | **Modify** — add Qualifications nav item |
| `frontend/src/pages/DashboardPage.tsx` | **Modify** — add qualification metric tile |

---

## Task 1: Backend — AppSettings entity, seeding, and SettingsController

**Files:**
- Create: `backend/Odip.Domain/Entities/AppSettings.cs`
- Modify: `backend/Odip.Infrastructure/Data/OdipDbContext.cs`
- Modify: `backend/Odip.Api/Program.cs`
- Modify: `backend/Odip.Application/DTOs/DTOs.cs`
- Modify: `backend/Odip.Api/Controllers/VehiclesStaffController.cs`
- Create: `backend/Odip.Api/Controllers/SettingsController.cs`

---

- [ ] **Step 1: Create the AppSettings entity**

Create `backend/Odip.Domain/Entities/AppSettings.cs`:

```csharp
using System.ComponentModel.DataAnnotations.Schema;

namespace Odip.Domain.Entities;

public class AppSettings
{
    /// <summary>Always 1 — this is a single-row settings table.</summary>
    [DatabaseGenerated(DatabaseGeneratedOption.None)]
    public int Id { get; set; }

    public int QualificationWarningDays { get; set; } = 30;
}
```

- [ ] **Step 2: Add DbSet to OdipDbContext**

In `backend/Odip.Infrastructure/Data/OdipDbContext.cs`, add one line after the `IncidentReports` DbSet (line 35):

```csharp
    public DbSet<IncidentReport> IncidentReports => Set<IncidentReport>();
    public DbSet<AppSettings> AppSettings => Set<AppSettings>();   // ← add this
```

- [ ] **Step 3: Add SQL seeding to Program.cs**

In `backend/Odip.Api/Program.cs`, add the following block immediately after the existing Staff `ALTER TABLE` block (after line 172, before the `await DbSeeder.SeedAsync(db);` call):

```csharp
    await db.Database.ExecuteSqlRawAsync(
        """
        CREATE TABLE IF NOT EXISTS "AppSettings" (
            "Id" integer NOT NULL,
            "QualificationWarningDays" integer NOT NULL DEFAULT 30,
            CONSTRAINT "PK_AppSettings" PRIMARY KEY ("Id")
        );
        INSERT INTO "AppSettings" ("Id", "QualificationWarningDays")
        VALUES (1, 30)
        ON CONFLICT ("Id") DO NOTHING;
        """);
```

- [ ] **Step 4: Add DTOs and move Notes to StaffListDto**

In `backend/Odip.Application/DTOs/DTOs.cs`:

**4a.** Add `Notes` to `StaffListDto` (after the `HasExpiredQualifications` property on line 548):

```csharp
    public bool HasExpiredQualifications { get; init; }
    public string? Notes { get; init; }   // ← add this
```

**4b.** Remove `Notes` from `StaffDetailDto` — it now inherits it from `StaffListDto`. Change:

```csharp
public record StaffDetailDto : StaffListDto
{
    public string? Notes { get; init; }
}
```

to:

```csharp
public record StaffDetailDto : StaffListDto { }
```

**4c.** Add `AppSettingsDto` and `UpdateAppSettingsDto` after the staff DTOs section (after line 582 `public record UpdateStaffDto : CreateStaffDto { }`):

```csharp
// ══════════════════════════════════════════════════════════════
// APP SETTINGS DTOs
// ══════════════════════════════════════════════════════════════

public record AppSettingsDto
{
    public int QualificationWarningDays { get; init; }
}

public record UpdateAppSettingsDto
{
    [System.ComponentModel.DataAnnotations.Range(1, 365)]
    public int QualificationWarningDays { get; init; }
}
```

- [ ] **Step 5: Map Notes in StaffController.GetAll**

In `backend/Odip.Api/Controllers/VehiclesStaffController.cs`, find the `GetAll` LINQ projection for `StaffController` (around line 200). Add `Notes = s.Notes,` after the `MedicationCompetencyExpiryDate` line:

```csharp
                MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
                Notes = s.Notes,     // ← add this
                HasExpiredQualifications =
```

- [ ] **Step 6: Create SettingsController**

Create `backend/Odip.Api/Controllers/SettingsController.cs`:

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize(Roles = "Admin,Coordinator")]
[Route("api/v1/settings")]
public class SettingsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public SettingsController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<AppSettingsDto>>> Get(CancellationToken ct)
    {
        var s = await _db.AppSettings.FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<AppSettingsDto>.Ok(new AppSettingsDto
        {
            QualificationWarningDays = s?.QualificationWarningDays ?? 30
        }));
    }

    [HttpPut]
    public async Task<ActionResult<ApiResponse<AppSettingsDto>>> Update(
        [FromBody] UpdateAppSettingsDto dto, CancellationToken ct)
    {
        var s = await _db.AppSettings.FirstOrDefaultAsync(ct);
        if (s == null)
        {
            s = new AppSettings { Id = 1, QualificationWarningDays = dto.QualificationWarningDays };
            _db.AppSettings.Add(s);
        }
        else
        {
            s.QualificationWarningDays = dto.QualificationWarningDays;
        }
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<AppSettingsDto>.Ok(new AppSettingsDto
        {
            QualificationWarningDays = s.QualificationWarningDays
        }));
    }
}
```

- [ ] **Step 7: Build the backend**

Run:
```bash
dotnet build backend/Odip.Api
```

Expected: `Build succeeded. 0 Warning(s). 0 Error(s).`

If errors appear, fix them before continuing.

- [ ] **Step 8: Commit**

```bash
git add backend/Odip.Domain/Entities/AppSettings.cs \
        backend/Odip.Infrastructure/Data/OdipDbContext.cs \
        backend/Odip.Api/Program.cs \
        backend/Odip.Application/DTOs/DTOs.cs \
        backend/Odip.Api/Controllers/VehiclesStaffController.cs \
        backend/Odip.Api/Controllers/SettingsController.cs
git commit -m "feat: add AppSettings entity, seeding, and SettingsController"
```

---

## Task 2: Frontend — useSettings and useUpdateSettings hooks

**Files:**
- Modify: `frontend/src/api/hooks.ts`

---

- [ ] **Step 1: Add hooks to hooks.ts**

In `frontend/src/api/hooks.ts`, append the following two functions at the end of the file (after all existing exports):

```typescript
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      apiClient
        .get<ApiResponse<{ qualificationWarningDays: number }>>('/settings')
        .then(r => r.data.data ?? { qualificationWarningDays: 30 }),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { qualificationWarningDays: number }) =>
      apiClient.put('/settings', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
cd frontend && npm run build
```

Expected: build completes with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/hooks.ts
git commit -m "feat: add useSettings and useUpdateSettings hooks"
```

---

## Task 3: Frontend — Settings page qualification tab

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`

---

- [ ] **Step 1: Replace SettingsPage.tsx with the updated version**

The existing `SettingsPage.tsx` has two tabs: `templates` and `activities`. Add a third tab `qualifications`. Replace the entire file:

```tsx
import { useEventTemplates, useActivities, useSettings, useUpdateSettings } from '@/api/hooks'
import { useState, useEffect } from 'react'

function QualificationSettingsTab() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const [warningDays, setWarningDays] = useState<number>(30)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) setWarningDays(settings.qualificationWarningDays)
  }, [settings])

  function handleSave() {
    updateSettings.mutate({ qualificationWarningDays: warningDays }, {
      onSuccess: () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      },
    })
  }

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h2 className="font-semibold text-[var(--color-foreground)] mb-1">Qualification Warning Window</h2>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
          Staff qualifications expiring within this window will appear as warnings on the
          Qualifications page and Dashboard.
        </p>
        <select
          value={warningDays}
          onChange={e => setWarningDays(Number(e.target.value))}
          className="w-full border border-[var(--color-border)] rounded-xl px-4 py-2.5 text-sm bg-[var(--color-card)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        >
          {[7, 14, 30, 60, 90].map(d => (
            <option key={d} value={d}>{d} days</option>
          ))}
        </select>
      </div>
      <button
        onClick={handleSave}
        disabled={updateSettings.isPending}
        className="px-6 py-2.5 bg-[var(--color-primary)] text-white rounded-full font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {updateSettings.isPending ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}

export default function SettingsPage() {
  const [tab, setTab] = useState<'templates' | 'activities' | 'qualifications'>('templates')
  const { data: templates = [] } = useEventTemplates()
  const { data: activities = [] } = useActivities()

  const tabs = [
    { key: 'templates' as const, label: 'Event Templates' },
    { key: 'activities' as const, label: 'Activity Library' },
    { key: 'qualifications' as const, label: 'Qualification Warnings' },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Manage event templates, activity library, and qualification settings
        </p>
      </div>

      <div className="flex gap-4 border-b border-[var(--color-border)]">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'border-transparent text-[var(--color-muted-foreground)]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'templates' && (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((t: any) => (
            <div key={t.id} className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold">{t.eventName}</h3>
                  <span className="text-xs text-[var(--color-muted-foreground)] font-mono">{t.eventCode}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${t.isActive ? 'badge-confirmed' : 'badge-cancelled'}`}>
                  {t.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="text-sm text-[var(--color-muted-foreground)] space-y-1">
                <p>📍 {t.defaultDestination || '—'} · {t.defaultRegion || '—'}</p>
                {t.standardDurationDays && <p>⏱ {t.standardDurationDays} days</p>}
                {t.preferredTimeOfYear && <p>📅 {t.preferredTimeOfYear}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'activities' && (
        <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-accent)]">
              <tr>
                <th className="text-left p-3 font-medium text-[var(--color-muted-foreground)]">Activity</th>
                <th className="text-left p-3 font-medium text-[var(--color-muted-foreground)]">Category</th>
                <th className="text-left p-3 font-medium text-[var(--color-muted-foreground)]">Location</th>
                <th className="text-left p-3 font-medium text-[var(--color-muted-foreground)]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {activities.map((a: any) => (
                <tr key={a.id} className="hover:bg-[var(--color-accent)]/50 transition-colors">
                  <td className="p-3 font-medium">{a.activityName}</td>
                  <td className="p-3 text-[var(--color-muted-foreground)]">{a.category}</td>
                  <td className="p-3 text-[var(--color-muted-foreground)]">{a.location || '—'}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${a.isActive ? 'badge-confirmed' : 'badge-cancelled'}`}>
                      {a.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'qualifications' && <QualificationSettingsTab />}
    </div>
  )
}
```

- [ ] **Step 2: Build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx
git commit -m "feat: add qualification warning threshold tab to Settings page"
```

---

## Task 4: Frontend — QualificationsPage, route, and nav link

**Files:**
- Create: `frontend/src/pages/QualificationsPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/AppLayout.tsx`

---

- [ ] **Step 1: Create QualificationsPage.tsx**

Create `frontend/src/pages/QualificationsPage.tsx`:

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStaff, useSettings, useUpdateStaff } from '@/api/hooks'

type QualStatus = 'expired' | 'expiring' | 'no-date'
type FilterTab = 'all' | 'expired' | 'expiring' | 'no-date'

interface QualRow {
  key: string
  staffId: string
  staffName: string
  qualification: string
  fieldKey: string
  expiryDate: string | null
  daysUntilExpiry: number | null
  status: QualStatus
}

const QUALS = [
  { label: 'First Aid', flag: 'isFirstAidQualified', field: 'firstAidExpiryDate' },
  { label: 'Driver Licence', flag: 'isDriverEligible', field: 'driverLicenceExpiryDate' },
  { label: 'Manual Handling', flag: 'isManualHandlingCompetent', field: 'manualHandlingExpiryDate' },
  { label: 'Medication Competency', flag: 'isMedicationCompetent', field: 'medicationCompetencyExpiryDate' },
] as const

function buildRows(staff: any[], warningDays: number): QualRow[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const rows: QualRow[] = []

  for (const s of staff) {
    for (const q of QUALS) {
      if (!s[q.flag]) continue
      const expiryDate = s[q.field] as string | null
      if (!expiryDate) {
        rows.push({
          key: `${s.id}-${q.field}`, staffId: s.id, staffName: s.fullName,
          qualification: q.label, fieldKey: q.field,
          expiryDate: null, daysUntilExpiry: null, status: 'no-date',
        })
        continue
      }
      const expiry = new Date(expiryDate)
      expiry.setHours(0, 0, 0, 0)
      const diff = Math.floor((expiry.getTime() - today.getTime()) / 86400000)
      if (diff < 0) {
        rows.push({
          key: `${s.id}-${q.field}`, staffId: s.id, staffName: s.fullName,
          qualification: q.label, fieldKey: q.field,
          expiryDate, daysUntilExpiry: diff, status: 'expired',
        })
      } else if (diff <= warningDays) {
        rows.push({
          key: `${s.id}-${q.field}`, staffId: s.id, staffName: s.fullName,
          qualification: q.label, fieldKey: q.field,
          expiryDate, daysUntilExpiry: diff, status: 'expiring',
        })
      }
      // Beyond warningDays: not shown
    }
  }

  // Sort: expired first, then by days remaining ascending, then no-date last
  rows.sort((a, b) => {
    if (a.status === 'expired' && b.status !== 'expired') return -1
    if (a.status !== 'expired' && b.status === 'expired') return 1
    if (a.daysUntilExpiry === null) return 1
    if (b.daysUntilExpiry === null) return -1
    return a.daysUntilExpiry - b.daysUntilExpiry
  })
  return rows
}

function getStatusBadge(row: QualRow): { label: string; cls: string } {
  if (row.status === 'expired') return { label: 'EXPIRED', cls: 'badge-cancelled' }
  if (row.status === 'no-date') return { label: 'No date set', cls: 'badge-draft' }
  const days = row.daysUntilExpiry!
  const label = days === 0 ? 'Expires today' : `${days} day${days === 1 ? '' : 's'}`
  return { label, cls: 'badge-pending' }
}

export default function QualificationsPage() {
  const { data: settings } = useSettings()
  const { data: allStaff = [], isLoading } = useStaff({ isActive: 'true' })
  const updateStaff = useUpdateStaff()

  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const warningDays = settings?.qualificationWarningDays ?? 30
  const rows = buildRows(allStaff, warningDays)
  const filteredRows = filterTab === 'all' ? rows : rows.filter(r => r.status === filterTab)

  const counts = {
    all: rows.length,
    expired: rows.filter(r => r.status === 'expired').length,
    expiring: rows.filter(r => r.status === 'expiring').length,
    'no-date': rows.filter(r => r.status === 'no-date').length,
  }

  function handleEdit(row: QualRow) {
    setEditingKey(row.key)
    setEditValue(row.expiryDate ?? '')
    setSaveError(null)
  }

  function handleSave(row: QualRow) {
    const s = allStaff.find((m: any) => m.id === row.staffId)
    if (!s) return

    const payload = {
      firstName: s.firstName,
      lastName: s.lastName,
      role: s.role,
      email: s.email,
      mobile: s.mobile,
      region: s.region,
      isDriverEligible: s.isDriverEligible,
      isFirstAidQualified: s.isFirstAidQualified,
      isMedicationCompetent: s.isMedicationCompetent,
      isManualHandlingCompetent: s.isManualHandlingCompetent,
      isOvernightEligible: s.isOvernightEligible,
      isActive: s.isActive,
      notes: s.notes,
      firstAidExpiryDate: s.firstAidExpiryDate,
      driverLicenceExpiryDate: s.driverLicenceExpiryDate,
      manualHandlingExpiryDate: s.manualHandlingExpiryDate,
      medicationCompetencyExpiryDate: s.medicationCompetencyExpiryDate,
      [row.fieldKey]: editValue || null,
    }

    updateStaff.mutate({ id: row.staffId, data: payload }, {
      onSuccess: () => { setEditingKey(null); setSaveError(null) },
      onError: () => setSaveError('Failed to save. Please try again.'),
    })
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: `All Issues (${counts.all})` },
    { key: 'expired', label: `Expired (${counts.expired})` },
    { key: 'expiring', label: `Expiring Soon (${counts.expiring})` },
    { key: 'no-date', label: `No Date Set (${counts['no-date']})` },
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Staff Qualification Expiry</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Warning window: {warningDays} days —{' '}
          <Link to="/settings" className="text-[var(--color-primary)] hover:underline">
            change in Settings
          </Link>
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-4 border-b border-[var(--color-border)] overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setFilterTab(t.key)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              filterTab === t.key
                ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'border-transparent text-[var(--color-muted-foreground)]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {filteredRows.length === 0 ? (
        <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-12 text-center">
          <p className="text-3xl mb-3">✓</p>
          <p className="font-semibold text-[var(--color-foreground)]">All qualifications are current</p>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            No issues found within the {warningDays}-day warning window
          </p>
        </div>
      ) : (
        <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-accent)]">
              <tr>
                <th className="text-left p-4 font-medium text-[var(--color-muted-foreground)]">Staff</th>
                <th className="text-left p-4 font-medium text-[var(--color-muted-foreground)]">Qualification</th>
                <th className="text-left p-4 font-medium text-[var(--color-muted-foreground)]">Expiry Date</th>
                <th className="text-left p-4 font-medium text-[var(--color-muted-foreground)]">Status</th>
                <th className="p-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filteredRows.map(row => {
                const isEditing = editingKey === row.key
                const badge = getStatusBadge(row)
                return (
                  <tr key={row.key}
                    className={`hover:bg-[var(--color-accent)]/50 transition-colors ${
                      row.status === 'expired'
                        ? 'bg-[#ffdad6]/10'
                        : row.status === 'expiring'
                        ? 'bg-[#fef3c7]/10'
                        : ''
                    }`}>
                    <td className="p-4 font-medium">{row.staffName}</td>
                    <td className="p-4 text-[var(--color-muted-foreground)]">{row.qualification}</td>
                    <td className="p-4">
                      {isEditing ? (
                        <div className="space-y-1">
                          <input
                            type="date"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            className="border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                          />
                          {saveError && (
                            <p className="text-xs text-[#ba1a1a]">{saveError}</p>
                          )}
                        </div>
                      ) : (
                        <span>{row.expiryDate ?? '—'}</span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      {isEditing ? (
                        <div className="flex items-center gap-3 justify-end">
                          <button
                            onClick={() => handleSave(row)}
                            disabled={updateStaff.isPending}
                            className="text-xs font-semibold text-[var(--color-primary)] hover:underline disabled:opacity-50"
                          >
                            {updateStaff.isPending ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditingKey(null); setSaveError(null) }}
                            className="text-xs text-[var(--color-muted-foreground)] hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEdit(row)}
                          className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the /qualifications route to App.tsx**

In `frontend/src/App.tsx`:

**Add import** (after the `SettingsPage` import on line 24):
```tsx
import QualificationsPage from './pages/QualificationsPage'
```

**Add route** (after the `/settings` route on line 72):
```tsx
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/qualifications" element={<QualificationsPage />} />   {/* ← add */}
```

- [ ] **Step 3: Add Qualifications nav item to AppLayout.tsx**

In `frontend/src/components/layout/AppLayout.tsx`, the `navItems` array already has `/settings`. Add a Qualifications entry before Settings:

```typescript
const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', msIcon: 'dashboard' },
  { to: '/trips', icon: Map, label: 'Trips', msIcon: 'map' },
  { to: '/schedule', icon: CalendarRange, label: 'Schedule', msIcon: 'calendar_month' },
  { to: '/participants', icon: Users, label: 'Participants', msIcon: 'group' },
  { to: '/accommodation', icon: Building2, label: 'Accommodation', msIcon: 'home_work' },
  { to: '/vehicles', icon: Truck, label: 'Vehicles', msIcon: 'directions_car' },
  { to: '/staff', icon: UserCog, label: 'Staff', msIcon: 'manage_accounts' },
  { to: '/tasks', icon: ListChecks, label: 'Tasks', msIcon: 'checklist' },
  { to: '/incidents', icon: AlertTriangle, label: 'Incidents', msIcon: 'emergency' },
  { to: '/bookings', icon: ClipboardList, label: 'Bookings', msIcon: 'description' },
  { to: '/qualifications', icon: Settings, label: 'Qualifications', msIcon: 'health_and_safety' },  // ← add
  { to: '/settings', icon: Settings, label: 'Settings', msIcon: 'settings' },
]
```

Note: `icon` is not used in the sidebar (the sidebar renders `msIcon` via `material-symbols-outlined`), so reusing `Settings` for the icon field is fine.

- [ ] **Step 4: Build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/QualificationsPage.tsx \
        frontend/src/App.tsx \
        frontend/src/components/layout/AppLayout.tsx
git commit -m "feat: add QualificationsPage with inline edit, route, and nav link"
```

---

## Task 5: Frontend — Dashboard qualification metric tile

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`

---

- [ ] **Step 1: Add useSettings and useStaff imports**

In `frontend/src/pages/DashboardPage.tsx`, the first line currently imports only `useDashboard`:

```tsx
import { useDashboard } from '@/api/hooks'
```

Change to:

```tsx
import { useDashboard, useSettings, useStaff } from '@/api/hooks'
```

Also add `Link` to the react-router-dom import (it already imports `Link` — verify it's there, add if missing):

```tsx
import { Link } from 'react-router-dom'
```

- [ ] **Step 2: Add qualification issue count computation inside DashboardPage**

Inside the `DashboardPage` function, after the existing `const d = data || { ... }` block, add:

```tsx
  const { data: settings } = useSettings()
  const { data: allStaff = [] } = useStaff({ isActive: 'true' })

  const warningDays = settings?.qualificationWarningDays ?? 30
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const qualIssueCount = (allStaff as any[]).reduce((count: number, s: any) => {
    const checks = [
      { flag: s.isFirstAidQualified, expiry: s.firstAidExpiryDate },
      { flag: s.isDriverEligible, expiry: s.driverLicenceExpiryDate },
      { flag: s.isManualHandlingCompetent, expiry: s.manualHandlingExpiryDate },
      { flag: s.isMedicationCompetent, expiry: s.medicationCompetencyExpiryDate },
    ]
    return count + checks.filter(({ flag, expiry }) => {
      if (!flag) return false
      if (!expiry) return true  // no date set counts as an issue
      const diff = Math.floor((new Date(expiry).getTime() - today.getTime()) / 86400000)
      return diff <= warningDays
    }).length
  }, 0)
```

- [ ] **Step 3: Add the metric tile to the bento grid**

In the bento grid section (after the "Outstanding Tasks" tile ending around line 115), add the qualification tile. Insert it after the closing `</div>` of the Outstanding Tasks tile and before the `{/* Small alert cards */}` comment:

```tsx
        {/* Qualification Issues */}
        <Link
          to="/qualifications"
          className={`col-span-2 lg:col-span-2 p-6 rounded-[2rem] flex flex-col justify-between hover:opacity-90 transition-opacity ${
            qualIssueCount > 0
              ? 'bg-[#ffdad6]/30 border border-[#ba1a1a]/20'
              : 'bg-[var(--color-surface-container-low)]'
          }`}
        >
          <p className={`text-sm mb-1 font-medium ${qualIssueCount > 0 ? 'text-[#ba1a1a]' : 'text-[var(--color-muted-foreground)]'}`}>
            Qualification Issues
          </p>
          <p className={`text-3xl font-display font-bold ${qualIssueCount > 0 ? 'text-[#ba1a1a]' : 'text-[var(--color-primary)]'}`}>
            {qualIssueCount > 0 ? qualIssueCount : '✓'}
          </p>
          {qualIssueCount === 0 && (
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">All clear</p>
          )}
        </Link>
```

- [ ] **Step 4: Build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx
git commit -m "feat: add qualification issues metric tile to dashboard"
```

---

## Final Verification

After all tasks are committed, do a full build of both backend and frontend:

```bash
# Backend
dotnet build backend/Odip.Api
# Expected: Build succeeded. 0 Warning(s). 0 Error(s).

# Frontend
cd frontend && npm run build && npm run lint
# Expected: no errors
```

Manual smoke test checklist:
- [ ] `GET /api/v1/settings` returns `{ qualificationWarningDays: 30 }` on first call
- [ ] `PUT /api/v1/settings` with `{ qualificationWarningDays: 14 }` updates the value
- [ ] `/qualifications` page loads, shows rows for staff with expiring/expired qualifications
- [ ] Inline edit on a row: click Edit → date input appears → change date → Save → row updates
- [ ] Dashboard tile shows correct count, clicking it navigates to `/qualifications`
- [ ] Settings page → Qualification Warnings tab → change dropdown → Save → Dashboard reflects new threshold
