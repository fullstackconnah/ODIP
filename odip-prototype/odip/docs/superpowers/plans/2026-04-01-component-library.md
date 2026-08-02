# Component Library Standardization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create 12 shared components + 1 hook to replace ~800-1200 lines of duplicated UI code across 26 files.

**Architecture:** Layered component library — primitives (Card, StatusBadge, SearchInput, ToggleGroup, TabNav, EmptyState, FormField) → composites (Modal, StatCard, PageHeader) → domain (ConfirmDialog, ActionButtons) → hooks (useArchiveRestore). Each component is a single file with named exports.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, CSS variables, Vite, TanStack Query v5

**Design Spec:** `docs/superpowers/specs/2026-03-31-component-library-design.md`

---

## File Map

### New Files
```
frontend/src/components/Card.tsx
frontend/src/components/StatusBadge.tsx
frontend/src/components/SearchInput.tsx
frontend/src/components/ToggleGroup.tsx
frontend/src/components/TabNav.tsx
frontend/src/components/EmptyState.tsx
frontend/src/components/FormField.tsx
frontend/src/components/Modal.tsx
frontend/src/components/StatCard.tsx
frontend/src/components/PageHeader.tsx
frontend/src/components/ConfirmDialog.tsx
frontend/src/components/ActionButtons.tsx
frontend/src/hooks/useArchiveRestore.tsx
```

### Modified Files (Migration)
```
frontend/src/components/DataTable.tsx          — use StatusBadge in badge renderer
frontend/src/lib/utils.ts                     — remove getStatusColor()
frontend/src/index.css                        — remove .badge-* classes

frontend/src/pages/ParticipantsPage.tsx        — PageHeader, useArchiveRestore, SearchInput, StatusBadge
frontend/src/pages/StaffPage.tsx               — PageHeader, useArchiveRestore, SearchInput, StatusBadge
frontend/src/pages/TasksPage.tsx               — PageHeader, useArchiveRestore, StatusBadge
frontend/src/pages/IncidentsPage.tsx           — PageHeader, useArchiveRestore, StatusBadge
frontend/src/pages/VehiclesPage.tsx            — PageHeader, useArchiveRestore, SearchInput, EmptyState
frontend/src/pages/AccommodationPage.tsx       — PageHeader, useArchiveRestore, SearchInput, EmptyState
frontend/src/pages/BookingsPage.tsx            — PageHeader, StatusBadge
frontend/src/pages/TripsPage.tsx               — PageHeader, StatusBadge, TabNav
frontend/src/pages/DashboardPage.tsx           — StatCard, PageHeader
frontend/src/pages/ParticipantDetailPage.tsx   — TabNav, Card, StatusBadge
frontend/src/pages/TripDetailPage.tsx          — TabNav, Card, StatusBadge, ActionButtons
frontend/src/pages/ClaimDetailPage.tsx         — Card, StatCard, StatusBadge
frontend/src/pages/SettingsPage.tsx            — TabNav, Card
frontend/src/pages/QualificationsPage.tsx      — Card, StatusBadge

frontend/src/pages/ParticipantCreatePage.tsx   — FormField, Card
frontend/src/pages/StaffCreatePage.tsx         — FormField, Card
frontend/src/pages/TripCreatePage.tsx          — FormField, Card
frontend/src/pages/VehicleCreatePage.tsx       — FormField, Card
frontend/src/pages/IncidentCreatePage.tsx      — FormField, Card
frontend/src/pages/AccommodationCreatePage.tsx — FormField, Card
frontend/src/pages/TaskCreatePage.tsx          — FormField, Card

frontend/src/components/AddActivityModal.tsx   — Modal, FormField
frontend/src/components/AddVehicleModal.tsx    — Modal, FormField, SearchInput
frontend/src/components/GenerateClaimModal.tsx — Modal
frontend/src/components/NoShowModal.tsx        — Modal
```

---

## Phase 1: Primitives

### Task 1: Card

**Files:**
- Create: `frontend/src/components/Card.tsx`

- [ ] **Step 1: Create Card component**

```tsx
import type { ReactNode } from 'react'

export type CardProps = {
  title?: string
  action?: ReactNode
  className?: string
  compact?: boolean
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

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Card.tsx
git commit -m "feat(components): add Card component"
```

---

### Task 2: StatusBadge

**Files:**
- Create: `frontend/src/components/StatusBadge.tsx`

- [ ] **Step 1: Create StatusBadge component with full color registry**

