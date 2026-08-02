# Qualification Expiry Dashboard — Design Spec

**Date:** 2026-03-27
**Status:** Approved

---

## Goal

Give coordinators and admins immediate visibility into staff qualification expiry issues — both at a glance on the dashboard and in a dedicated page where they can act on them directly.

## Architecture

### Backend

**New: `AppSettings` entity**
- Single-row table `AppSettings` with one column: `QualificationWarningDays` (int, default 30)
- Seeded on startup via `ALTER TABLE "AppSettings" ... INSERT ... ON CONFLICT DO NOTHING` in `Program.cs` (same pattern as expiry columns)
- No EF migration file needed

**New endpoints in `SettingsController`:**
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/v1/settings` | Admin, Coordinator | Returns `{ qualificationWarningDays: int }` |
| `PUT` | `/api/v1/settings` | Admin, Coordinator | Updates `qualificationWarningDays` |

`SupportWorker` role has no access to settings or qualifications pages.

**No changes to staff endpoints** — `GET /api/v1/staff` already returns all 4 expiry date fields and `HasExpiredQualifications`. The `PUT /api/v1/staff/{id}` endpoint is used as-is for inline edit saves.

### Frontend

**New files:**
- `frontend/src/pages/QualificationsPage.tsx` — filterable table of qualification issues
- `frontend/src/pages/SettingsPage.tsx` — warning threshold setting
- `frontend/src/api/settingsHooks.ts` — `useSettings()` and `useUpdateSettings()` hooks (or added to `hooks.ts`)

**Modified files:**
- `frontend/src/pages/DashboardPage.tsx` — add qualification metric tile
- `frontend/src/components/layout/AppLayout.tsx` — add nav links for Qualifications and Settings (Admin + Coordinator only)
- `frontend/src/App.tsx` (or router file) — add `/qualifications` and `/settings` routes

---

## Component Details

### Dashboard Metric Tile

Added as a 4th tile in the existing metrics grid on `DashboardPage`.

- **Count** = number of qualification issues (staff where any enabled qualification is expired OR expires within the warning threshold)
- **Red tile** (`#ffdad6` bg, `#ba1a1a` text) when count > 0
- **Neutral tile** (standard card style) when count = 0 — label "All Clear"
- Clicking the tile navigates to `/qualifications`
- Fetches `useSettings()` and `useStaff({ isActive: true })` — filtering done client-side

### Qualifications Page (`/qualifications`)

**Header:**
- Page title: "Staff Qualification Expiry"
- Filter tabs: `All issues` · `Expired` · `Expiring soon` (filter the visible rows)

**Table — one row per qualification issue:**

| Column | Content |
|--------|---------|
| Staff | Full name |
| Qualification | "First Aid" / "Driver Licence" / "Manual Handling" / "Medication Competency" |
| Expiry Date | Date string (or date input when editing) |
| Status | Badge: `EXPIRED` (red) / `N days` (amber) / `No date set` (grey, soft warning) |
| Actions | Edit button → inline Save/Cancel |

**Filtering logic:**
- Only show rows for qualifications where the staff member's flag is `true` (e.g. `IsFirstAidQualified`)
- Show row if: expiry date is in the past (expired), OR expiry date is within `qualificationWarningDays` of today, OR flag is true but expiry date is null ("No date set")
- Default sort: expired first, then by days remaining ascending

**Inline edit:**
- Edit button replaces the Expiry Date cell with `<input type="date">`
- Save calls `PUT /api/v1/staff/{id}` with the full staff payload (only the edited expiry field changed)
- On success: invalidate `['staff']` query, close edit state
- On error: show inline error message on the row, keep edit state open for retry
- Cancel: discard changes, close edit state

**Empty state:**
- When no issues found: "All qualifications are current ✓" with green styling

### Settings Page (`/settings`)

- Single labelled control: "Qualification warning window"
- Dropdown options: 7 days / 14 days / 30 days / 60 days / 90 days
- Save button: calls `PUT /api/v1/settings`, shows success toast on completion
- On load: calls `GET /api/v1/settings` to populate current value

---

## Data Flow

```
DashboardPage
  → useSettings()          GET /api/v1/settings  → { qualificationWarningDays }
  → useStaff({ isActive }) GET /api/v1/staff      → StaffListDto[]
  → filter client-side → count issues → render tile

QualificationsPage
  → useSettings()          GET /api/v1/settings  → { qualificationWarningDays }
  → useStaff({ isActive }) GET /api/v1/staff      → StaffListDto[]
  → filter + flatten to rows → render table
  → on Save: PUT /api/v1/staff/{id} → invalidate ['staff']

SettingsPage
  → useSettings()          GET /api/v1/settings  → { qualificationWarningDays }
  → on Save: useUpdateSettings() PUT /api/v1/settings → invalidate ['settings']
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| `GET /api/v1/settings` fails | Default to 30 days client-side; no error shown (non-critical) |
| Inline save (`PUT /api/v1/staff/{id}`) fails | Inline error on the row; edit state stays open for retry |
| Staff has qualification flag = true, no expiry date | Show as "No date set" row (grey badge), not an error |
| Staff has qualification flag = false | Qualification row not shown regardless of expiry date |

---

## Access Control

| Role | Dashboard tile | Qualifications page | Settings page |
|------|---------------|--------------------|----|
| Admin | ✓ | ✓ | ✓ |
| Coordinator | ✓ | ✓ | ✓ |
| SupportWorker | ✗ | ✗ | ✗ |

---

## Out of Scope

- Email or push notifications for expiry (separate feature)
- Per-user threshold preferences (shared threshold is sufficient for a team tool)
- Audit log for expiry date changes
- Bulk edit of multiple staff expiry dates at once
