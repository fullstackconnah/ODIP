# Shared Dropdown Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a single reusable `Dropdown` component and replace every native `<select>` and custom dropdown menu across the frontend with it.

**Architecture:** One component (`frontend/src/components/Dropdown.tsx`) with three variants (`pill`, `form`, `menu`) sharing open/close state, click-outside handling, keyboard navigation, and a floating panel. Call sites are updated file-by-file after the component is proven to build cleanly.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Lucide React icons, react-hook-form v7 (`<Controller>` for form variant), Vite + tsc for build verification.

**Note on testing:** This project has no test framework configured. Verification is via `npm run build` (TypeScript + Vite) from `frontend/`. Run this after every task. The build must pass with zero errors before committing.

**Spec:** `docs/superpowers/specs/2026-03-25-dropdown-component-design.md`

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| **Create** | `frontend/src/components/Dropdown.tsx` | Shared component — all variants |
| **Modify** | `frontend/src/components/ItineraryTab.tsx` | Replace Export button → `variant="menu"` |
| **Modify** | `frontend/src/pages/TripDetailPage.tsx` | Replace booking status + insurance selects → `variant="pill"`; edit modal selects → `variant="form"` |
| **Modify** | `frontend/src/pages/SchedulePage.tsx` | Replace Assignment Role + Sleepover Type selects → `variant="form"` |
| **Modify** | `frontend/src/pages/TripCreatePage.tsx` | Replace Event Template, Status, Lead Coordinator selects → `variant="form"` with `<Controller>` |
| **Modify** | `frontend/src/components/AddActivityModal.tsx` | Replace Activity Library + Status selects → `variant="form"` |
| **Modify** | `frontend/src/pages/TripsPage.tsx` | Replace edit modal selects → `variant="form"` |

**Not in scope:** The status filter `<select>` in `TripsPage.tsx` (lines ~164-168, wrapped in a `<Filter>` icon overlay) — this is a filter control, not a dropdown field.

---

## Task 1: Create the Dropdown component

**Files:**
- Create: `frontend/src/components/Dropdown.tsx`

- [ ] **Step 1: Create the file with the complete implementation**