```tsx
export type StatusBadgeProps = {
  status: string
  label?: string
  colorMap?: Record<string, string>
  pulse?: boolean
  className?: string
}

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

  // Plan types
  ndiamanaged: 'bg-blue-100 text-blue-700',
  planmanaged: 'bg-purple-100 text-purple-700',
  selfmanaged: 'bg-orange-100 text-orange-700',
}

const DEFAULT_COLOR = 'bg-[#fef3c7] text-[#92400e]'

export function StatusBadge({ status, label, colorMap, pulse, className }: StatusBadgeProps) {
  const key = status.toLowerCase().replace(/\s+/g, '')
  const color = colorMap?.[key] ?? STATUS_COLORS[key] ?? DEFAULT_COLOR
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${color} ${pulse ? 'animate-pulse' : ''} ${className ?? ''}`}>
      {label ?? status}
    </span>
  )
}

```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/StatusBadge.tsx
git commit -m "feat(components): add StatusBadge component with color registry"
```

---

### Task 3: SearchInput

**Files:**
- Create: `frontend/src/components/SearchInput.tsx`

- [ ] **Step 1: Create SearchInput component**

```tsx
import { Search } from 'lucide-react'

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

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/SearchInput.tsx
git commit -m "feat(components): add SearchInput component"
```

---

### Task 4: ToggleGroup

**Files:**
- Create: `frontend/src/components/ToggleGroup.tsx`

- [ ] **Step 1: Create ToggleGroup component**

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

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ToggleGroup.tsx
git commit -m "feat(components): add ToggleGroup component"
```

---

### Task 5: TabNav

**Files:**
- Create: `frontend/src/components/TabNav.tsx`

- [ ] **Step 1: Create TabNav component**

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

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/TabNav.tsx
git commit -m "feat(components): add TabNav component"
```

---

### Task 6: EmptyState

**Files:**
- Create: `frontend/src/components/EmptyState.tsx`

- [ ] **Step 1: Create EmptyState component**

```tsx
import { Link } from 'react-router-dom'

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

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/EmptyState.tsx
git commit -m "feat(components): add EmptyState component"
```

---

### Task 7: FormField

**Files:**
- Create: `frontend/src/components/FormField.tsx`

- [ ] **Step 1: Create FormField component**

```tsx
import { isValidElement, cloneElement, type ReactNode } from 'react'

export type FormFieldProps = {
  label: string
  required?: boolean
  error?: string
  hint?: string
  layout?: 'default' | 'checkbox'
  className?: string
  children: ReactNode
}

export const inputClass = 'w-full px-4 py-2.5 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-shadow'
export const labelClass = 'block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]'

const NATIVE_INPUTS = ['input', 'select', 'textarea']

export function FormField({ label, required, error, hint, layout = 'default', className, children }: FormFieldProps) {
  const enhanced = isValidElement(children)
    && typeof children.type === 'string'
    && NATIVE_INPUTS.includes(children.type)
    ? cloneElement(children as React.ReactElement<{ className?: string }>, {
        className: `${inputClass} ${(children.props as { className?: string }).className ?? ''}`
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
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FormField.tsx
git commit -m "feat(components): add FormField component with auto inputClass"
```

---

### Task 8: Phase 1 build verification

- [ ] **Step 1: Run full TypeScript check + production build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: Zero errors, build succeeds

---

## Phase 2: Composites

### Task 9: Modal

**Files:**
- Create: `frontend/src/components/Modal.tsx`

- [ ] **Step 1: Create Modal component**

```tsx
import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

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
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

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
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--color-accent)] rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
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

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Modal.tsx
git commit -m "feat(components): add Modal component with escape + scroll lock"
```

---

### Task 10: StatCard

**Files:**
- Create: `frontend/src/components/StatCard.tsx`

- [ ] **Step 1: Create StatCard component**

```tsx
import { Card } from './Card'

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

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/StatCard.tsx
git commit -m "feat(components): add StatCard component"
```

---

### Task 11: PageHeader

**Files:**
- Create: `frontend/src/components/PageHeader.tsx`

- [ ] **Step 1: Create PageHeader component**

```tsx
import type { ReactNode } from 'react'

export type PageHeaderProps = {
  title: string
  subtitle?: string | ReactNode
  action?: ReactNode
  children?: ReactNode
}

export function PageHeader({ title, subtitle, action, children }: PageHeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && (
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              {typeof subtitle === 'string' ? subtitle : subtitle}
            </p>
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

- [ ] **Step 2: Verify TypeScript compilation + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: Zero errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/StatCard.tsx frontend/src/components/PageHeader.tsx frontend/src/components/Modal.tsx
git commit -m "feat(components): add Modal, StatCard, PageHeader composites"
```

---

## Phase 3: Domain Components

### Task 12: ConfirmDialog

**Files:**
- Create: `frontend/src/components/ConfirmDialog.tsx`

- [ ] **Step 1: Create ConfirmDialog component**

