# Component Library Standardization — Design Spec

> **Date:** 2026-03-31
> **Status:** Approved
> **Scope:** 12 shared components + 1 hook, replacing ~800-1200 lines of duplicated code across 26 files

## Overview

Standardize repeated UI patterns into a shared component library. Components are layered by dependency: primitives → composites → domain → hooks. Each component follows the existing patterns established by `DataTable` and `Dropdown` (named exports, CSS variables, TypeScript generics where appropriate).

## Architecture

```
Layer 1 — Primitives (no internal dependencies)
  Card, StatusBadge, SearchInput, ToggleGroup, TabNav, EmptyState, FormField

Layer 2 — Composites (depend on Layer 1)
  Modal (uses Card styling), StatCard (wraps Card), PageHeader

Layer 3 — Domain Components (depend on Layer 2)
  ConfirmDialog (wraps Modal), ActionButtons

Layer 4 — Hooks (depend on Layer 3)
  useArchiveRestore (composes ToggleGroup + ConfirmDialog + state)
```

## File Map

```
frontend/src/components/
  Card.tsx              ~30 lines
  StatusBadge.tsx       ~80 lines
  SearchInput.tsx       ~20 lines
  ToggleGroup.tsx       ~30 lines
  TabNav.tsx            ~35 lines
  EmptyState.tsx        ~25 lines
  FormField.tsx         ~50 lines
  Modal.tsx             ~70 lines
  StatCard.tsx          ~20 lines
  PageHeader.tsx        ~30 lines
  ConfirmDialog.tsx     ~40 lines
  ActionButtons.tsx     ~40 lines

frontend/src/hooks/
  useArchiveRestore.ts  ~60 lines
```

---

## Component Specifications

### 1. Card

Minimal wrapper providing consistent container styling. Optional `title` and `action` props for the common header pattern; complex headers use children directly.

```tsx
export type CardProps = {
  title?: string
  action?: ReactNode
  className?: string
  compact?: boolean    // reduced padding (p-3 vs p-5)
  children: ReactNode
}

export function Card({ title, action, className, compact, children }: CardProps) {
  return (
    <div className={`bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] ${compact ? 'p-3' : 'p-5'} ${className ?? ''}`}>
      {(title || action) && (
        <div className={`flex items-center justify-between ${children ? 'mb-4' : ''}`}>
          {title && <h3 className="font-semibold">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}
```

**Usage patterns:**
- Form sections on create pages
- Detail cards on ParticipantDetailPage, ClaimDetailPage
- Settings panels
- Any `bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5` wrapper

---

### 2. StatusBadge

Single component with a built-in color registry covering all domain statuses. Replaces `getStatusColor()`, `getSeverityBadge()`, `getQscBadge()`, `claimStatusColor()`, and inline badge-* class usage.