```tsx
import { useState, useRef, useEffect } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export type DropdownItem = {
  value: string
  label: string
  icon?: ReactNode
  description?: string
  disabled?: boolean
}

type DropdownProps = {
  variant: 'pill' | 'form' | 'menu'
  items: DropdownItem[]

  // Value control — pill and form variants
  value?: string
  onChange?: (value: string) => void
  // Menu variant: fires on item selection, no tracked value
  onSelect?: (value: string) => void
  // Form variant: forward field.onBlur from RHF Controller
  onBlur?: () => void

  // Trigger appearance
  label?: string            // button text (menu), placeholder text (form)
  icon?: ReactNode          // leading icon on trigger (menu variant)
  colorClass?: string       // Tailwind color classes for pill trigger background
  disabled?: boolean        // caller controls — not auto-applied on empty items
  loading?: boolean

  // Panel alignment — default varies by variant: pill='right', form='left', menu='right'
  align?: 'left' | 'right'
}

export function Dropdown({
  variant,
  items,
  value,
  onChange,
  onSelect,
  onBlur,
  label,
  icon,
  colorClass = '',
  disabled = false,
  loading = false,
  align,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Per-variant default alignment
  const resolvedAlign = align ?? (variant === 'form' ? 'left' : 'right')

  // Click-outside: close and fire onBlur
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setFocusedIndex(-1)
        onBlur?.()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onBlur])

  const handleSelect = (item: DropdownItem) => {
    if (item.disabled) return
    if (variant === 'menu') {
      onSelect?.(item.value)
    } else {
      onChange?.(item.value)
      onBlur?.()
    }
    setOpen(false)
    setFocusedIndex(-1)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || loading) return

    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setOpen(true)
        // Start focus on first non-disabled item
        const first = items.findIndex(i => !i.disabled)
        setFocusedIndex(first >= 0 ? first : 0)
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setFocusedIndex(-1)
      onBlur?.()
      triggerRef.current?.focus()
      return
    }
    if (e.key === 'Tab') {
      // Do NOT preventDefault — let Tab move focus naturally
      setOpen(false)
      setFocusedIndex(-1)
      onBlur?.()
      return
    }

    // Arrow keys skip disabled items
    const enabledIndices = items
      .map((item, i) => (item.disabled ? -1 : i))
      .filter(i => i !== -1)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const pos = enabledIndices.indexOf(focusedIndex)
      const next = enabledIndices[(pos + 1) % enabledIndices.length]
      setFocusedIndex(next ?? 0)
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const pos = enabledIndices.indexOf(focusedIndex)
      const prev = enabledIndices[(pos - 1 + enabledIndices.length) % enabledIndices.length]
      setFocusedIndex(prev ?? 0)
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const focused = items[focusedIndex]
      if (focused && !focused.disabled) handleSelect(focused)
    }
  }

  const selectedLabel = items.find(i => i.value === value)?.label

  // Chevron / loading spinner
  const chevron =
    loading && variant !== 'menu' ? (
      <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" />
    ) : (
      <ChevronDown
        className={`w-3.5 h-3.5 transition-transform duration-200 shrink-0 ${open ? 'rotate-180' : ''}`}
      />
    )

  // Floating panel
  const panelAlignClass = resolvedAlign === 'left' ? 'left-0' : 'right-0'
  const panelWidthClass =
    variant === 'form' ? 'w-full' : variant === 'pill' ? 'min-w-[10rem]' : 'w-56'

  const panel = open && (
    <div
      role="listbox"
      className={`absolute top-full mt-2 bg-white rounded-2xl shadow-[0_24px_40px_-12px_rgba(27,28,26,0.14)] overflow-hidden z-50 ${panelAlignClass} ${panelWidthClass}`}
    >
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[#43493a] opacity-50">No options available</p>
      ) : (
        items.map((item, idx) => (
          <div key={item.value}>
            {/* Divider between menu items that carry a description */}
            {variant === 'menu' && idx > 0 && item.description && (
              <div className="h-px bg-[rgba(195,201,181,0.25)] mx-4" />
            )}
            <button
              role="option"
              aria-selected={item.value === value}
              aria-disabled={item.disabled ? 'true' : undefined}
              onClick={() => handleSelect(item)}
              onMouseEnter={() => !item.disabled && setFocusedIndex(idx)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-[#1b1c1a] text-left transition-colors ${
                item.disabled
                  ? 'opacity-40 cursor-not-allowed'
                  : focusedIndex === idx
                  ? 'bg-[#f5f3ef]'
                  : 'hover:bg-[#f5f3ef]'
              }`}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              <div className="min-w-0">
                <p className={item.description ? 'font-semibold' : ''}>{item.label}</p>
                {item.description && (
                  <p className="text-[11px] text-[#43493a]">{item.description}</p>
                )}
              </div>
            </button>
          </div>
        ))
      )}
    </div>
  )

  // ── pill variant ──────────────────────────────────────────────────────────
  if (variant === 'pill') {
    return (
      <div className="relative inline-flex items-center" ref={containerRef}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled || loading}
          onClick={() => setOpen(v => !v)}
          onKeyDown={handleKeyDown}
          className={`text-xs pl-2.5 pr-6 py-1 rounded-full font-medium cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-[#396200]/25 hover:shadow-[0_0_0_2px_rgba(57,98,0,0.18)] disabled:opacity-60 disabled:pointer-events-none ${colorClass}`}
        >
          {selectedLabel ?? label ?? '—'}
        </button>
        <span className="absolute right-1.5 pointer-events-none opacity-60">
          {chevron}
        </span>
        {panel}
      </div>
    )
  }

  // ── form variant ──────────────────────────────────────────────────────────
  if (variant === 'form') {
    return (
      <div className="relative w-full" ref={containerRef}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled || loading}
          onClick={() => setOpen(v => !v)}
          onKeyDown={handleKeyDown}
          className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#396200]/25 hover:shadow-[0_0_0_2px_rgba(57,98,0,0.18)] transition-all disabled:opacity-60 disabled:pointer-events-none bg-[var(--color-input)] text-[var(--color-foreground)]"
        >
          <span className={selectedLabel ? '' : 'opacity-50 text-[var(--color-muted-foreground)]'}>
            {selectedLabel ?? label ?? 'Select…'}
          </span>
          {chevron}
        </button>
        {panel}
      </div>
    )
  }

  // ── menu variant ──────────────────────────────────────────────────────────
  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || loading}
        onClick={() => setOpen(v => !v)}
        onKeyDown={handleKeyDown}
        className="flex items-center gap-2 px-5 py-2.5 text-sm bg-gradient-to-br from-[#396200] to-[#4d7c0f] text-white rounded-full font-bold shadow-lg shadow-[#396200]/20 hover:opacity-90 disabled:opacity-50 transition-all"
      >
        {icon}
        {label}
        {chevron}
      </button>
      {panel}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npm run build