```tsx
import { Modal } from './Modal'

export type ConfirmDialogProps = {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  title: string
  message: string
  confirmLabel?: string
  variant?: 'default' | 'danger'
  loading?: boolean
}

export function ConfirmDialog({
  open, onConfirm, onCancel, title, message,
  confirmLabel = 'Confirm', variant = 'default', loading,
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

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ConfirmDialog.tsx
git commit -m "feat(components): add ConfirmDialog built on Modal"
```

---

### Task 13: ActionButtons

**Files:**
- Create: `frontend/src/components/ActionButtons.tsx`

- [ ] **Step 1: Create ActionButtons component**

```tsx
import { Link } from 'react-router-dom'
import { Pencil, Trash2, ArchiveRestore } from 'lucide-react'

export type ActionButtonsProps = {
  editTo?: string
  onEdit?: () => void
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

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ActionButtons.tsx
git commit -m "feat(components): add ActionButtons component"
```

---

### Task 14: useArchiveRestore Hook

**Files:**
- Create: `frontend/src/hooks/useArchiveRestore.tsx`

- [ ] **Step 1: Create hooks directory and useArchiveRestore hook**

```tsx
import { useState, useCallback, type ReactNode } from 'react'
import { ToggleGroup } from '@/components/ToggleGroup'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ActionButtons } from '@/components/ActionButtons'

type ArchiveRestoreConfig<T> = {
  deleteMutation: { mutate: (id: string) => void; isPending: boolean }
  restoreMutation?: { mutate: (args: { id: string; data: any }) => void; isPending: boolean }
  entityName: (item: T) => string
  entityId: (item: T) => string
  archiveVia?: 'isActive' | 'status'
  archiveStatus?: string
  restoreData?: (item: T) => any
  editPath?: (item: T) => string
}

type ArchiveRestoreReturn<T> = {
  showArchived: boolean
  setShowArchived: (v: boolean) => void
  params: Record<string, string>
  toggleButtons: ReactNode
  confirmDialog: ReactNode
  actionButtons: (item: T) => ReactNode
}

export function useArchiveRestore<T>(config: ArchiveRestoreConfig<T>): ArchiveRestoreReturn<T> {
  const [showArchived, setShowArchived] = useState(false)
  const [confirmState, setConfirmState] = useState<{
    type: 'delete' | 'restore'
    id: string
    name: string
    item?: T
  } | null>(null)

  const {
    deleteMutation, restoreMutation, entityName, entityId,
    archiveVia = 'isActive', archiveStatus = 'Cancelled', restoreData, editPath,
  } = config

  const params: Record<string, string> = archiveVia === 'isActive'
    ? { isActive: showArchived ? 'false' : 'true' }
    : showArchived ? { status: archiveStatus } : {}

  const handleDelete = useCallback((item: T) => {
    setConfirmState({
      type: 'delete',
      id: entityId(item),
      name: entityName(item),
    })
  }, [entityId, entityName])

  const handleRestore = useCallback((item: T) => {
    setConfirmState({
      type: 'restore',
      id: entityId(item),
      name: entityName(item),
      item,
    })
  }, [entityId, entityName])

  const handleConfirm = useCallback(() => {
    if (!confirmState) return
    if (confirmState.type === 'delete') {
      deleteMutation.mutate(confirmState.id)
    } else if (restoreMutation && confirmState.item) {
      const data = restoreData
        ? restoreData(confirmState.item)
        : { ...confirmState.item, isActive: true }
      restoreMutation.mutate({ id: confirmState.id, data })
    }
    setConfirmState(null)
  }, [confirmState, deleteMutation, restoreMutation, restoreData])

  const toggleButtons = (
    <ToggleGroup
      options={[
        { key: 'active', label: 'Active' },
        { key: 'archived', label: 'Archived' },
      ]}
      value={showArchived ? 'archived' : 'active'}
      onChange={key => setShowArchived(key === 'archived')}
    />
  )

  const confirmDialog = (
    <ConfirmDialog
      open={confirmState !== null}
      onConfirm={handleConfirm}
      onCancel={() => setConfirmState(null)}
      title={confirmState?.type === 'delete'
        ? `Archive "${confirmState.name}"?`
        : `Restore "${confirmState?.name}"?`}
      message={confirmState?.type === 'delete'
        ? 'This can be undone from the Archived view.'
        : 'This item will be moved back to the active list.'}
      confirmLabel={confirmState?.type === 'delete' ? 'Archive' : 'Restore'}
      variant={confirmState?.type === 'delete' ? 'danger' : 'default'}
      loading={deleteMutation.isPending || restoreMutation?.isPending}
    />
  )

  const actionButtons = useCallback((item: T) => (
    <ActionButtons
      editTo={editPath?.(item)}
      onDelete={() => handleDelete(item)}
      onRestore={restoreMutation ? () => handleRestore(item) : undefined}
      showArchived={showArchived}
    />
  ), [showArchived, editPath, handleDelete, handleRestore, restoreMutation])

  return {
    showArchived, setShowArchived, params,
    toggleButtons, confirmDialog, actionButtons,
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useArchiveRestore.tsx
git commit -m "feat(hooks): add useArchiveRestore hook with ConfirmDialog"
```