```tsx
export type StatusBadgeProps = {
  status: string
  label?: string           // display text (defaults to status)
  colorMap?: Record<string, string>  // one-off overrides
  pulse?: boolean          // animate-pulse for urgent statuses
  className?: string
}

// Built-in registry
const STATUS_COLORS: Record<string, string> = {
  // Booking / General
  confirmed: 'bg-[#bbf37c] text-[#0f2000]',
  completed: 'bg-[#bbf37c] text-[#0f2000]',
  available: 'bg-[#bbf37c] text-[#0f2000]',
  active: 'bg-[#bbf37c] text-[#0f2000]',
  draft: 'bg-[#e4e2de] text-[#43493a]',
  proposed: 'bg-[#e4e2de] text-[#43493a]',
  none: 'bg-[#e4e2de] text-[#43493a]',
  cancelled: 'bg-[#ffdad6] text-[#93000a]',
  unavailable: 'bg-[#ffdad6] text-[#93000a]',
  nolongerattending: 'bg-[#ffdad6] text-[#93000a]',
  expired: 'bg-[#ffdad6] text-[#93000a]',
  inactive: 'bg-[#ffdad6] text-[#93000a]',
  overdue: 'bg-[#ffdad6] text-[#93000a]',
  conflict: 'bg-[#ffdad6] text-[#93000a]',

  // Severity
  low: 'bg-[#d5e3fc] text-[#0d1c2e]',
  medium: 'bg-[#fef3c7] text-[#92400e]',
  high: 'bg-[#ffdad6] text-[#93000a]',
  critical: 'bg-[#ffdad6] text-[#93000a]',

  // Claims
  submitted: 'bg-blue-100 text-blue-700',
  paid: 'bg-[#bff285] text-[#294800]',
  rejected: 'bg-red-100 text-red-700',
  partiallypaid: 'bg-amber-100 text-amber-700',

  // QSC
  reportedwithin24h: 'bg-[#bbf37c] text-[#0f2000]',
  reportedlate: 'bg-[#fef3c7] text-[#92400e]',
  required: 'bg-[#ffdad6] text-[#93000a]',
  pending: 'bg-[#fef3c7] text-[#92400e]',
  notrequired: 'bg-[#e4e2de] text-[#43493a]',
}

const DEFAULT_COLOR = 'bg-[#fef3c7] text-[#92400e]' // pending/unknown

export function StatusBadge({ status, label, colorMap, pulse, className }: StatusBadgeProps) {
  const key = status.toLowerCase()
  const color = colorMap?.[key] ?? STATUS_COLORS[key] ?? DEFAULT_COLOR
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${color} ${pulse ? 'animate-pulse' : ''} ${className ?? ''}`}>
      {label ?? status}
    </span>
  )
}
```

**Integration with DataTable:** DataTable's `type: 'badge'` rendering will use `StatusBadge` internally, replacing its inline `getStatusColor()` call.

**Migration:** Remove `getStatusColor()` from `lib/utils.ts` after all consumers switch to StatusBadge. Remove `getSeverityBadge()`, `getQscBadge()`, `claimStatusColor()` from their respective page files. Remove `.badge-*` CSS classes from `index.css`.

---

### 3. SearchInput

Icon-prefixed search input matching the existing pattern exactly.

```tsx
export type SearchInputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function SearchInput({ value, onChange, placeholder = 'Search...', className }: SearchInputProps) {
  return (
    <div className={`relative ${className ?? 'max-w-md flex-1'}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted-foreground)]" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
      />
    </div>
  )
}
```

---

### 4. ToggleGroup

Generic pill button group for binary/multi-option toggles. Used by `useArchiveRestore` for the Active/Archived toggle, but reusable for any similar pattern.

```tsx
export type ToggleOption = {
  key: string
  label: string
}

export type ToggleGroupProps = {
  options: ToggleOption[]
  value: string
  onChange: (key: string) => void
  className?: string
}

export function ToggleGroup({ options, value, onChange, className }: ToggleGroupProps) {
  return (
    <div className={`flex gap-2 ${className ?? ''}`}>
      {options.map(opt => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            value === opt.key
              ? 'bg-[var(--color-primary)] text-white'
              : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
```

---

### 5. TabNav

Underline-style tab navigation with optional icon support.

```tsx
export type Tab = {
  key: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
}

export type TabNavProps = {
  tabs: Tab[]
  active: string
  onChange: (key: string) => void
  className?: string
}

export function TabNav({ tabs, active, onChange, className }: TabNavProps) {
  return (
    <div className={`flex gap-4 border-b border-[var(--color-border)] ${className ?? ''}`}>
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            active === t.key
              ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
              : 'border-transparent text-[var(--color-muted-foreground)]'
          }`}
        >
          {t.icon && <t.icon className="w-4 h-4" />}
          {t.label}
        </button>
      ))}
    </div>
  )
}
```

---

### 6. EmptyState

Centered empty-state display with icon, message, and optional CTA.

```tsx
export type EmptyStateProps = {
  icon: React.ComponentType<{ className?: string }>
  title: string
  action?: { label: string; to: string }
  className?: string
}