```
Expected: build succeeds with zero TypeScript errors. (The component is not yet used anywhere — that is fine.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Dropdown.tsx
git commit -m "feat: add shared Dropdown component (pill/form/menu variants)"
```

---

## Task 2: Replace the Export Trip Package button (ItineraryTab)

**Files:**
- Modify: `frontend/src/components/ItineraryTab.tsx`

The current implementation (around lines 72-142) uses local `showExportMenu` state, a `useRef` for click-outside, a `useEffect`, and inline JSX for the floating panel. All of that is replaced by the new component.

- [ ] **Step 1: Add the import**

At the top of `ItineraryTab.tsx`, add:
```tsx
import { Dropdown } from './Dropdown'
```

Remove the imports for `ChevronDown` **only if** it is not used elsewhere in the file. (Check with a search — it may be used in other places.)

- [ ] **Step 2: Remove the local dropdown state and effect**

Delete these lines (approximately 72-82):
```tsx
const [showExportMenu, setShowExportMenu] = useState(false)
const exportMenuRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  if (!showExportMenu) return
  const handler = (e: MouseEvent) => {
    if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false)
  }
  document.addEventListener('mousedown', handler)
  return () => document.removeEventListener('mousedown', handler)
}, [showExportMenu])
```

Remove any now-unused imports (`useRef`, `useEffect` — check if still used elsewhere in the file before removing).

- [ ] **Step 3: Replace the export button JSX**

Find and remove this block (the `<div className="relative" ref={exportMenuRef}>` and everything inside it):