---

### Task 15: Phase 1-3 build verification

- [ ] **Step 1: Run full TypeScript check + production build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: Zero errors, build succeeds. All 12 components + 1 hook created, no existing code changed yet.

---

## Phase 4: Migration

### Task 16: Update DataTable to use StatusBadge

**Files:**
- Modify: `frontend/src/components/DataTable.tsx`

- [ ] **Step 1: Replace badge rendering in DataTable**

In `DataTable.tsx`, replace the `getStatusColor` import with `StatusBadge`:

Change import line:
```tsx
// OLD
import { formatDateAu, getStatusColor, formatCurrency } from '@/lib/utils'

// NEW
import { formatDateAu, formatCurrency } from '@/lib/utils'
import { StatusBadge } from '@/components/StatusBadge'
```

Replace the `case 'badge'` block in `renderCell`:
```tsx
// OLD
case 'badge':
  return value ? (
    <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(String(value))}`}>
      {String(value)}
    </span>
  ) : '—'

// NEW
case 'badge':
  return value ? <StatusBadge status={String(value)} /> : '—'
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: Zero errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/DataTable.tsx
git commit -m "refactor(DataTable): use StatusBadge for badge column type"
```

---

### Task 17: Migrate ParticipantsPage (canonical list page)

**Files:**
- Modify: `frontend/src/pages/ParticipantsPage.tsx`

- [ ] **Step 1: Migrate to shared components**

This is the reference migration. Replace the entire page to use PageHeader, useArchiveRestore, SearchInput, StatusBadge, and ActionButtons.

Read the current file fully, then apply these changes:

1. **Replace imports:** Remove `Plus`, `Search`, `Trash2`, `ArchiveRestore` from lucide imports. Add:
   ```tsx
   import { PageHeader } from '@/components/PageHeader'
   import { SearchInput } from '@/components/SearchInput'
   import { StatusBadge } from '@/components/StatusBadge'
   import { useArchiveRestore } from '@/hooks/useArchiveRestore'
   ```

2. **Replace archive logic:** Remove `showArchived` state, `handleDelete`, `handleRestore` functions, and the toggle button JSX. Replace with:
   ```tsx
   const { showArchived, params, toggleButtons, confirmDialog, actionButtons } = useArchiveRestore<ParticipantListDto>({
     deleteMutation: deleteParticipant,
     restoreMutation: updateParticipant,
     entityName: (p) => p.fullName,
     entityId: (p) => p.id,
     editPath: (p) => `/participants/${p.id}/edit`,
   })
   ```

3. **Replace page header JSX:** Remove the `<div className="flex items-center justify-between">` block and the filter bar. Replace with:
   ```tsx
   <PageHeader
     title="Participants"
     subtitle={`${participants.length} participant${participants.length !== 1 ? 's' : ''}`}
     action={!showArchived && (
       <Link to="/participants/new" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 shadow-md shadow-blue-500/20 transition-all">
         <Plus className="w-4 h-4" /> New Participant
       </Link>
     )}
   >
     {toggleButtons}
     <SearchInput value={search} onChange={setSearch} placeholder="Search participants..." />
   </PageHeader>
   ```

4. **Replace status column render:** Change from inline badge-* classes to:
   ```tsx
   { key: 'isActive', header: 'Status', sortable: true, render: (p) => <StatusBadge status={p.isActive ? 'Active' : 'Inactive'} /> }
   ```

5. **Replace action column:** Change from inline Pencil/Trash2/ArchiveRestore buttons to:
   ```tsx
   { key: 'actions', header: '', render: (p) => actionButtons(p) }
   ```

6. **Add confirmDialog at end of JSX:** Before the closing `</div>`, add `{confirmDialog}`.

7. **Remove unused imports** for old inline components.

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: Zero errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ParticipantsPage.tsx
git commit -m "refactor(ParticipantsPage): migrate to shared components"
```

---

### Task 18: Migrate StaffPage

**Files:**
- Modify: `frontend/src/pages/StaffPage.tsx`

- [ ] **Step 1: Apply same migration pattern as ParticipantsPage**

Follow the exact same steps as Task 17:
1. Replace imports (add PageHeader, SearchInput, StatusBadge, useArchiveRestore)
2. Replace archive logic with `useArchiveRestore<StaffListDto>` hook
3. Replace page header JSX with `<PageHeader>` component
4. Replace status column with `<StatusBadge>`
5. Replace action column with `actionButtons(s)`
6. Add `{confirmDialog}` at end of JSX
7. Remove unused imports (`Plus`, `Search`, `Trash2`, `ArchiveRestore`)