export function EmptyState({ icon: Icon, title, action, className }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-24 gap-4 ${className ?? ''}`}>
      <Icon className="w-16 h-16 text-[var(--color-foreground)] opacity-20" />
      <p className="text-lg font-semibold text-[var(--color-muted-foreground)]">{title}</p>
      {action && (
        <Link to={action.to} className="mt-2 text-sm font-bold text-[var(--color-primary)] hover:underline">
          {action.label}
        </Link>
      )}
    </div>
  )
}
```

---

### 7. FormField

Wrapper component that renders label, error message, and optional helper text around any child input. Auto-applies `inputClass` to native `<input>`, `<select>`, and `<textarea>` children via `cloneElement`.

```tsx
export type FormFieldProps = {
  label: string
  required?: boolean
  error?: string
  hint?: string
  layout?: 'default' | 'checkbox'  // checkbox: horizontal label
  className?: string
  children: ReactNode
}

const inputClass = 'w-full px-4 py-2.5 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-shadow'
const labelClass = 'block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]'

export function FormField({ label, required, error, hint, layout = 'default', className, children }: FormFieldProps) {
  // Auto-apply inputClass to native form elements
  const enhanced = isValidElement(children) && typeof children.type === 'string'
    && ['input', 'select', 'textarea'].includes(children.type)
    ? cloneElement(children as React.ReactElement<any>, {
        className: `${inputClass} ${(children.props as any).className ?? ''}`
      })
    : children

  if (layout === 'checkbox') {
    return (
      <label className={`flex items-center gap-3 py-1 ${className ?? ''}`}>
        {enhanced}
        <span className="text-sm text-[var(--color-foreground)]">
          {label}{required && ' *'}
        </span>
      </label>
    )
  }

  return (
    <div className={className}>
      <label className={labelClass}>
        {label}{required && ' *'}
      </label>
      {enhanced}
      {hint && !error && <p className="text-xs text-[var(--color-muted-foreground)] mt-1">{hint}</p>}
      {error && <p className="text-xs text-[var(--color-destructive)] mt-1">{error}</p>}
    </div>
  )
}

// Export for direct use in components that can't use FormField wrapper
export { inputClass, labelClass }
```

**Note:** `inputClass` and `labelClass` are also exported as named constants for edge cases where the wrapper doesn't fit (e.g., inline form fields in SettingsPage holiday add-row).

---

### 8. Modal

Wrapper handling backdrop, centering, close button, escape key, and body scroll lock. Title and footer are props; body is children.

```tsx
export type ModalProps = {
  open: boolean
  onClose: () => void
  title: string | ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  footer?: ReactNode
  children: ReactNode
  className?: string
}

const SIZE_MAP = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export function Modal({ open, onClose, title, size = 'md', footer, children, className }: ModalProps) {
  // Escape key handler
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Body scroll lock
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className={`bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-6 w-full ${SIZE_MAP[size]} max-h-[90vh] mx-2 overflow-y-auto ${className ?? ''}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--color-accent)] rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {children}

        {/* Footer */}
        {footer && (
          <div className="flex justify-end gap-3 mt-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
```

**Accessibility:** Focus trap is not included in v1 — the existing modals don't have it and adding it is a separate concern. Escape-to-close and click-outside-to-close are included.

---

### 9. StatCard

Compact metric display built on Card.

```tsx
export type StatCardProps = {
  label: string
  value: string | number
  className?: string
}

export function StatCard({ label, value, className }: StatCardProps) {
  return (
    <Card compact className={className}>
      <p className="text-sm text-[var(--color-muted-foreground)] mb-1 font-medium">{label}</p>
      <p className="text-2xl font-display font-bold text-[var(--color-primary)]">{value}</p>
    </Card>
  )
}
```

---

### 10. PageHeader

Page-level header with title, subtitle, primary action button, and children slot for filters/toggles.

```tsx
export type PageHeaderProps = {
  title: string
  subtitle?: string | ReactNode
  action?: ReactNode
  children?: ReactNode  // filter bar (toggles, search, dropdowns)
}

export function PageHeader({ title, subtitle, action, children }: PageHeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && (
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-3">
          {children}
        </div>
      )}
    </>
  )
}
```

---

### 11. ConfirmDialog

Thin wrapper around Modal for delete/archive confirmations. Replaces all `window.confirm()` usage.

```tsx
export type ConfirmDialogProps = {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  title: string
  message: string
  confirmLabel?: string    // default: "Confirm"
  variant?: 'default' | 'danger'
  loading?: boolean
}