```tsx
<div className="flex items-center justify-end">
  <div className="relative" ref={exportMenuRef}>
    <button
      onClick={() => setShowExportMenu(v => !v)}
      disabled={exporting}
      className="flex items-center gap-2 px-5 py-2.5 text-sm bg-gradient-to-br from-[#396200] to-[#4d7c0f] text-white rounded-full font-bold shadow-lg shadow-[#396200]/20 hover:opacity-90 disabled:opacity-50 transition-all"
    >
      <FileDown className="w-4 h-4" />
      {exporting ? 'Exporting…' : 'Export Trip Package'}
      <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showExportMenu ? 'rotate-180' : ''}`} />
    </button>
    {showExportMenu && (
      <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-[0_24px_40px_-12px_rgba(27,28,26,0.14)] overflow-hidden z-50">
        <button onClick={() => { handleExport('participant'); setShowExportMenu(false) }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[#1b1c1a] hover:bg-[#f5f3ef] transition-colors text-left">
          <Users className="w-4 h-4 text-[#396200] shrink-0" />
          <div>
            <p className="font-semibold">Participant Version</p>
            <p className="text-[11px] text-[#43493a]">Without staff details</p>
          </div>
        </button>
        <div className="h-px bg-[rgba(195,201,181,0.25)] mx-4" />
        <button onClick={() => { handleExport('staff'); setShowExportMenu(false) }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[#1b1c1a] hover:bg-[#f5f3ef] transition-colors text-left">
          <UserCog className="w-4 h-4 text-[#515f74] shrink-0" />
          <div>
            <p className="font-semibold">Staff Version</p>
            <p className="text-[11px] text-[#43493a]">Includes operational details</p>
          </div>
        </button>
      </div>
    )}
  </div>
</div>
```

Replace the entire block with:

```tsx
<div className="flex items-center justify-end">
  <Dropdown
    variant="menu"
    icon={<FileDown className="w-4 h-4" />}
    label={exporting ? 'Exporting…' : 'Export Trip Package'}
    loading={exporting}
    onSelect={handleExport}
    items={[
      {
        value: 'participant',
        label: 'Participant Version',
        description: 'Without staff details',
        icon: <Users className="w-4 h-4 text-[#396200]" />,
      },
      {
        value: 'staff',
        label: 'Staff Version',
        description: 'Includes operational details',
        icon: <UserCog className="w-4 h-4 text-[#515f74]" />,
      },
    ]}
  />
</div>
```

- [ ] **Step 4: Verify it builds**

```bash
cd frontend && npm run build
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ItineraryTab.tsx
git commit -m "refactor: replace export button with shared Dropdown (menu variant)"
```

---

## Task 3: Replace inline booking status and insurance selects (TripDetailPage)

**Files:**
- Modify: `frontend/src/pages/TripDetailPage.tsx`

There are two `<select>` elements wrapped in `<div className="relative inline-flex items-center">` used for inline booking edits. Find them by searching for `patchBooking.mutate`.

- [ ] **Step 1: Add the import**

```tsx
import { Dropdown } from '@/components/Dropdown'
```

- [ ] **Step 2: Replace the booking status select**

Find (approximately):
```tsx
<div className="relative inline-flex items-center">
  <select
    value={b.bookingStatus}
    onChange={e => patchBooking.mutate({ id: b.id, data: { bookingStatus: e.target.value } })}
    className={`text-xs pl-2.5 pr-6 py-1 rounded-full ... ${getStatusColor(b.bookingStatus)}`}
  >
    {['Enquiry', 'Held', 'Confirmed', 'Waitlist', 'Cancelled', 'Completed', 'NoLongerAttending'].map(s => (
      <option key={s} value={s}>{s === 'NoLongerAttending' ? 'No Longer Attending' : s}</option>
    ))}
  </select>
  <ChevronDown className="absolute right-1.5 w-3 h-3 pointer-events-none ..." />
</div>
```

Replace with:
```tsx
<Dropdown
  variant="pill"
  value={b.bookingStatus}
  onChange={val => patchBooking.mutate({ id: b.id, data: { bookingStatus: val } })}
  colorClass={getStatusColor(b.bookingStatus)}
  items={[
    'Enquiry', 'Held', 'Confirmed', 'Waitlist',
    'Cancelled', 'Completed', 'NoLongerAttending',
  ].map(s => ({ value: s, label: s === 'NoLongerAttending' ? 'No Longer Attending' : s }))}
/>
```

- [ ] **Step 3: Replace the insurance status select**

Find (approximately):
```tsx
<div className="relative inline-flex items-center">
  <select
    value={b.insuranceStatus || 'None'}
    onChange={e => patchBooking.mutate({ id: b.id, data: { insuranceStatus: e.target.value } })}
    className={`... ${getStatusColor(b.insuranceStatus || 'none')}`}
  >
    {['None', 'Pending', 'Confirmed', 'Expired', 'Cancelled'].map(s => (
      <option key={s} value={s}>{s}</option>
    ))}
  </select>
  <ChevronDown className="absolute right-1.5 ..." />
</div>
```

Replace with:
```tsx
<Dropdown
  variant="pill"
  value={b.insuranceStatus ?? 'None'}
  onChange={val => patchBooking.mutate({ id: b.id, data: { insuranceStatus: val } })}
  colorClass={getStatusColor(b.insuranceStatus ?? 'none')}
  items={['None', 'Pending', 'Confirmed', 'Expired', 'Cancelled'].map(s => ({
    value: s,
    label: s,
  }))}
/>
```

- [ ] **Step 4: Replace the edit modal selects in TripDetailPage**

The edit modal in `TripDetailPage.tsx` contains `<select>` elements for Event Template, Status, and Lead Coordinator. These are controlled by local state (not react-hook-form), so they use `onChange` directly — no `<Controller>` needed.

Search for `<select value={` inside the edit modal section. Replace each with a `<Dropdown variant="form">` using the same `value` and `onChange` props, converting `e.target.value` to the direct string value:

**Event Template:**
```tsx
// Before
<select value={editForm.eventTemplateId} onChange={e => setEditForm({ ...editForm, eventTemplateId: e.target.value })} className={inputClass}>
  <option value="">None</option>
  {templates.map((t: any) => <option key={t.id} value={t.id}>{t.templateName}</option>)}
</select>

// After
<Dropdown
  variant="form"
  value={editForm.eventTemplateId}
  onChange={val => setEditForm({ ...editForm, eventTemplateId: val })}
  label="None"
  items={[
    { value: '', label: 'None' },
    ...templates.map((t: any) => ({ value: String(t.id), label: t.templateName })),
  ]}
/>
```

**Status:**
```tsx
// Before
<select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })} className={inputClass}>
  {['Draft', 'Planning', 'OpenForBookings', 'Confirmed', 'InProgress', 'Completed', 'Cancelled', 'Archived'].map(s => (
    <option key={s} value={s}>{s === 'OpenForBookings' ? 'Open For Bookings' : s === 'InProgress' ? 'In Progress' : s}</option>
  ))}
</select>

// After
<Dropdown
  variant="form"
  value={editForm.status}
  onChange={val => setEditForm({ ...editForm, status: val })}
  items={[
    { value: 'Draft', label: 'Draft' },
    { value: 'Planning', label: 'Planning' },
    { value: 'OpenForBookings', label: 'Open For Bookings' },
    { value: 'Confirmed', label: 'Confirmed' },
    { value: 'InProgress', label: 'In Progress' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Cancelled', label: 'Cancelled' },
    { value: 'Archived', label: 'Archived' },
  ]}
/>
```

**Lead Coordinator:**
```tsx
// Before
<select value={editForm.leadCoordinatorId} onChange={e => setEditForm({ ...editForm, leadCoordinatorId: e.target.value })} className={inputClass}>
  <option value="">None</option>
  {staffList.map((s: any) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
</select>

// After
<Dropdown
  variant="form"
  value={editForm.leadCoordinatorId}
  onChange={val => setEditForm({ ...editForm, leadCoordinatorId: val })}
  label="None"
  items={[
    { value: '', label: 'None' },
    ...staffList.map((s: any) => ({ value: String(s.id), label: s.fullName })),
  ]}
/>
```

- [ ] **Step 5: Verify it builds**

```bash
cd frontend && npm run build
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/TripDetailPage.tsx
git commit -m "refactor: replace inline selects in TripDetailPage with Dropdown component"
```

---

## Task 4: Replace selects in SchedulePage

**Files:**
- Modify: `frontend/src/pages/SchedulePage.tsx`

Two `<select>` elements exist in the assignment panel: Assignment Role and Sleepover Type (around lines 364-388). These use local state (`role`, `sleepoverType`) with `onChange`.

- [ ] **Step 1: Add the import**

```tsx
import { Dropdown } from '@/components/Dropdown'
```

- [ ] **Step 2: Replace Assignment Role select**

```tsx
// Before
<select
  value={role}
  onChange={e => setRole(e.target.value)}
  className="w-full px-4 py-2.5 rounded-full bg-[var(--color-surface-container-low)] border-none text-sm ..."
>
  <option value="Support Worker">Support Worker</option>
  ...
</select>

// After
<Dropdown
  variant="form"
  value={role}
  onChange={setRole}
  items={[
    { value: 'Support Worker', label: 'Support Worker' },
    { value: 'Senior Support Worker', label: 'Senior Support Worker' },
    { value: 'Lead Coordinator', label: 'Lead Coordinator' },
    { value: 'Team Leader', label: 'Team Leader' },
    { value: 'Senior Support / Driver', label: 'Senior Support / Driver' },
    { value: 'Driver', label: 'Driver' },
  ]}
/>
```

- [ ] **Step 3: Replace Sleepover Type select**

```tsx
// Before
<select
  value={sleepoverType}
  onChange={e => setSleepoverType(e.target.value)}
  className="w-full px-4 py-2.5 rounded-full ..."
>
  <option value="None">None</option>
  ...
</select>

// After
<Dropdown
  variant="form"
  value={sleepoverType}
  onChange={setSleepoverType}
  items={[
    { value: 'None', label: 'None' },
    { value: 'ActiveNight', label: 'Active Night' },
    { value: 'PassiveNight', label: 'Passive Night' },
    { value: 'Sleepover', label: 'Sleepover' },
  ]}
/>
```

- [ ] **Step 4: Replace Assigned Driver select (VehicleAssignModal)**

Further down in the same file, inside `VehicleAssignModal` (search for `driverStaffId`), there is a driver `<select>` around line 483:

```tsx
// Before
<select
  value={driverStaffId}
  onChange={e => setDriverStaffId(e.target.value)}
  className="w-full px-4 py-2.5 rounded-full bg-[var(--color-surface-container-low)] border-none text-sm ..."
>
  <option value="">— No driver selected —</option>
  {eligibleDrivers.map((s: any) => (
    <option key={s.id} value={s.id}>{s.fullName}</option>
  ))}
</select>

// After
<Dropdown
  variant="form"
  value={driverStaffId}
  onChange={setDriverStaffId}
  label="— No driver selected —"
  items={[
    { value: '', label: '— No driver selected —' },
    ...eligibleDrivers.map((s: any) => ({ value: String(s.id), label: s.fullName })),
  ]}
/>
```

Note: The `isDriver` checkbox (`checked={isDriver}`) in `StaffAssignModal` is a checkbox, not a select — leave it unchanged.

- [ ] **Step 5: Verify it builds**

```bash
cd frontend && npm run build
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/SchedulePage.tsx
git commit -m "refactor: replace assignment panel selects in SchedulePage with Dropdown"
```

---

## Task 5: Replace form selects in TripCreatePage

**Files:**
- Modify: `frontend/src/pages/TripCreatePage.tsx`

Three `<select>` elements use `react-hook-form`'s `register()`: Event Template (line ~110), Status (line ~150), Lead Coordinator (line ~159). Since Dropdown is not a native input, replace `register()` with `<Controller>`. Also need to import `Controller` from react-hook-form and add `control` to the `useForm` destructure.

- [ ] **Step 1: Update imports**

```tsx
// Add Controller to the react-hook-form import
import { useForm, Controller } from 'react-hook-form'

// Add Dropdown import
import { Dropdown } from '@/components/Dropdown'
```

- [ ] **Step 2: Add `control` to the useForm destructure**

Find:
```tsx
const { register, handleSubmit, setValue, formState: { errors } } = useForm<TripFormData>({
```

Replace with:
```tsx
const { register, handleSubmit, setValue, control, formState: { errors } } = useForm<TripFormData>({
```

- [ ] **Step 3: Replace the Event Template select**

The current code (line ~110) uses both `register` and a custom `onTemplateChange` handler via `onChange`. The side effect must be preserved.

Find the `onTemplateChange` function — it currently accepts a `React.ChangeEvent<HTMLSelectElement>`. Refactor it to accept a plain string value:

```tsx
// Before
const onTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
  const templateId = e.target.value
  ...
}

// After
const onTemplateChange = (templateId: string) => {
  if (!templateId) return
  const tpl = templates.find((t: any) => String(t.id) === templateId)
  if (tpl) {
    if (tpl.defaultDestination) setValue('destination', tpl.defaultDestination)
    if (tpl.defaultRegion) setValue('region', tpl.defaultRegion)
    if (tpl.defaultDurationDays) setValue('durationDays', tpl.defaultDurationDays)
  }
}
```

Then replace the select JSX:
```tsx
// Before
<select {...register('eventTemplateId')} onChange={e => { register('eventTemplateId').onChange(e); onTemplateChange(e) }} className={inputClass}>
  <option value="">None</option>
  {templates.map((t: any) => <option key={t.id} value={t.id}>{t.templateName}</option>)}
</select>

// After
<Controller
  control={control}
  name="eventTemplateId"
  render={({ field }) => (
    <Dropdown
      variant="form"
      value={field.value ?? ''}
      onChange={val => { field.onChange(val); onTemplateChange(val) }}
      onBlur={field.onBlur}
      label="None"
      items={[
        { value: '', label: 'None' },
        ...templates.map((t: any) => ({ value: String(t.id), label: t.templateName })),
      ]}
    />
  )}
/>
```

- [ ] **Step 4: Replace the Status select**

```tsx
// Before
<select {...register('status')} className={inputClass}>
  <option value="Draft">Draft</option>
  <option value="Planning">Planning</option>
  <option value="OpenForBookings">Open For Bookings</option>
</select>

// After
<Controller
  control={control}
  name="status"
  render={({ field }) => (
    <Dropdown
      variant="form"
      value={field.value ?? 'Draft'}
      onChange={field.onChange}
      onBlur={field.onBlur}
      items={[
        { value: 'Draft', label: 'Draft' },
        { value: 'Planning', label: 'Planning' },
        { value: 'OpenForBookings', label: 'Open For Bookings' },
      ]}
    />
  )}
/>
```

- [ ] **Step 5: Replace the Lead Coordinator select**

```tsx
// Before
<select {...register('leadCoordinatorId')} className={inputClass}>
  <option value="">None</option>
  {staffList.map((s: any) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
</select>

// After
<Controller
  control={control}
  name="leadCoordinatorId"
  render={({ field }) => (
    <Dropdown
      variant="form"
      value={field.value ?? ''}
      onChange={field.onChange}
      onBlur={field.onBlur}
      label="None"
      items={[
        { value: '', label: 'None' },
        ...staffList.map((s: any) => ({ value: String(s.id), label: s.fullName })),
      ]}
    />
  )}
/>
```

- [ ] **Step 6: Verify it builds**

```bash
cd frontend && npm run build
```
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/TripCreatePage.tsx
git commit -m "refactor: replace form selects in TripCreatePage with Dropdown + Controller"
```

---

## Task 6: Replace selects in AddActivityModal

**Files:**
- Modify: `frontend/src/components/AddActivityModal.tsx`

Two `<select>` elements: Activity Library (line ~136) and Status (line ~170). Both use local state.

- [ ] **Step 1: Add the import**

```tsx
import { Dropdown } from './Dropdown'
```

- [ ] **Step 2: Replace Activity Library select**

```tsx
// Before
<select value={selectedActivityId} onChange={e => handleLibrarySelect(e.target.value)} className={inputClass}>
  <option value="">Select an activity...</option>
  {filteredActivities.map((a: any) => (
    <option key={a.id} value={a.id}>{a.activityName} ({a.category})</option>
  ))}
</select>

// After
<Dropdown
  variant="form"
  value={selectedActivityId}
  onChange={handleLibrarySelect}
  label="Select an activity…"
  items={[
    { value: '', label: 'Select an activity…' },
    ...filteredActivities.map((a: any) => ({
      value: String(a.id),
      label: `${a.activityName} (${a.category})`,
    })),
  ]}
/>
```

- [ ] **Step 3: Replace Status select**

Find `STATUS_OPTIONS` — it's an array of strings already defined in the file. Use it:

```tsx
// Before
<select value={status} onChange={e => setStatus(e.target.value)} className={inputClass}>
  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
</select>

// After
<Dropdown
  variant="form"
  value={status}
  onChange={setStatus}
  items={STATUS_OPTIONS.map(s => ({ value: s, label: s }))}
/>
```

- [ ] **Step 4: Verify it builds**

```bash
cd frontend && npm run build
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AddActivityModal.tsx
git commit -m "refactor: replace selects in AddActivityModal with Dropdown"
```

---

## Task 7: Replace edit modal selects in TripsPage

**Files:**
- Modify: `frontend/src/pages/TripsPage.tsx`

The edit modal (search for `{/* Edit Trip Modal */}`) contains three `<select>` elements: Event Template, Status, Lead Coordinator. These are controlled by `editForm` state with `setEditForm`.

- [ ] **Step 1: Add the import**

```tsx
import { Dropdown } from '@/components/Dropdown'
```

- [ ] **Step 2: Replace Event Template select**

```tsx
// Before
<select value={editForm.eventTemplateId} onChange={e => setEditForm({ ...editForm, eventTemplateId: e.target.value })} className={inputClass}>
  <option value="">None</option>
  {templates.map((t: any) => <option key={t.id} value={t.id}>{t.templateName}</option>)}
</select>

// After
<Dropdown
  variant="form"
  value={editForm.eventTemplateId}
  onChange={val => setEditForm({ ...editForm, eventTemplateId: val })}
  label="None"
  items={[
    { value: '', label: 'None' },
    ...templates.map((t: any) => ({ value: String(t.id), label: t.templateName })),
  ]}
/>
```

- [ ] **Step 3: Replace Status select**

```tsx
// Before
<select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })} className={inputClass}>
  {['Draft', 'Planning', 'OpenForBookings', 'Confirmed', 'InProgress', 'Completed', 'Cancelled', 'Archived'].map(s => (
    <option key={s} value={s}>{s === 'OpenForBookings' ? 'Open For Bookings' : s === 'InProgress' ? 'In Progress' : s}</option>
  ))}
</select>

// After
<Dropdown
  variant="form"
  value={editForm.status}
  onChange={val => setEditForm({ ...editForm, status: val })}
  items={[
    { value: 'Draft', label: 'Draft' },
    { value: 'Planning', label: 'Planning' },
    { value: 'OpenForBookings', label: 'Open For Bookings' },
    { value: 'Confirmed', label: 'Confirmed' },
    { value: 'InProgress', label: 'In Progress' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Cancelled', label: 'Cancelled' },
    { value: 'Archived', label: 'Archived' },
  ]}
/>
```

- [ ] **Step 4: Replace Lead Coordinator select**

```tsx
// Before
<select value={editForm.leadCoordinatorId} onChange={e => setEditForm({ ...editForm, leadCoordinatorId: e.target.value })} className={inputClass}>
  <option value="">None</option>
  {staffList.map((s: any) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
</select>

// After
<Dropdown
  variant="form"
  value={editForm.leadCoordinatorId}
  onChange={val => setEditForm({ ...editForm, leadCoordinatorId: val })}
  label="None"
  items={[
    { value: '', label: 'None' },
    ...staffList.map((s: any) => ({ value: String(s.id), label: s.fullName })),
  ]}
/>
```

- [ ] **Step 5: Verify it builds**

```bash
cd frontend && npm run build
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/TripsPage.tsx
git commit -m "refactor: replace edit modal selects in TripsPage with Dropdown"
```

---

## Task 8: Final build verification and push

- [ ] **Step 1: Clean build**

```bash
cd frontend && npm run build
```
Expected: zero TypeScript errors, Vite bundle completes.

- [ ] **Step 2: Check for any remaining native `<select>` elements in scope**

```bash
grep -rn "<select" frontend/src/pages/ frontend/src/components/
```

Expected remaining: only the status filter `<select>` in `TripsPage.tsx` (the one wrapped in a `<Filter>` icon — this is intentionally out of scope).

- [ ] **Step 3: Push**

```bash
git push
```