**Staff-specific config:**
```tsx
const { showArchived, params, toggleButtons, confirmDialog, actionButtons } = useArchiveRestore<StaffListDto>({
  deleteMutation: deleteStaff,
  restoreMutation: updateStaff,
  entityName: (s) => `${s.firstName} ${s.lastName}`,
  entityId: (s) => s.id,
  editPath: (s) => `/staff/${s.id}/edit`,
})
```

- [ ] **Step 2: Verify build + commit**

Run: `cd frontend && npx tsc --noEmit && npm run build`

```bash
git add frontend/src/pages/StaffPage.tsx
git commit -m "refactor(StaffPage): migrate to shared components"
```

---

### Task 19: Migrate TasksPage

**Files:**
- Modify: `frontend/src/pages/TasksPage.tsx`

- [ ] **Step 1: Apply migration with status-based archiving**

Same pattern as Task 17, but Tasks use status-based archiving:

```tsx
const { showArchived, params, toggleButtons, confirmDialog, actionButtons } = useArchiveRestore<TaskListDto>({
  deleteMutation: deleteTask,
  restoreMutation: updateTask,
  entityName: (t) => t.title,
  entityId: (t) => t.id,
  archiveVia: 'status',
  archiveStatus: 'Cancelled',
  restoreData: (t) => ({ ...t, status: 'NotStarted' }),
  editPath: (t) => `/tasks/${t.id}/edit`,
})
```

**Note:** TasksPage has an additional status filter dropdown — this stays as-is, but the `params` from useArchiveRestore should be merged with the status filter params. The agent implementing this should read the current file and handle the filter merging logic.

- [ ] **Step 2: Verify build + commit**

```bash
git add frontend/src/pages/TasksPage.tsx
git commit -m "refactor(TasksPage): migrate to shared components"
```

---

### Task 20: Migrate IncidentsPage

**Files:**
- Modify: `frontend/src/pages/IncidentsPage.tsx`

- [ ] **Step 1: Apply migration with status-based archiving**

Similar to TasksPage with status-based archiving:

```tsx
const { showArchived, params, toggleButtons, confirmDialog, actionButtons } = useArchiveRestore<IncidentListDto>({
  deleteMutation: deleteIncident,
  restoreMutation: updateIncident,
  entityName: (i) => i.title,
  entityId: (i) => i.id,
  archiveVia: 'status',
  archiveStatus: 'Closed',
  restoreData: (i) => ({ ...i, status: 'Open' }),
  editPath: (i) => `/incidents/${i.id}/edit`,
})
```

**Additional:** Remove `getSeverityBadge()` and `getQscBadge()` local functions. Replace their usage with `<StatusBadge>` component directly. The severity column becomes:
```tsx
{ key: 'severity', header: 'Severity', sortable: true, render: (i) => <StatusBadge status={i.severity} /> }
```

For QSC status with pulse, keep the custom render but use StatusBadge:
```tsx
render: (i) => i.qscReportingStatus === 'NotRequired' ? null : (
  <StatusBadge
    status={i.qscReportingStatus}
    label={formatQscLabel(i.qscReportingStatus)}
    pulse={i.isQscOverdue}
  />
)
```

- [ ] **Step 2: Verify build + commit**

```bash
git add frontend/src/pages/IncidentsPage.tsx
git commit -m "refactor(IncidentsPage): migrate to shared components"
```

---

### Task 21: Migrate VehiclesPage + AccommodationPage

**Files:**
- Modify: `frontend/src/pages/VehiclesPage.tsx`
- Modify: `frontend/src/pages/AccommodationPage.tsx`

- [ ] **Step 1: Migrate VehiclesPage**

Apply PageHeader, useArchiveRestore, SearchInput, EmptyState. VehiclesPage has a grid card layout (not DataTable), so the empty state is important:
```tsx
{vehicles.length === 0 ? (
  <EmptyState
    icon={Bus}
    title="No vehicles found"
    action={!showArchived ? { label: 'Add your first vehicle', to: '/vehicles/new' } : undefined}
  />
) : (
  /* existing grid layout */
)}
```

- [ ] **Step 2: Migrate AccommodationPage**

Same pattern. Uses a grid card layout:
```tsx
{properties.length === 0 ? (
  <EmptyState
    icon={Building2}
    title="No properties found"
    action={!showArchived ? { label: 'Add your first property', to: '/accommodation/new' } : undefined}
  />
) : (
  /* existing grid layout */
)}
```

- [ ] **Step 3: Verify build + commit**