export function ConfirmDialog({
  open, onConfirm, onCancel, title, message,
  confirmLabel = 'Confirm', variant = 'default', loading
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50 ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90'
            }`}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-[var(--color-muted-foreground)]">{message}</p>
    </Modal>
  )
}
```

---

### 12. ActionButtons

Edit/Delete/Restore button group for DataTable action columns. Handles `stopPropagation` internally.

```tsx
export type ActionButtonsProps = {
  editTo?: string            // Link path for edit
  onEdit?: (e: React.MouseEvent) => void  // alternative: callback
  onDelete?: () => void
  onRestore?: () => void
  showArchived?: boolean
}

export function ActionButtons({ editTo, onEdit, onDelete, onRestore, showArchived }: ActionButtonsProps) {
  const stop = (e: React.MouseEvent, fn?: () => void) => {
    e.stopPropagation()
    fn?.()
  }

  return (
    <div className="flex items-center gap-1">
      {editTo && (
        <Link to={editTo} onClick={e => e.stopPropagation()}
          className="p-1.5 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] transition-colors inline-block"
          title="Edit">
          <Pencil className="w-4 h-4" />
        </Link>
      )}
      {onEdit && (
        <button onClick={e => stop(e, onEdit)}
          className="p-1.5 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] transition-colors"
          title="Edit">
          <Pencil className="w-4 h-4" />
        </button>
      )}
      {showArchived && onRestore && (
        <button onClick={e => stop(e, onRestore)}
          className="p-1.5 rounded hover:bg-green-500/20 text-[var(--color-muted-foreground)] hover:text-green-400 transition-colors"
          title="Restore">
          <ArchiveRestore className="w-4 h-4" />
        </button>
      )}
      {!showArchived && onDelete && (
        <button onClick={e => stop(e, onDelete)}
          className="p-1.5 rounded hover:bg-red-500/20 text-[var(--color-muted-foreground)] hover:text-red-400 transition-colors"
          title="Archive">
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
```

---

### 13. useArchiveRestore Hook

Encapsulates the Active/Archived toggle state, query params, delete/restore handlers with ConfirmDialog, and the ToggleGroup JSX.

```tsx
type ArchiveRestoreConfig<T> = {
  deleteMutation: UseMutationResult<any, any, string, any>
  restoreMutation?: UseMutationResult<any, any, { id: string; data: any }, any>
  updateMutation?: UseMutationResult<any, any, { id: string; data: any }, any>
  entityName: (item: T) => string
  archiveVia?: 'isActive' | 'status'  // default: 'isActive'
  archiveStatus?: string               // e.g. 'Cancelled' for tasks
  restoreData?: (item: T) => Partial<T>  // custom restore payload
}

type ArchiveRestoreReturn<T> = {
  showArchived: boolean
  setShowArchived: (v: boolean) => void
  params: Record<string, string>
  handleDelete: (id: string, name: string) => void
  handleRestore: (item: T) => void
  toggleButtons: ReactNode             // pre-configured ToggleGroup
  confirmDialog: ReactNode             // ConfirmDialog JSX to render
  actionButtons: (item: T) => ReactNode  // pre-configured ActionButtons
}
```

**Behavior:**
- `handleDelete` opens ConfirmDialog with danger variant
- On confirm, calls `deleteMutation.mutate(id)` (for `isActive` mode) or sets status to `archiveStatus`
- `handleRestore` opens ConfirmDialog with default variant
- On confirm, calls `restoreMutation.mutate({ id, data: { ...item, isActive: true } })` or updates status
- `toggleButtons` is a pre-rendered `<ToggleGroup>` with Active/Archived options
- `confirmDialog` must be rendered by the page (placed at the end of JSX)
- `actionButtons(item)` returns `<ActionButtons>` pre-wired with handlers

**Usage:**
```tsx
const {
  showArchived, params, toggleButtons, confirmDialog, actionButtons
} = useArchiveRestore<ParticipantDto>({
  deleteMutation: deleteParticipant,
  restoreMutation: updateParticipant,
  entityName: (p) => p.fullName,
})

const { data: participants = [] } = useParticipants(params)

return (
  <div className="space-y-6 animate-fade-in">
    <PageHeader
      title="Participants"
      subtitle={`${participants.length} participants`}
      action={!showArchived && <Link to="/participants/new">...</Link>}
    >
      {toggleButtons}
      <SearchInput value={search} onChange={setSearch} placeholder="Search participants..." />
    </PageHeader>

    <DataTable
      data={participants}
      columns={[
        ...dataColumns,
        { key: 'actions', header: '', render: (p) => actionButtons(p) },
      ]}
      keyField="id"
    />

    {confirmDialog}
  </div>
)
```

---

## Migration Scope

### Pages (14 files)
| Page | Components Used |
|------|----------------|
| ParticipantsPage | PageHeader, useArchiveRestore, SearchInput, StatusBadge |
| StaffPage | PageHeader, useArchiveRestore, SearchInput, StatusBadge |
| TasksPage | PageHeader, useArchiveRestore, StatusBadge |
| IncidentsPage | PageHeader, useArchiveRestore, StatusBadge |
| VehiclesPage | PageHeader, useArchiveRestore, SearchInput, EmptyState |
| AccommodationPage | PageHeader, useArchiveRestore, SearchInput, EmptyState |
| BookingsPage | PageHeader, StatusBadge |
| TripsPage | PageHeader, StatusBadge, TabNav |
| DashboardPage | StatCard, PageHeader |
| ParticipantDetailPage | TabNav, Card, StatusBadge |
| TripDetailPage | TabNav, Card, StatusBadge, ActionButtons |
| ClaimDetailPage | Card, StatCard, StatusBadge |
| SettingsPage | TabNav, Card |
| QualificationsPage | Card, StatusBadge |

### Forms (8 files)
| File | Components Used |
|------|----------------|
| ParticipantCreatePage | FormField, Card |
| StaffCreatePage | FormField, Card |
| TripCreatePage | FormField, Card |
| VehicleCreatePage | FormField, Card |
| IncidentCreatePage | FormField, Card |
| AccommodationCreatePage | FormField, Card |
| TaskCreatePage | FormField, Card |
| TemplateFormPanel | FormField |

### Modals (4 files)
| File | Components Used |
|------|----------------|
| AddActivityModal | Modal, FormField |
| AddVehicleModal | Modal, FormField, SearchInput |
| GenerateClaimModal | Modal |
| NoShowModal | Modal |

---

## Cleanup

After migration:
- **Remove** `getStatusColor()` from `lib/utils.ts`
- **Remove** `getSeverityBadge()`, `getQscBadge()` from `IncidentsPage.tsx`
- **Remove** `claimStatusColor()`, `planTypeLabel()` badge functions from `ClaimDetailPage.tsx`
- **Remove** `.badge-confirmed`, `.badge-pending`, `.badge-cancelled`, `.badge-draft`, `.badge-info`, `.badge-conflict`, `.badge-overdue` CSS classes from `index.css`
- **Update** DataTable's `type: 'badge'` renderer to use `StatusBadge` internally
- **Remove** `inputClass`/`labelClass` local constants from create pages (use FormField or imported constants)

---

## Testing Strategy

- **TypeScript compilation** must pass with zero errors after each phase
- **Production build** (`npm run build`) must pass after each phase
- **Visual regression** — spot-check each migrated page in the browser to confirm identical appearance
- No unit tests for presentation components (follow existing project convention)

---

## Implementation Phases

```
Phase 1: Primitives     Card, StatusBadge, SearchInput, ToggleGroup, TabNav, EmptyState, FormField
Phase 2: Composites     Modal, StatCard, PageHeader
Phase 3: Domain         ConfirmDialog, ActionButtons, useArchiveRestore hook
Phase 4: Migration      Systematically replace across all 26 files
Phase 5: Cleanup        Remove dead code, CSS classes, old utility functions
Phase 6: Verification   Full build + visual spot-check
```