```bash
git add frontend/src/pages/VehiclesPage.tsx frontend/src/pages/AccommodationPage.tsx
git commit -m "refactor(Vehicles,Accommodation): migrate to shared components"
```

---

### Task 22: Migrate BookingsPage + TripsPage

**Files:**
- Modify: `frontend/src/pages/BookingsPage.tsx`
- Modify: `frontend/src/pages/TripsPage.tsx`

- [ ] **Step 1: Migrate BookingsPage**

BookingsPage has no archive toggle — just PageHeader:
```tsx
<PageHeader
  title="Bookings"
  subtitle={`${bookings.length} booking${bookings.length !== 1 ? 's' : ''}`}
/>
```

- [ ] **Step 2: Migrate TripsPage**

TripsPage has PageHeader + TabNav for trip status filters:
```tsx
<PageHeader title="Trips" subtitle={`${trips.length} trips`} action={...} />
<TabNav
  tabs={[
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'past', label: 'Past' },
    { key: 'all', label: 'All' },
  ]}
  active={tripFilter}
  onChange={setTripFilter}
/>
```

**Note:** Read TripsPage fully first — the tab pattern may differ from the standard. Adapt as needed.

- [ ] **Step 3: Verify build + commit**

```bash
git add frontend/src/pages/BookingsPage.tsx frontend/src/pages/TripsPage.tsx
git commit -m "refactor(Bookings,Trips): migrate to shared components"
```

---

### Task 23: Migrate DashboardPage

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Migrate stat cards to StatCard where applicable**

The DashboardPage has varied stat card styles — some use accent colors, some are linked. Only migrate the standard ones that match `StatCard`'s API (label + value with default styling). Leave accent-colored and linked cards as-is since they use custom backgrounds.

Replace standard stat cards:
```tsx
// OLD
<div className="col-span-1 lg:col-span-2 bg-[var(--color-surface-container-low)] p-6 rounded-[2rem]">
  <p className="text-sm text-[var(--color-muted-foreground)] mb-1 font-medium">Upcoming Trips</p>
  <p className="text-3xl font-display font-bold text-[var(--color-primary)]">{d.upcomingTripCount}</p>
</div>

// NEW
<StatCard label="Upcoming Trips" value={d.upcomingTripCount} className="col-span-1 lg:col-span-2" />
```

**Important:** DashboardPage stat cards use `bg-[var(--color-surface-container-low)]` and `rounded-[2rem]` while StatCard uses Card's `bg-[var(--color-card)]` and `rounded-xl`. Read the current file and decide if StatCard's styling is close enough or if the custom cards should stay. If the styling differs significantly, leave them as-is — don't force-fit.

- [ ] **Step 2: Verify build + commit**

```bash
git add frontend/src/pages/DashboardPage.tsx
git commit -m "refactor(DashboardPage): migrate applicable stat cards"
```

---

### Task 24: Migrate detail pages (ParticipantDetailPage, TripDetailPage, ClaimDetailPage, SettingsPage)

**Files:**
- Modify: `frontend/src/pages/ParticipantDetailPage.tsx`
- Modify: `frontend/src/pages/TripDetailPage.tsx`
- Modify: `frontend/src/pages/ClaimDetailPage.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Migrate ParticipantDetailPage**

Replace tab navigation with TabNav:
```tsx
<TabNav
  tabs={[
    { key: 'details', label: 'Details', icon: Users },
    { key: 'bookings', label: 'Bookings', icon: ClipboardList },
    { key: 'support', label: 'Support Profile', icon: Shield },
    ...(isAdmin ? [{ key: 'history', label: 'History' }] : []),
  ]}
  active={tab}
  onChange={setTab}
/>
```

Replace card wrappers with `<Card title="...">`. Replace inline badge-* status badges with `<StatusBadge>`.

- [ ] **Step 2: Migrate TripDetailPage**

Replace tab navigation with TabNav (this page has many tabs — read fully first). Replace Card wrappers. Replace inline ActionButtons in sub-tabs.

**Note:** TripDetailPage is ~164KB. Focus changes narrowly on: tab nav replacement, Card wrappers in tab content, and StatusBadge for inline badges. Do NOT restructure the tab content components.

- [ ] **Step 3: Migrate ClaimDetailPage**

Remove `claimStatusColor()`, `lineItemStatusColor()`, `planTypeColor()` local functions. Replace with `<StatusBadge>` using the built-in registry (claim statuses + plan types are already in the registry). Replace stat card grid with `<StatCard>` components.

- [ ] **Step 4: Migrate SettingsPage**

Replace tab navigation with TabNav:
```tsx
<TabNav
  tabs={tabs.map(t => ({ key: t.key, label: t.label }))}
  active={tab}
  onChange={(key) => { setTab(key as typeof tab); if (key !== 'tenants') setTenantDetail(undefined) }}
/>
```

Replace card wrappers in sub-tabs with `<Card>`.

- [ ] **Step 5: Verify build + commit**

Run: `cd frontend && npx tsc --noEmit && npm run build`

```bash
git add frontend/src/pages/ParticipantDetailPage.tsx frontend/src/pages/TripDetailPage.tsx frontend/src/pages/ClaimDetailPage.tsx frontend/src/pages/SettingsPage.tsx
git commit -m "refactor(detail pages): migrate to TabNav, Card, StatusBadge, StatCard"
```

---

### Task 25: Migrate QualificationsPage

**Files:**
- Modify: `frontend/src/pages/QualificationsPage.tsx`

- [ ] **Step 1: Migrate Card wrappers and StatusBadge**

Replace card wrappers in accordion headers with `<Card>`. Replace inline badge rendering with `<StatusBadge>`. This page has editable rows and `rowClassName` — those stay as-is since they're DataTable features.

- [ ] **Step 2: Verify build + commit**

```bash
git add frontend/src/pages/QualificationsPage.tsx
git commit -m "refactor(QualificationsPage): migrate to Card, StatusBadge"
```

---

### Task 26: Migrate modals (AddActivityModal, AddVehicleModal, GenerateClaimModal, NoShowModal)

**Files:**
- Modify: `frontend/src/components/AddActivityModal.tsx`
- Modify: `frontend/src/components/AddVehicleModal.tsx`
- Modify: `frontend/src/components/GenerateClaimModal.tsx`
- Modify: `frontend/src/components/NoShowModal.tsx`

- [ ] **Step 1: Migrate AddActivityModal**

Replace the fixed overlay + card wrapper with `<Modal>`. Move the footer buttons to the `footer` prop. Keep all form content as children. Remove `X` import.

```tsx
// OLD
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
  <div className="bg-[var(--color-card)] rounded-xl ..." onClick={e => e.stopPropagation()}>
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-semibold">...</h3>
      <button onClick={onClose}><X /></button>
    </div>
    {/* body */}
    <div className="flex justify-end gap-3 mt-6">{/* buttons */}</div>
  </div>
</div>

// NEW
<Modal open={true} onClose={onClose} title="Add Activity" footer={/* buttons */}>
  {/* body only */}
</Modal>
```

- [ ] **Step 2: Migrate AddVehicleModal**

Same pattern. This modal has two tabs — keep tab content as children.

- [ ] **Step 3: Migrate GenerateClaimModal**

This is a two-step wizard (input → preview) with dynamic title. Use the `title` prop dynamically:
```tsx
<Modal
  open={true}
  onClose={onClose}
  title={step === 'input' ? 'Generate NDIS Claim' : 'Claim Preview'}
  size="lg"
  footer={/* step-dependent buttons */}
>
```

- [ ] **Step 4: Migrate NoShowModal**

Simplest modal. Replace overlay + card wrapper with `<Modal size="sm">`.

- [ ] **Step 5: Verify build + commit**

Run: `cd frontend && npx tsc --noEmit && npm run build`

```bash
git add frontend/src/components/AddActivityModal.tsx frontend/src/components/AddVehicleModal.tsx frontend/src/components/GenerateClaimModal.tsx frontend/src/components/NoShowModal.tsx
git commit -m "refactor(modals): migrate to Modal component"
```

---

### Task 27: Migrate create pages to FormField + Card

**Files:**
- Modify: `frontend/src/pages/ParticipantCreatePage.tsx`
- Modify: `frontend/src/pages/StaffCreatePage.tsx`
- Modify: `frontend/src/pages/TripCreatePage.tsx`
- Modify: `frontend/src/pages/VehicleCreatePage.tsx`
- Modify: `frontend/src/pages/IncidentCreatePage.tsx`
- Modify: `frontend/src/pages/AccommodationCreatePage.tsx`
- Modify: `frontend/src/pages/TaskCreatePage.tsx`

- [ ] **Step 1: Migrate ParticipantCreatePage (reference)**

1. Replace local `inputClass`/`labelClass`/`checkboxWrapperClass`/`checkboxLabelClass` constants with imports from FormField.
2. Replace card section wrappers with `<Card title="Section Title">`.
3. Replace each field's label + input + error triplet with `<FormField>`:

```tsx
// OLD
<div>
  <label className={labelClass}>First Name *</label>
  <input {...register('firstName')} className={inputClass} placeholder="e.g. John" autoFocus />
  {errors.firstName && <p className="text-xs text-[var(--color-destructive)] mt-1">{errors.firstName.message}</p>}
</div>

// NEW
<FormField label="First Name" required error={errors.firstName?.message}>
  <input {...register('firstName')} placeholder="e.g. John" autoFocus />
</FormField>
```

For checkboxes:
```tsx
// OLD
<div className={checkboxWrapperClass}>
  <input type="checkbox" {...register('wheelchairRequired')} id="wheelchair" className="w-4 h-4 rounded border-[var(--color-border)]" />
  <label htmlFor="wheelchair" className={checkboxLabelClass}>Wheelchair required</label>
</div>

// NEW
<FormField label="Wheelchair required" layout="checkbox">
  <input type="checkbox" {...register('wheelchairRequired')} className="w-4 h-4 rounded border-[var(--color-border)]" />
</FormField>
```

**Note:** FormField auto-applies `inputClass` to native `<input>` elements, so remove the manual `className={inputClass}` from inputs. Checkbox inputs keep their own className since they're not full-width.

- [ ] **Step 2: Migrate remaining create pages**

Apply the same pattern to StaffCreatePage, TripCreatePage, VehicleCreatePage, IncidentCreatePage, AccommodationCreatePage, TaskCreatePage. Each page follows the same structure — read each one fully and apply the same transformations.

**TripCreatePage special case:** Uses `Controller` wrapper for Dropdown fields. FormField wraps the Controller:
```tsx
<FormField label="Status" error={errors.status?.message}>
  <Controller
    control={control}
    name="status"
    render={({ field }) => (
      <Dropdown variant="form" items={statusItems} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
    )}
  />
</FormField>
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ParticipantCreatePage.tsx frontend/src/pages/StaffCreatePage.tsx frontend/src/pages/TripCreatePage.tsx frontend/src/pages/VehicleCreatePage.tsx frontend/src/pages/IncidentCreatePage.tsx frontend/src/pages/AccommodationCreatePage.tsx frontend/src/pages/TaskCreatePage.tsx
git commit -m "refactor(create pages): migrate to FormField + Card"
```

---

## Phase 5: Cleanup

### Task 28: Remove dead code

**Files:**
- Modify: `frontend/src/lib/utils.ts` — remove `getStatusColor()`
- Modify: `frontend/src/index.css` — remove `.badge-*` CSS classes (lines 122-128)

- [ ] **Step 1: Remove getStatusColor from utils.ts**

Delete the `getStatusColor` function from `frontend/src/lib/utils.ts`. It should no longer have any importers after migration.

- [ ] **Step 2: Verify no remaining imports**

Run: `cd frontend && grep -r "getStatusColor" src/ --include="*.tsx" --include="*.ts"`
Expected: No results (if DataTable was updated in Task 16)

- [ ] **Step 3: Remove badge CSS classes from index.css**

Remove these lines from `frontend/src/index.css`:
```css
.badge-confirmed { background-color: #bbf37c; color: #0f2000; }
.badge-pending { background-color: #fef3c7; color: #92400e; }
.badge-cancelled { background-color: #ffdad6; color: #93000a; }
.badge-draft { background-color: #e4e2de; color: #43493a; }
.badge-info { background-color: #d5e3fc; color: #0d1c2e; }
.badge-conflict { background-color: #ffdad6; color: #93000a; }
.badge-overdue { background-color: #ffdad6; color: #93000a; }
```

- [ ] **Step 4: Verify no remaining badge class usage**

Run: `cd frontend && grep -r "badge-confirmed\|badge-pending\|badge-cancelled\|badge-draft\|badge-info\|badge-conflict\|badge-overdue" src/ --include="*.tsx" --include="*.ts" --include="*.css"`
Expected: No results

- [ ] **Step 5: Verify build + commit**

Run: `cd frontend && npx tsc --noEmit && npm run build`

```bash
git add frontend/src/lib/utils.ts frontend/src/index.css
git commit -m "cleanup: remove getStatusColor() and .badge-* CSS classes"
```

---

## Phase 6: Verification

### Task 29: Final verification

- [ ] **Step 1: TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 2: Production build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Verify no remaining inline patterns**

Check for remaining inline patterns that should have been migrated:

```bash
# Remaining window.confirm usage (should be zero in list pages)
cd frontend && grep -rn "window.confirm" src/pages/ --include="*.tsx"

# Remaining inline modal wrappers (should only be in TemplateFormPanel which uses side panel pattern)
cd frontend && grep -rn "fixed inset-0 z-50" src/ --include="*.tsx"

# Remaining local inputClass/labelClass definitions (should only be in FormField.tsx)
cd frontend && grep -rn "const inputClass\|const labelClass" src/ --include="*.tsx"
```

Expected:
- `window.confirm`: zero results in pages (may remain in non-list contexts)
- `fixed inset-0 z-50`: only in `Modal.tsx` and `TemplateFormPanel.tsx` (side panel, intentionally excluded)
- `const inputClass`: only in `FormField.tsx`

- [ ] **Step 4: Commit any final fixes if needed**
