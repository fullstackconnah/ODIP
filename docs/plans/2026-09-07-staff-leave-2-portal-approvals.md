# Staff Leave + Recurring Unavailability — Portal + Approvals + Roster Board (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the frontend half of staff self-service leave/unavailability: a portal page where
staff request and withdraw leave/recurring unavailability, a coordinator approvals page that
decides them (including entering leave on behalf of staff), and the roster board/shift editor
updates that make pending vs. approved leave visible and gate override reasons correctly.

**Architecture:** Two new API-layer files (`api/types/leave.ts`, `api/hooks/leave.ts`) mirror the
backend contract from PR 1 exactly, following the existing per-domain types/hooks split. Two
shared form-modal components (`LeaveRequestFormModal`, `UnavailabilityFormModal`) hold the create
logic once and are reused unchanged by both the portal page (self-service, no staff picker) and
the coordinator approvals page ("Enter on behalf", staff picker added via a prop). The roster
board and shift editor pick up the new `RosterFindingDto.requiresReason` and `LeaveBarDto.kind`
fields PR 1 adds to the DTOs they already consume — no new endpoints are called from those two
files, only new fields read.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, TanStack Query, react-hook-form + zod,
react-router 7, Tailwind 4, vitest + Testing Library.

**Spec:** `docs/specs/2026-09-07-staff-leave-unavailability-design.md` — read it first; this plan
argues from it. Assumes PR 1 (backend) is merged and live exactly as the spec's §2/§3/§4 describe.

## Global Constraints

- Run all frontend commands from `odip-prototype/odip/frontend`. Repo root for `git` is
  `F:\Projects\personal\ODIP`; run `git` with `-c safe.directory=*`.
- Never touch `bin/`, `obj/`, `node_modules/`, `_to_delete/`, `docs/superpowers/`,
  `odip-prototype.zip`, `.claude/worktrees/`, `docs/specs/odip-updates-2026-09/`.
- Gates before every commit: `npm run build` (`tsc -b && vite build` — vitest does **not**
  typecheck, so a type error can pass `npm test` and still fail this), `npm test -- --run`. Lint
  gate is **"no NEW lint errors vs main"** (`npm run lint` has pre-existing debt) — check new/
  changed files with `npx eslint <files>`.
- Every control uses `Dropdown` / `SearchableSelect` from `src/components/` for choice inputs.
  **No native `<select>`.**
- `zod@4.5.2` + `@hookform/resolvers@3.10.0`: the resolver throws on zod validation failures
  before React ever re-renders with the error message, so **rendered validation text cannot be
  asserted in tests** — assert submit payloads and disabled/error-prop states instead. Do not
  bump either package (tracked separately, out of scope).
- `useWizard`/`useForm`'s derived arrays (schemas, item lists) that depend on props should be
  `useMemo`'d where the codebase already does so; don't introduce a new render-loop allocation
  pattern.
- Portal endpoints are self-scoping and 404 (never 403) on anything not the caller's own — this
  is a backend behaviour (PR 1), but the frontend must never assume a 403 shape when handling a
  portal-leave error.
- **Validation → status/message** (from the spec, for building error-surfacing code, even though
  PR 1 owns the checks): `EndDate < StartDate` (leave) → 400 "End date must be on or after the
  start date."; `StartTime >= EndTime` (recurring) → 400 "Start time must be before end time.";
  `EffectiveTo < EffectiveFrom` → 400 "Effective-to must be on or after effective-from."; exact
  duplicate of a non-cancelled request → 409 "An identical request already exists."; decline
  without `DecisionNote` → 400 "A decline reason is required."; cancel on a non-Pending leave
  request (staff) → 409 "Only pending requests can be withdrawn."; approve/decline/cancel on an
  already-decided request → 409 "This request has already been decided."; portal action on
  another user's request → 404.
- **Gate rule** (`RosterConflictService`/shift-and-trip writes, already implemented by PR 1,
  consumed here): any `Severity == Blocking` finding refuses the write regardless of override; a
  finding with `RequiresReason == true` requires a non-empty `overrideReason` plus its code in
  `acknowledgedFindingCodes`; a Warning finding with `RequiresReason == false` is saveable with no
  reason, but its code is still recorded in `acknowledgedFindingCodes`.
- **Enum values (wire, string-serialised):** `LeaveType`: `Annual | Sick | Personal | Other`.
  `LeaveStatus`: `Pending | Approved | Declined | Cancelled`. `UnavailabilityKind`:
  `ApprovedLeave | PendingLeave | RecurringRule | Legacy`. `DayOfWeek` on
  `RecurringUnavailabilityDto`: the seven full English day names (`Monday`…`Sunday`), matching
  `ShiftPatternDto.dayOfWeek`'s existing convention.
- **State-transition matrix** (`LeaveStatus`, identical for both entities): Pending →
  Approved (coordinator) | Declined (coordinator, note required) | Cancelled (staff, own,
  withdraw — or coordinator). Approved → Cancelled (coordinator only). Declined/Cancelled are
  terminal. An on-behalf entry (`POST /leave` or `POST /leave/unavailability`) starts directly at
  `Approved` — not a transition, the initial state.
- No hard delete anywhere in this feature — `Cancelled` is a status, not a removal.
- No email/push notifications exist or are added — the only "you have something waiting" signal
  is the pending-count badge computed at read time.

---

## File Structure

| File | Responsibility |
|---|---|
| Create `src/api/types/leave.ts` | `LeaveType`/`LeaveStatus`/`UnavailabilityKind` unions, all leave/unavailability DTOs |
| Modify `src/api/types/rostering.ts` | `RosterFindingDto.requiresReason`, `LeaveBarDto.kind` |
| Modify `src/api/types/index.ts` | barrel export for `./leave` |
| Modify `src/pages/rostering/test-fixtures.ts` | `makeFinding` gets a `requiresReason` default |
| Create `src/api/hooks/leave.ts` | Portal + coordinator TanStack Query hooks |
| Modify `src/api/hooks/index.ts` | barrel export for `./leave` |
| Modify `src/lib/permissions.ts` | `canRequestLeave`, `canApproveLeave`, two new `PageKey`s |
| Create `src/pages/rostering/test-fixtures-leave.ts` | `makeLeaveBar` (Task 4), `makeLeaveRequest`/`makeRecurringRule` (Task 7) |
| Modify `src/pages/rostering/components/LeaveBar.tsx` | `kind`-based styling |
| Modify `src/pages/rostering/components/ShiftSlideOver.tsx` | `reasonRequired` keys off `requiresReason`, not "any Warning" |
| Modify `src/pages/schedule/AvailabilityEditor.tsx` | drops "Add Leave"; links to `/rostering/leave` |
| Create `src/pages/portal/components/LeaveRequestFormModal.tsx` | Shared date-range leave form |
| Create `src/pages/portal/components/UnavailabilityFormModal.tsx` | Shared weekly-recurrence form |
| Create `src/pages/portal/PortalLeavePage.tsx` | `/portal/leave` — tabs, tables, withdraw |
| Modify `src/pages/portal/PortalShiftsPage.tsx` | header link to `/portal/leave` |
| Create `src/pages/rostering/LeaveApprovalsPage.tsx` | `/rostering/leave` — filters, approve/decline/cancel, enter-on-behalf |
| Modify `src/components/layout/AppLayout.tsx` | sidebar entry + pending-count badge |
| Modify `src/App.tsx` | two new routes |

---

## Task 1: Types — `leave.ts`, `RosterFindingDto.requiresReason`, `LeaveBarDto.kind`

**Files:**
- Create: `src/api/types/leave.ts`
- Modify: `src/api/types/rostering.ts:1-8` (imports + `RosterFindingDto`), `:60-65` (`LeaveBarDto`)
- Modify: `src/api/types/index.ts:30` (barrel)
- Modify: `src/pages/rostering/test-fixtures.ts:33-40` (`makeFinding` default)

**Interfaces:**
- Produces: `LeaveType`, `LEAVE_TYPES`, `LEAVE_TYPE_LABELS`, `LeaveStatus`, `LEAVE_STATUSES`,
  `LEAVE_STATUS_COLORS`, `UnavailabilityKind`, `UNAVAILABILITY_KINDS`, `LeaveRequestDto`,
  `CreateLeaveRequestDto`, `LeaveDecisionDto`, `ApproveLeaveResultDto`,
  `RecurringUnavailabilityDto`, `CreateRecurringUnavailabilityDto`,
  `ApproveRecurringUnavailabilityResultDto`, `MyLeaveResponseDto` — every later task's DTO
  vocabulary. `LEAVE_TYPE_LABELS` and `LEAVE_STATUS_COLORS` are the **single, shared** copies
  Task 7, Task 8 and Task 9 all import — no page redefines its own.
- Produces: `RosterFindingDto.requiresReason: boolean`; `LeaveBarDto.kind: UnavailabilityKind`,
  `.availabilityType: string | null`, `.startTime: string | null`, `.endTime: string | null`
  ("HH:mm:ss", populated only when `kind === 'RecurringRule'`).

This task is pure types (no runtime behaviour to TDD), so its "test" is the build plus the
existing suite, which must still pass with the new required fields threaded through.

- [ ] **Step 1: Write `src/api/types/leave.ts`**

```ts
import type { RosterFindingDto } from './rostering'

// ══════════════════════════════════════════════════════════════
// STAFF LEAVE + RECURRING UNAVAILABILITY — mirrors backend LeaveDTOs.cs
// docs/specs/2026-09-07-staff-leave-unavailability-design.md §1/§2
// ══════════════════════════════════════════════════════════════

export const LEAVE_TYPES = ['Annual', 'Sick', 'Personal', 'Other'] as const
export type LeaveType = typeof LEAVE_TYPES[number]

/** Single shared copy — Task 7's form modals (Dropdown items) and Task 8's PortalLeavePage
 * (table column) both import this rather than each defining their own. */
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  Annual: 'Annual',
  Sick: 'Sick',
  Personal: 'Personal',
  Other: 'Other',
}

export const LEAVE_STATUSES = ['Pending', 'Approved', 'Declined', 'Cancelled'] as const
export type LeaveStatus = typeof LEAVE_STATUSES[number]

/**
 * `StatusBadge`'s built-in `STATUS_COLORS` map (`src/components/StatusBadge.tsx:9-50`) has no
 * `approved`/`declined`/`pending`/`cancelled` keys of its own for this domain — `pending` only
 * exists there for an unrelated QSC status, and `approved`/`declined` don't exist at all, so
 * every `LeaveStatus` value would otherwise fall through to the same default amber colour
 * (`StatusBadge.tsx:52`, `DEFAULT_COLOR`), making Pending/Approved/Declined rows visually
 * indistinguishable. `StatusBadge` accepts an override via its `colorMap?: Record<string, string>`
 * prop (`StatusBadge.tsx:4`, looked up by the lower-cased status at `StatusBadge.tsx:55-56`) —
 * this is that override, shared by Task 8's `PortalLeavePage` and Task 9's `LeaveApprovalsPage`
 * so every leave/unavailability status badge in the app renders identically. Reuses the same
 * design-token classes `STATUS_COLORS` already uses for equivalent semantics elsewhere (pending →
 * its amber "awaiting decision" colour, approved → the primary "confirmed" colour, declined → the
 * error-container "rejected" colour, cancelled → the neutral "archived" colour).
 */
export const LEAVE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[#fef3c7] text-[#92400e]',
  approved: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  declined: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  cancelled: 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]',
}

/** Mirrors StaffUnavailabilityQuery.UnavailabilityKind — which of the three sources (plus the
 * legacy StaffAvailability table) a LeaveBarDto/roster-conflict window came from. */
export const UNAVAILABILITY_KINDS = ['ApprovedLeave', 'PendingLeave', 'RecurringRule', 'Legacy'] as const
export type UnavailabilityKind = typeof UNAVAILABILITY_KINDS[number]

// ── Leave request (date-range) ────────────────────────────

export interface LeaveRequestDto {
  id: string
  userId: string
  userFullName: string
  leaveType: LeaveType
  startDate: string
  endDate: string
  status: LeaveStatus
  reason: string | null
  requestedByUserId: string
  requestedAt: string
  decidedByUserId: string | null
  decidedAt: string | null
  decisionNote: string | null
}

export interface CreateLeaveRequestDto {
  leaveType: LeaveType
  startDate: string
  endDate: string
  reason?: string | null
  /** Ignored by the portal path (always the caller's own id); required on POST /leave (400 if missing). */
  userId?: string | null
}

export interface LeaveDecisionDto {
  decisionNote: string
}

/** POST /leave/{id}/approve response — approval is never blocked by overlaps; the UI shows them. */
export interface ApproveLeaveResultDto {
  leave: LeaveRequestDto
  overlaps: RosterFindingDto[]
}

// ── Recurring weekly unavailability ───────────────────────

export interface RecurringUnavailabilityDto {
  id: string
  userId: string
  userFullName: string
  dayOfWeek: string
  startTime: string
  endTime: string
  effectiveFrom: string
  effectiveTo: string | null
  notes: string | null
  status: LeaveStatus
  requestedByUserId: string
  requestedAt: string
  decidedByUserId: string | null
  decidedAt: string | null
  decisionNote: string | null
}

export interface CreateRecurringUnavailabilityDto {
  dayOfWeek: string
  startTime: string
  endTime: string
  effectiveFrom: string
  effectiveTo?: string | null
  notes?: string | null
  userId?: string | null
}

export interface ApproveRecurringUnavailabilityResultDto {
  unavailability: RecurringUnavailabilityDto
  overlaps: RosterFindingDto[]
}

// ── Portal combined response ──────────────────────────────

/** GET /portal/leave */
export interface MyLeaveResponseDto {
  leave: LeaveRequestDto[]
  unavailability: RecurringUnavailabilityDto[]
}
```

- [ ] **Step 2: Extend `RosterFindingDto` and `LeaveBarDto` in `rostering.ts`**

At the top of `src/api/types/rostering.ts`, alongside the existing import:

```ts
import type { SupportRatio, SleepoverType, ShiftStatus, CompatibilityLevel, RosterFindingSeverity, RosterComplianceLevel } from './enums'
import type { UnavailabilityKind } from './leave'
```

Change the `RosterFindingDto` interface (`rostering.ts:4-8`):

```ts
export interface RosterFindingDto {
  code: string
  severity: RosterFindingSeverity
  message: string
  /** True when a Warning finding requires a non-empty overrideReason before it can be saved
   * (e.g. STAFF_ON_LEAVE); false when it's a soft warning acknowledged with no reason (e.g.
   * STAFF_LEAVE_PENDING). Always false on a Blocking finding — Blocking can never be overridden. */
  requiresReason: boolean
}
```

Change `LeaveBarDto` (`rostering.ts:60-65`):

```ts
export interface LeaveBarDto {
  startDate: string
  endDate: string
  availabilityType: string | null
  notes: string | null
  /** Which of the leave/unavailability/legacy sources this bar represents — drives LeaveBar's styling. */
  kind: UnavailabilityKind
  /** "HH:mm:ss" (TimeOnly). Populated only when kind === 'RecurringRule' — every other kind has
   * these null, since a date-range leave/legacy row has no time-of-day component. Drives
   * LeaveBar's partial-day rendering (Task 4). */
  startTime: string | null
  endTime: string | null
}
```

- [ ] **Step 3: Barrel export**

In `src/api/types/index.ts`, after line 30 (`export * from './rostering'`):

```ts
export * from './leave'
```

- [ ] **Step 4: Update the shared `makeFinding` fixture**

In `src/pages/rostering/test-fixtures.ts`, `makeFinding` (lines 33-40):

```ts
export function makeFinding(overrides: Partial<RosterFindingDto> = {}): RosterFindingDto {
  return {
    code: 'DOUBLE_BOOKED',
    severity: 'Warning',
    message: 'Staff member is already rostered elsewhere at this time.',
    requiresReason: false,
    ...overrides,
  }
}
```

- [ ] **Step 5: Build and run the full suite**

Run: `npm run build`
Expected: 0 TypeScript errors — confirms no other file constructs a `RosterFindingDto`/
`LeaveBarDto` literal without the new required field (every existing test that builds one goes
through `makeFinding`, which now supplies the default).

Run: `npm test -- --run`
Expected: same pass count as before this change — the new field is additive and defaulted.

- [ ] **Step 6: Commit**

```bash
git add src/api/types/leave.ts src/api/types/rostering.ts src/api/types/index.ts src/pages/rostering/test-fixtures.ts
git commit -m "feat(leave): types for staff leave + recurring unavailability, requiresReason/kind on rostering DTOs"
```

---

## Task 2: API hooks — `leave.ts`

**Files:**
- Create: `src/api/hooks/leave.ts`
- Modify: `src/api/hooks/index.ts:38` (barrel)
- Test: `src/api/hooks/leave.test.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiGetWithDefault`, `apiPost` from `../client`; every DTO from Task 1.
- Produces: `useMyLeave`, `useCreateLeaveRequest`, `useCancelMyLeave`, `useCreateMyUnavailability`,
  `useCancelMyUnavailability`, `useLeaveRequests(filters)`, `useRecurringUnavailabilities(filters)`,
  `usePendingLeaveCount(): number`, `useCreateLeaveOnBehalf`, `useApproveLeave`, `useDeclineLeave`,
  `useCancelLeave`, `useCreateUnavailabilityOnBehalf`, `useApproveUnavailability`,
  `useDeclineUnavailability`, `useCancelUnavailability`, and the `LeaveListFilters` type. Later
  tasks import all of these from the `@/api/hooks` barrel, not from this file directly (matches
  the rest of the codebase's import convention — see `ShiftSlideOver.tsx`).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockApiGet, mockApiGetWithDefault, mockApiPost } = vi.hoisted(() => ({
  mockApiGet: vi.fn(async () => ({ leave: [], unavailability: [] })),
  mockApiGetWithDefault: vi.fn(async () => []),
  mockApiPost: vi.fn(async () => ({})),
}))

vi.mock('../client', () => ({
  apiGet: mockApiGet,
  apiGetWithDefault: mockApiGetWithDefault,
  apiPost: mockApiPost,
}))

import {
  useMyLeave, useCreateLeaveRequest, useCancelMyLeave, useCreateMyUnavailability, useCancelMyUnavailability,
  useLeaveRequests, useRecurringUnavailabilities, usePendingLeaveCount,
  useCreateLeaveOnBehalf, useApproveLeave, useDeclineLeave, useCancelLeave,
  useCreateUnavailabilityOnBehalf, useApproveUnavailability, useDeclineUnavailability, useCancelUnavailability,
} from './leave'

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  mockApiGet.mockClear()
  mockApiGetWithDefault.mockClear().mockResolvedValue([])
  mockApiPost.mockClear().mockResolvedValue({})
})

describe('leave hooks — portal (self-service)', () => {
  it('useMyLeave reads GET /portal/leave', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useMyLeave(), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/portal/leave')
  })

  it('useCreateLeaveRequest posts to /portal/leave and invalidates portal-my-leave', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateLeaveRequest(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18' })
    expect(mockApiPost).toHaveBeenCalledWith('/portal/leave', { leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['portal-my-leave'] })
  })

  it('useCancelMyLeave posts to /portal/leave/{id}/cancel', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCancelMyLeave(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('leave-1')
    expect(mockApiPost).toHaveBeenCalledWith('/portal/leave/leave-1/cancel')
    expect(spy).toHaveBeenCalledWith({ queryKey: ['portal-my-leave'] })
  })

  it('useCreateMyUnavailability posts to /portal/unavailability', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useCreateMyUnavailability(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ dayOfWeek: 'Monday', startTime: '09:00', endTime: '12:00', effectiveFrom: '2026-09-07' })
    expect(mockApiPost).toHaveBeenCalledWith('/portal/unavailability', { dayOfWeek: 'Monday', startTime: '09:00', endTime: '12:00', effectiveFrom: '2026-09-07' })
  })

  it('useCancelMyUnavailability posts to /portal/unavailability/{id}/cancel', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useCancelMyUnavailability(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('rule-1')
    expect(mockApiPost).toHaveBeenCalledWith('/portal/unavailability/rule-1/cancel')
  })
})

describe('leave hooks — coordinator', () => {
  it('useLeaveRequests reads GET /leave with filters', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useLeaveRequests({ status: 'Pending' }), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGetWithDefault).toHaveBeenCalledWith('/leave', [], { status: 'Pending' })
  })

  it('useRecurringUnavailabilities reads GET /leave/unavailability with filters', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useRecurringUnavailabilities({ userId: 'staff-1' }), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGetWithDefault).toHaveBeenCalledWith('/leave/unavailability', [], { userId: 'staff-1' })
  })

  it('usePendingLeaveCount derives a count from the same Pending list', async () => {
    mockApiGetWithDefault.mockResolvedValueOnce([{ id: '1' }, { id: '2' }])
    const qc = new QueryClient()
    const { result } = renderHook(() => usePendingLeaveCount(), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current).toBe(2))
    expect(mockApiGetWithDefault).toHaveBeenCalledWith('/leave', [], { status: 'Pending' })
  })

  it('useCreateLeaveOnBehalf posts to /leave and invalidates leave-requests + roster-board', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateLeaveOnBehalf(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18', userId: 'staff-1' })
    expect(mockApiPost).toHaveBeenCalledWith('/leave', { leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18', userId: 'staff-1' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['leave-requests'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['roster-board'] })
  })

  it('useApproveLeave posts to /leave/{id}/approve and invalidates leave-requests + roster-board', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useApproveLeave(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('leave-1')
    expect(mockApiPost).toHaveBeenCalledWith('/leave/leave-1/approve')
    expect(spy).toHaveBeenCalledWith({ queryKey: ['leave-requests'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['roster-board'] })
  })

  it('useDeclineLeave posts the decision note to /leave/{id}/decline', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useDeclineLeave(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ id: 'leave-1', data: { decisionNote: 'Not enough notice' } })
    expect(mockApiPost).toHaveBeenCalledWith('/leave/leave-1/decline', { decisionNote: 'Not enough notice' })
  })

  it('useCancelLeave posts to /leave/{id}/cancel', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useCancelLeave(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('leave-1')
    expect(mockApiPost).toHaveBeenCalledWith('/leave/leave-1/cancel')
  })

  it('useCreateUnavailabilityOnBehalf posts to /leave/unavailability', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useCreateUnavailabilityOnBehalf(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ dayOfWeek: 'Monday', startTime: '09:00', endTime: '12:00', effectiveFrom: '2026-09-07', userId: 'staff-1' })
    expect(mockApiPost).toHaveBeenCalledWith('/leave/unavailability', { dayOfWeek: 'Monday', startTime: '09:00', endTime: '12:00', effectiveFrom: '2026-09-07', userId: 'staff-1' })
  })

  it('useApproveUnavailability posts to /leave/unavailability/{id}/approve', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useApproveUnavailability(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('rule-1')
    expect(mockApiPost).toHaveBeenCalledWith('/leave/unavailability/rule-1/approve')
  })

  it('useDeclineUnavailability posts the decision note to /leave/unavailability/{id}/decline', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useDeclineUnavailability(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ id: 'rule-1', data: { decisionNote: 'Roster gap' } })
    expect(mockApiPost).toHaveBeenCalledWith('/leave/unavailability/rule-1/decline', { decisionNote: 'Roster gap' })
  })

  it('useCancelUnavailability posts to /leave/unavailability/{id}/cancel', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useCancelUnavailability(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('rule-1')
    expect(mockApiPost).toHaveBeenCalledWith('/leave/unavailability/rule-1/cancel')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/api/hooks/leave.test.tsx`
Expected: module not found — `./leave` does not exist yet.

- [ ] **Step 3: Implement**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiGetWithDefault, apiPost } from '../client'
import type {
  MyLeaveResponseDto,
  LeaveRequestDto,
  CreateLeaveRequestDto,
  LeaveDecisionDto,
  ApproveLeaveResultDto,
  RecurringUnavailabilityDto,
  CreateRecurringUnavailabilityDto,
  ApproveRecurringUnavailabilityResultDto,
  LeaveStatus,
} from '../types'

// ══════════════════════════════════════════════════════════════
// PORTAL (self-service) — mirrors PortalController's leave/unavailability actions
// ══════════════════════════════════════════════════════════════

export function useMyLeave() {
  return useQuery({
    queryKey: ['portal-my-leave'],
    queryFn: () => apiGet<MyLeaveResponseDto>('/portal/leave'),
  })
}

export function useCreateLeaveRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateLeaveRequestDto) => apiPost<LeaveRequestDto>('/portal/leave', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-my-leave'] }),
  })
}

export function useCancelMyLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<LeaveRequestDto>(`/portal/leave/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-my-leave'] }),
  })
}

export function useCreateMyUnavailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateRecurringUnavailabilityDto) => apiPost<RecurringUnavailabilityDto>('/portal/unavailability', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-my-leave'] }),
  })
}

export function useCancelMyUnavailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<RecurringUnavailabilityDto>(`/portal/unavailability/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-my-leave'] }),
  })
}

// ══════════════════════════════════════════════════════════════
// COORDINATOR — mirrors LeaveController (api/v1/leave)
// ══════════════════════════════════════════════════════════════

export type LeaveListFilters = { status?: LeaveStatus; userId?: string; from?: string; to?: string }

/**
 * Polled every 60s (like usePendingWitnessRequests) so the sidebar badge and this page's default
 * Pending filter both stay fresh without a page revisit. A caller passing the identical filters
 * object shares this cache entry — usePendingLeaveCount and LeaveApprovalsPage's default view
 * read the same request when both resolve to { status: 'Pending' }.
 */
export function useLeaveRequests(filters: LeaveListFilters = {}) {
  return useQuery({
    queryKey: ['leave-requests', filters],
    queryFn: () => apiGetWithDefault<LeaveRequestDto[]>('/leave', [], filters),
    refetchInterval: 60_000,
  })
}

export function useRecurringUnavailabilities(filters: LeaveListFilters = {}) {
  return useQuery({
    queryKey: ['recurring-unavailabilities', filters],
    queryFn: () => apiGetWithDefault<RecurringUnavailabilityDto[]>('/leave/unavailability', [], filters),
    refetchInterval: 60_000,
  })
}

/** Sidebar/nav badge count — shares the ['leave-requests', { status: 'Pending' }] cache entry
 * with LeaveApprovalsPage's default filter. */
export function usePendingLeaveCount(): number {
  const { data } = useLeaveRequests({ status: 'Pending' })
  return data?.length ?? 0
}

export function useCreateLeaveOnBehalf() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateLeaveRequestDto) => apiPost<LeaveRequestDto>('/leave', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useApproveLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<ApproveLeaveResultDto>(`/leave/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useDeclineLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: LeaveDecisionDto }) => apiPost<LeaveRequestDto>(`/leave/${id}/decline`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave-requests'] }),
  })
}

export function useCancelLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<LeaveRequestDto>(`/leave/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useCreateUnavailabilityOnBehalf() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateRecurringUnavailabilityDto) => apiPost<RecurringUnavailabilityDto>('/leave/unavailability', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-unavailabilities'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useApproveUnavailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<ApproveRecurringUnavailabilityResultDto>(`/leave/unavailability/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-unavailabilities'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useDeclineUnavailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: LeaveDecisionDto }) => apiPost<RecurringUnavailabilityDto>(`/leave/unavailability/${id}/decline`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-unavailabilities'] }),
  })
}

export function useCancelUnavailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<RecurringUnavailabilityDto>(`/leave/unavailability/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-unavailabilities'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}
```

- [ ] **Step 4: Barrel export**

In `src/api/hooks/index.ts`, after line 38 (`export * from './portal'`):

```ts
export * from './leave'
```

- [ ] **Step 5: Run to confirm pass**

Run: `npx vitest run src/api/hooks/leave.test.tsx`
Expected: `Test Files 1 passed`, all 16 tests passed.

- [ ] **Step 6: Full build + suite**

Run: `npm run build && npm test -- --run`
Expected: 0 errors; no regressions elsewhere.

- [ ] **Step 7: Commit**

```bash
git add src/api/hooks/leave.ts src/api/hooks/leave.test.tsx src/api/hooks/index.ts
git commit -m "feat(leave): portal + coordinator TanStack Query hooks for leave/unavailability"
```

---

## Task 3: `permissions.ts` — `canRequestLeave`, `canApproveLeave`, two `PageKey`s

**Files:**
- Modify: `src/lib/permissions.ts:3-20` (`PageKey`), `:22-31` (`SUPPORT_WORKER_PAGES`), `:195-207` (new booleans before the closing brace)
- Test: `src/lib/permissions.test.tsx` (extend)

**Interfaces:**
- Produces: `canRequestLeave: boolean`, `canApproveLeave: boolean` on `usePermissions()`'s return;
  `PageKey` gains `'portal-leave'` and `'leave-approvals'`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/permissions.test.tsx`, after the existing `PermissionsProbe` function (it already
imports `render`, `screen`, `usePermissions`, `PageKey`, `UserRole` — no new imports needed):

```tsx
function CapabilityProbe() {
  const { canRequestLeave, canApproveLeave } = usePermissions()
  return (
    <ul>
      <li data-testid="can-request-leave">{String(canRequestLeave)}</li>
      <li data-testid="can-approve-leave">{String(canApproveLeave)}</li>
    </ul>
  )
}
```

Then, after the existing `describe('usePermissions.canAccessPage', ...)` block:

```tsx
describe('usePermissions leave capabilities', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('canRequestLeave is true for every role except ReadOnly', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator', 'SupportWorker'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-request-leave')).toHaveTextContent('true')
      unmount()
    }
  })

  it('canRequestLeave is false for ReadOnly', () => {
    setUserRole('ReadOnly')
    render(<CapabilityProbe />)
    expect(screen.getByTestId('can-request-leave')).toHaveTextContent('false')
  })

  it('canApproveLeave is true only for Admin, Coordinator and SuperAdmin', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-approve-leave')).toHaveTextContent('true')
      unmount()
    }
    for (const role of ['SupportWorker', 'ReadOnly'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-approve-leave')).toHaveTextContent('false')
      unmount()
    }
  })
})

describe('usePermissions.canAccessPage — leave pages', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('includes portal-leave in the SupportWorker allowlist', () => {
    setUserRole('SupportWorker')
    render(<PermissionsProbe pages={['portal-leave']} />)
    expect(screen.getByTestId('page-portal-leave')).toHaveTextContent('true')
  })

  it('excludes leave-approvals from the SupportWorker allowlist', () => {
    setUserRole('SupportWorker')
    render(<PermissionsProbe pages={['leave-approvals']} />)
    expect(screen.getByTestId('page-leave-approvals')).toHaveTextContent('false')
  })

  it('allows a non-SupportWorker role onto leave-approvals', () => {
    setUserRole('Coordinator')
    render(<PermissionsProbe pages={['leave-approvals']} />)
    expect(screen.getByTestId('page-leave-approvals')).toHaveTextContent('true')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/permissions.test.tsx`
Expected: FAIL — `canRequestLeave`/`canApproveLeave` are `undefined`, and `'portal-leave'`/
`'leave-approvals'` are not assignable to `PageKey`.

- [ ] **Step 3: Extend `PageKey` and `SUPPORT_WORKER_PAGES`**

```ts
export type PageKey =
  | 'dashboard'
  | 'portal'
  | 'portal-leave'
  | 'trips'
  | 'schedule'
  | 'participants'
  | 'accommodation'
  | 'vehicles'
  | 'staff'
  | 'tasks'
  | 'incidents'
  | 'bookings'
  | 'qualifications'
  | 'claims'
  | 'billing'
  | 'rostering'
  | 'leave-approvals'
  | 'settings'
  | 'medications';

const SUPPORT_WORKER_PAGES: PageKey[] = [
  'dashboard',
  'portal',
  'portal-leave',
  'trips',
  'schedule',
  'participants',
  'tasks',
  'incidents',
  'medications',
];
```

`leave-approvals` is deliberately **not** added to `SUPPORT_WORKER_PAGES` — like `rostering`, it
falls through to `canAccessPage`'s default (`return true` for any non-SupportWorker role), the
same pattern the existing `rostering` entry already uses.

- [ ] **Step 4: Add the two capability booleans**

Immediately before the closing `};` of the object `usePermissions()` returns (after
`showBankDetails`):

```ts
    /** Mirrors PortalController's leave endpoints — any non-ReadOnly authenticated user. */
    canRequestLeave: !isReadOnly,

    /** Mirrors LeaveController's [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]. */
    canApproveLeave: isSuperAdmin || isAdmin || isCoordinator,
```

- [ ] **Step 5: Run to confirm pass**

Run: `npx vitest run src/lib/permissions.test.tsx`
Expected: all tests pass (existing + new).

- [ ] **Step 6: Full build + suite, commit**

Run: `npm run build && npm test -- --run`

```bash
git add src/lib/permissions.ts src/lib/permissions.test.tsx
git commit -m "feat(leave): canRequestLeave/canApproveLeave, portal-leave + leave-approvals PageKeys"
```

---

## Task 4: `LeaveBar.tsx` — `kind` styling + `test-fixtures-leave.ts`

**Files:**
- Create: `src/pages/rostering/test-fixtures-leave.ts` (starts with `makeLeaveBar`; Task 7 extends it)
- Modify: `src/pages/rostering/components/LeaveBar.tsx` (full file, currently 23 lines)
- Test: `src/pages/rostering/components/LeaveBar.test.tsx`

**Interfaces:**
- Consumes: `LeaveBarDto` (Task 1), `clampedDayIndex` (`../lib/roster`, unchanged).
- Produces: `makeLeaveBar(overrides?): LeaveBarDto` for every later test that renders a leave bar.

Per the spec (§4), `PendingLeave` gets a distinct treatment (dashed border + a "(pending)" label
suffix) and `ApprovedLeave`/`Legacy` keep today's identical solid muted full-day bar.
`RecurringRule` is different again: the spec requires it to render as a **partial-day** bar,
positioned/sized within its single day cell in proportion to its `startTime`/`endTime` — not a
full-width bar with a text label. A recurring rule's single-weekday occurrence already clips to
the visible week correctly through the existing `clampedDayIndex` math (`start === end` for that
occurrence, so `gridColumn` spans exactly one day column) — no new day-*clipping* logic is
needed. But there is **no existing hour-proportional positioning helper anywhere in
`src/pages/rostering/`** to reuse for the within-day sizing: the whole roster board is
day-granularity only — `ShiftChip`/`RosterDayCell` render a shift as a whole day-cell chip with
no time-of-day width/left math at all, and every other bar (`TripBar`, the pre-existing
`LeaveBar`) spans whole `gridColumn` units the same way (`TripBar.tsx:18-19`,
`clampedDayIndex(...)+1` / `+2`). `StaffRow.tsx`'s `meterPct` (`StaffRow.tsx:23`) is a `width: %`
too, but it's an unrelated hours-rostered-vs-target progress bar, not a time-of-day position.
This task therefore **adds** a small new helper (`timeOfDayPercent`, in `LeaveBar.tsx` itself,
not `roster.ts` — it's single-purpose to this one component, unlike the day-math in `roster.ts`
that several bar types share) rather than reusing one, since none exists. It maps minutes-since-
midnight over the full 24-hour day (`0–100%`) — the board has no narrower "visible business
hours" window defined anywhere today, so 24h is the only well-defined range available.

- [ ] **Step 1: Write the fixture file**

```ts
import type { LeaveBarDto } from '@/api/types'

export function makeLeaveBar(overrides: Partial<LeaveBarDto> = {}): LeaveBarDto {
  return {
    startDate: '2026-09-14',
    endDate: '2026-09-18',
    availabilityType: 'Annual',
    notes: null,
    kind: 'ApprovedLeave',
    startTime: null,
    endTime: null,
    ...overrides,
  }
}
```

- [ ] **Step 2: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LeaveBar } from './LeaveBar'
import { makeLeaveBar } from '../test-fixtures-leave'

const DAYS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']

describe('LeaveBar kind handling', () => {
  it('renders an approved leave bar as the existing solid muted style, with no "(pending)" suffix', () => {
    const leave = makeLeaveBar({ kind: 'ApprovedLeave', availabilityType: 'Annual' })
    render(<LeaveBar leave={leave} days={DAYS} />)
    const label = screen.getByText('Annual')
    expect(label.parentElement).not.toHaveClass('border-dashed')
    expect(label.parentElement).toHaveClass('bg-muted')
  })

  it('renders a legacy StaffAvailability bar the same solid style as approved leave', () => {
    const leave = makeLeaveBar({ kind: 'Legacy', availabilityType: 'Training' })
    render(<LeaveBar leave={leave} days={DAYS} />)
    const label = screen.getByText('Training')
    expect(label.parentElement).not.toHaveClass('border-dashed')
  })

  it('falls back to "Unavailable" when availabilityType is null', () => {
    const leave = makeLeaveBar({ kind: 'ApprovedLeave', availabilityType: null })
    render(<LeaveBar leave={leave} days={DAYS} />)
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })

  it('renders a pending leave bar dashed, with a "(pending)" suffix on the label', () => {
    const leave = makeLeaveBar({ kind: 'PendingLeave', availabilityType: 'Sick' })
    render(<LeaveBar leave={leave} days={DAYS} />)
    const label = screen.getByText('Sick (pending)')
    expect(label.parentElement).toHaveClass('border-dashed')
  })

  it('still clamps/spans the bar across the visible week the same way regardless of kind', () => {
    const leave = makeLeaveBar({ kind: 'PendingLeave', startDate: '2026-09-05', endDate: '2026-09-20' })
    render(<LeaveBar leave={leave} days={DAYS} />)
    expect(screen.getByText(/pending/i).parentElement).toHaveStyle({ gridColumn: '1 / 8' })
  })

  it('renders a recurring-rule bar as a partial-day block positioned/sized by its time window, not the full-day muted bar', () => {
    const leave = makeLeaveBar({
      kind: 'RecurringRule', availabilityType: 'Unavailable',
      startDate: '2026-09-08', endDate: '2026-09-08', startTime: '09:00:00', endTime: '12:00:00',
    })
    render(<LeaveBar leave={leave} days={DAYS} />)
    // The time window renders as the label — this is what makes it read as "a slice of the day,"
    // not the availabilityType text a full-day bar shows.
    const block = screen.getByText('09:00–12:00')
    expect(block.parentElement).toHaveStyle({ left: '37.5%', width: '12.5%' })
    // No full-day solid styling classes leak onto the partial-day markup.
    expect(block.parentElement).not.toHaveClass('bg-muted/40')
  })

  it('recurring-rule block spans exactly its one occurrence day, not the whole visible week', () => {
    const leave = makeLeaveBar({
      kind: 'RecurringRule', startDate: '2026-09-09', endDate: '2026-09-09', startTime: '13:00:00', endTime: '17:00:00',
    })
    render(<LeaveBar leave={leave} days={DAYS} />)
    // 2026-09-09 is DAYS[2] → 1-based grid column 3, spanning to column 4 (one day wide).
    expect(screen.getByText('13:00–17:00').closest('[style*="grid-column"]')).toHaveStyle({ gridColumn: '3 / 4' })
  })
})
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run src/pages/rostering/components/LeaveBar.test.tsx`
Expected: FAIL — `makeLeaveBar` produces `kind`/`startTime`/`endTime` fields `LeaveBar` doesn't
read yet, so every bar renders the old always-solid style with no partial-day block, and the
pending/recurring/null-label assertions all fail.

- [ ] **Step 4: Implement**

```tsx
import type { LeaveBarDto } from '@/api/types'
import { clampedDayIndex } from '../lib/roster'

export type LeaveBarProps = {
  leave: LeaveBarDto
  days: string[]
}

/** Minutes-since-midnight as a 0–100 percentage of the full 24h day. There is no narrower
 * "visible business hours" window defined anywhere in the roster board today — every other bar
 * (TripBar, this component's own full-day branch) positions only at day granularity via
 * `gridColumn`, and RosterDayCell/ShiftChip render a shift as a whole day-cell chip with no
 * time-of-day width/left math at all — so this maps the full day rather than reusing a narrower
 * range that doesn't exist. */
function timeOfDayPercent(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return ((hours * 60 + minutes) / (24 * 60)) * 100
}

/**
 * Read-only leave/unavailability bar — muted and italic so it reads as background information,
 * not a task. `kind` distinguishes the sources StaffUnavailabilityQuery unions into this same
 * lane. ApprovedLeave and Legacy (pre-existing StaffAvailability Unavailable/Training rows)
 * render as today's solid full-day muted bar unchanged. PendingLeave renders the same full-day
 * bar with a dashed border and a "(pending)" suffix, since a shift over it only raises the soft,
 * no-reason-required STAFF_LEAVE_PENDING warning until a coordinator approves it. RecurringRule
 * is different in kind, not just style: the spec requires it to render as a **partial-day** bar,
 * positioned/sized within its single occurrence day in proportion to startTime/endTime, not a
 * full-width bar with an availabilityType label. Its single-weekday occurrence for the visible
 * week arrives here as its own startDate === endDate row — clampedDayIndex already clips that to
 * exactly one grid column with no extra logic; timeOfDayPercent (above) is new, since no
 * hour-proportional positioning helper exists anywhere in the roster board to reuse.
 */
export function LeaveBar({ leave, days }: LeaveBarProps) {
  const startCol = clampedDayIndex(leave.startDate, days) + 1
  const endCol = clampedDayIndex(leave.endDate, days) + 2

  if (leave.kind === 'RecurringRule' && leave.startTime && leave.endTime) {
    const leftPct = timeOfDayPercent(leave.startTime)
    // Floors the visible width so a very short window (e.g. 30 minutes, ~2% of a day) still
    // renders as a clickable/legible sliver instead of collapsing to near-nothing.
    const widthPct = Math.max(timeOfDayPercent(leave.endTime) - leftPct, 4)
    const windowLabel = `${leave.startTime.slice(0, 5)}–${leave.endTime.slice(0, 5)}`
    const title = leave.notes ?? `${leave.availabilityType ?? 'Unavailable'} ${windowLabel}`

    return (
      <div style={{ gridColumn: `${startCol} / ${endCol}` }} className="relative min-h-[1.75rem]">
        <div
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          className="absolute inset-y-0 flex items-center gap-1 overflow-hidden rounded-sm bg-muted px-1 text-[11px] italic text-muted-foreground"
          title={title}
        >
          <span className="min-w-0 flex-1 truncate">{windowLabel}</span>
        </div>
      </div>
    )
  }

  const pending = leave.kind === 'PendingLeave'
  const label = pending ? `${leave.availabilityType ?? 'Unavailable'} (pending)` : leave.availabilityType ?? 'Unavailable'

  return (
    <div
      style={{ gridColumn: `${startCol} / ${endCol}` }}
      className={`flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs italic text-muted-foreground ${
        pending ? 'border border-dashed border-muted-foreground bg-muted/40' : 'bg-muted'
      }`}
      title={leave.notes ?? label}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  )
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `npx vitest run src/pages/rostering/components/LeaveBar.test.tsx`
Expected: `Test Files 1 passed`, 7 tests passed.

- [ ] **Step 6: Full suite + build, commit**

Run: `npm run build && npm test -- --run`

```bash
git add src/pages/rostering/test-fixtures-leave.ts src/pages/rostering/components/LeaveBar.tsx src/pages/rostering/components/LeaveBar.test.tsx
git commit -m "feat(leave): LeaveBar kind styling — pending dashed, approved/recurring/legacy unchanged"
```

---

## Task 5: `ShiftSlideOver.tsx` — `reasonRequired` keys off `requiresReason`

**Files:**
- Modify: `src/pages/rostering/components/ShiftSlideOver.tsx:158-160` (derived findings), `:162-202`
  (`handleSave`), `:193-201` (catch block), `:418-433` (override-reason `FormField`)
- Test: `src/pages/rostering/components/ShiftSlideOver.test.tsx` (extend the existing
  `describe('ShiftSlideOver override gate', ...)` block)

**Interfaces:**
- Consumes: `RosterFindingDto.requiresReason` (Task 1).
- Produces: unchanged public props/behaviour except which findings force a reason.

Today's gate treats **any** `Warning` finding as reason-required. The spec narrows this: only a
`Warning` with `requiresReason: true` (e.g. `STAFF_ON_LEAVE`) forces a reason; a soft warning like
`STAFF_LEAVE_PENDING` (`requiresReason: false`) is saveable with no reason typed, though its code
is still recorded in `acknowledgedFindingCodes` exactly as before.

- [ ] **Step 1: Update the two existing tests that assumed "any Warning ⇒ required"**

In `ShiftSlideOver.test.tsx`, the test `'blocks save with Warning findings and an empty reason'`
currently builds `makeFinding({ severity: 'Warning', message: 'Needs a look' })` — add
`requiresReason: true` so it keeps testing the required path after Task 5's behaviour change:

```tsx
    const shift = makeShift({
      findings: [makeFinding({ severity: 'Warning', message: 'Needs a look', requiresReason: true })],
      overrideReason: null,
    })
```

The test `'enables save with Warning findings once a reason is entered...'` similarly builds
`makeFinding({ code: 'RATIO_SHORTFALL', severity: 'Warning', message: 'Ratio not met' })` — add
`requiresReason: true` there too:

```tsx
    const shift = makeShift({
      findings: [makeFinding({ code: 'RATIO_SHORTFALL', severity: 'Warning', message: 'Ratio not met', requiresReason: true })],
      overrideReason: null,
    })
```

- [ ] **Step 2: Write the two new failing tests**

Add to the same `describe('ShiftSlideOver override gate', ...)` block:

```tsx
  it('allows save with a Warning finding that does not require a reason, still recording its code in acknowledgedFindingCodes', async () => {
    const user = userEvent.setup()
    const shift = makeShift({
      findings: [makeFinding({ code: 'STAFF_LEAVE_PENDING', severity: 'Warning', message: 'Pending leave overlaps this window.', requiresReason: false })],
      overrideReason: null,
    })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const saveButton = screen.getByRole('button', { name: /save with override/i })
    expect(saveButton).not.toBeDisabled()

    await user.click(saveButton)

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockUpdateMutateAsync.mock.calls[0]
    expect(call.data.overrideReason).toBeNull()
    expect(call.data.acknowledgedFindingCodes).toEqual(['STAFF_LEAVE_PENDING'])
    expect(screen.queryByText(/a reason is required to save with open warnings/i)).not.toBeInTheDocument()
  })

  it('renders the override-reason field as optional when the only Warning present does not require a reason', () => {
    const shift = makeShift({
      findings: [makeFinding({ code: 'STAFF_LEAVE_PENDING', severity: 'Warning', requiresReason: false })],
      overrideReason: null,
    })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByLabelText(/reason for override/i)
    expect(field).not.toHaveAttribute('aria-required', 'true')
  })
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run src/pages/rostering/components/ShiftSlideOver.test.tsx`
Expected: the two updated tests still pass (old behaviour), the two new tests FAIL — the current
code requires a reason for `STAFF_LEAVE_PENDING` because it's a Warning, and marks the field
`required`.

- [ ] **Step 4: Implement**

Change the derived findings (`ShiftSlideOver.tsx:158-160`):

```ts
  const blockingFindings = findings.filter(f => f.severity === 'Blocking')
  const warningFindings = findings.filter(f => f.severity === 'Warning')
  // A Warning finding only forces a reason when the backend marks it requiresReason (e.g.
  // STAFF_ON_LEAVE) — a soft warning like STAFF_LEAVE_PENDING can be acknowledged with no reason
  // typed, though its code is still recorded in acknowledgedFindingCodes below.
  const reasonRequiredFindings = warningFindings.filter(f => f.requiresReason)
  const isBusy = createShift.isPending || updateShift.isPending
```

Change `handleSave`'s gate (was `if (warningFindings.length > 0 && !overrideReason.trim())`):

```ts
  async function handleSave() {
    setError(null)
    if (blockingFindings.length > 0) return
    if (reasonRequiredFindings.length > 0 && !overrideReason.trim()) {
      setReasonRequired(true)
      return
    }
    setReasonRequired(false)
```

Change the catch block's re-check (was `if (serverFindings.some(f => f.severity === 'Warning') && ...)`):

```ts
      const serverFindings = getRosterFindings(err)
      if (serverFindings) {
        setFindings(serverFindings)
        if (serverFindings.some(f => f.requiresReason) && !overrideReason.trim()) setReasonRequired(true)
      } else {
```

Change the override-reason `FormField`'s `required` prop (was `required={warningFindings.length > 0}`
— the field's *visibility* condition stays `warningFindings.length > 0` unchanged, since a
coordinator may still want to leave a note on a soft warning even when not required):

```tsx
          {(warningFindings.length > 0 || !!existing?.overrideReason) && (
            <FormField
              label="Reason for override"
              required={reasonRequiredFindings.length > 0}
              error={reasonRequired ? 'A reason is required to save with open warnings.' : undefined}
              hint="Stored on the shift and shown here whenever it's reopened."
            >
```

- [ ] **Step 5: Run to confirm pass**

Run: `npx vitest run src/pages/rostering/components/ShiftSlideOver.test.tsx`
Expected: all tests (existing + new) pass.

- [ ] **Step 6: Full suite + build, commit**

Run: `npm run build && npm test -- --run`

```bash
git add src/pages/rostering/components/ShiftSlideOver.tsx src/pages/rostering/components/ShiftSlideOver.test.tsx
git commit -m "feat(leave): ShiftSlideOver reasonRequired keys off requiresReason, not any Warning"
```

---

## Task 6: `AvailabilityEditor.tsx` — drop "Add Leave", link to `/rostering/leave`

**Files:**
- Modify: `src/pages/schedule/AvailabilityEditor.tsx` (full file, currently 219 lines)
- Test: `src/pages/schedule/AvailabilityEditor.test.tsx` (new)

**Interfaces:**
- Produces: unchanged `AvailabilityEditorProps`; the component's only create action (it never
  had a way to create `Unavailable`/`Training` rows either — `handleAdd` hardcoded
  `availabilityType: 'Leave'`) is removed.

`AvailabilityEditor` never had a type dropdown — its single "+ Add Leave" button was its *entire*
create capability, always hardcoding `availabilityType: 'Leave'`. Per the migration in PR 1, every
`Leave`-type `StaffAvailability` row is copied into `LeaveRequest` and deleted, so this component
keeps only its inline edit/delete of the remaining `Unavailable`/`Training`/`Preferred`/`Available`
rows, and points staff-leave creation at the new page instead.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import AvailabilityEditor from './AvailabilityEditor'
import type { StaffAvailabilityDto } from '@/api/types'

const { mockUpdateMutate, mockDeleteMutate } = vi.hoisted(() => ({
  mockUpdateMutate: vi.fn(),
  mockDeleteMutate: vi.fn(),
}))

vi.mock('../../api/hooks', () => ({
  useUpdateStaffAvailability: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useDeleteStaffAvailability: () => ({ mutate: mockDeleteMutate, isPending: false }),
}))

function makeAvailability(overrides: Partial<StaffAvailabilityDto> = {}): StaffAvailabilityDto {
  return {
    id: 'avail-1',
    staffId: 'staff-1',
    startDateTime: '2026-09-01T00:00:00',
    endDateTime: '2026-09-05T23:59:59',
    availabilityType: 'Unavailable',
    isRecurring: false,
    recurrenceNotes: null,
    notes: null,
    ...overrides,
  }
}

function renderEditor(availability: StaffAvailabilityDto[] = []) {
  render(
    <MemoryRouter>
      <AvailabilityEditor staffId="staff-1" staffName="Alex Rivera" availability={availability} />
    </MemoryRouter>,
  )
}

describe('AvailabilityEditor — Leave creation removed', () => {
  it('renders no "Add Leave" action', () => {
    renderEditor([makeAvailability()])
    expect(screen.queryByRole('button', { name: /add leave/i })).not.toBeInTheDocument()
  })

  it('links to /rostering/leave from the header', () => {
    renderEditor([makeAvailability()])
    expect(screen.getByRole('link', { name: /manage leave requests/i })).toHaveAttribute('href', '/rostering/leave')
  })

  it('links to /rostering/leave from the empty state', () => {
    renderEditor([])
    expect(screen.getByRole('link', { name: /leave approvals/i })).toHaveAttribute('href', '/rostering/leave')
  })

  it('still renders and lets a coordinator delete an existing legacy availability record', () => {
    renderEditor([makeAvailability()])
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByTitle('Delete')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/schedule/AvailabilityEditor.test.tsx`
Expected: FAIL — an "Add Leave" button is present, and there is no link to `/rostering/leave`
anywhere (`AvailabilityEditor` doesn't import `react-router-dom`'s `Link` today).

- [ ] **Step 3: Implement**

Replace the whole file:

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import {
  useUpdateStaffAvailability, useDeleteStaffAvailability,
} from '../../api/hooks'
import { toDateInput, toStartDt, toEndDt, formatDate } from './helpers'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { StaffAvailabilityDto } from '@/api/types'

const availTypeColors: Record<string, string> = {
  Available:   'text-emerald-600 bg-emerald-50',
  Unavailable: 'text-[#ba1a1a] bg-[#ffdad6]/60',
  Leave:       'text-[#ba1a1a] bg-[#ffdad6]/60',
  Training:    'text-[#8e337b] bg-[#ffd7ef]/60',
  Preferred:   'text-[var(--color-secondary)] bg-[var(--color-secondary-container)]/40',
  Tentative:   'text-amber-700 bg-amber-50',
}

interface AvailabilityEditorProps {
  staffId: string
  staffName: string
  availability: StaffAvailabilityDto[]
}

export default function AvailabilityEditor({ staffId, staffName, availability }: AvailabilityEditorProps) {
  const updateAvail = useUpdateStaffAvailability()
  const deleteAvail = useDeleteStaffAvailability()

  const [edits, setEdits] = useState<Record<string, { startDate: string; endDate: string; notes: string }>>({})
  const [deletingAvail, setDeletingAvail] = useState<StaffAvailabilityDto | null>(null)

  function getEdit(a: StaffAvailabilityDto) {
    return edits[a.id] ?? {
      startDate: toDateInput(a.startDateTime),
      endDate: toDateInput(a.endDateTime),
      notes: a.notes ?? '',
    }
  }

  function isDirty(a: StaffAvailabilityDto) {
    const e = edits[a.id]
    if (!e) return false
    return (
      e.startDate !== toDateInput(a.startDateTime) ||
      e.endDate !== toDateInput(a.endDateTime) ||
      e.notes !== (a.notes ?? '')
    )
  }

  function patchEdit(id: string, patch: Partial<{ startDate: string; endDate: string; notes: string }>, base: StaffAvailabilityDto) {
    setEdits(prev => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { startDate: toDateInput(base.startDateTime), endDate: toDateInput(base.endDateTime), notes: base.notes ?? '' }),
        ...patch,
      },
    }))
  }

  function handleSave(a: StaffAvailabilityDto) {
    const e = getEdit(a)
    if (!e.startDate || !e.endDate || e.endDate < e.startDate) return
    updateAvail.mutate({
      id: a.id,
      data: {
        staffId,
        startDateTime: toStartDt(e.startDate),
        endDateTime: toEndDt(e.endDate),
        availabilityType: a.availabilityType,
        isRecurring: a.isRecurring ?? false,
        recurrenceNotes: a.recurrenceNotes ?? undefined,
        notes: e.notes || undefined,
      },
    }, {
      onSuccess: () => setEdits(prev => { const next = { ...prev }; delete next[a.id]; return next }),
    })
  }

  function handleDelete(a: StaffAvailabilityDto) {
    setDeletingAvail(a)
  }

  function confirmDelete() {
    if (!deletingAvail) return
    const id = deletingAvail.id
    deleteAvail.mutate(id, {
      onSuccess: () => {
        setEdits(prev => { const next = { ...prev }; delete next[id]; return next })
        setDeletingAvail(null)
      },
    })
  }

  const dateInputClass = 'px-2 py-1 rounded-lg bg-[var(--color-surface-container-low)] border-none outline-none text-xs focus:ring-2 focus:ring-[var(--color-ring)]'
  const notesInputClass = 'flex-1 px-2 py-1 rounded-lg bg-[var(--color-surface-container-low)] border-none outline-none text-xs focus:ring-2 focus:ring-[var(--color-ring)]'

  return (
    <div className="pl-8 py-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide">Availability Records</p>
        <Link to="/rostering/leave" className="text-xs text-[var(--color-primary)] hover:underline">
          Manage leave requests →
        </Link>
      </div>
      <div className="space-y-2">
        {availability.length === 0 && (
          <p className="text-xs text-[var(--color-muted-foreground)] italic py-1">
            No availability records. Leave requests are now managed on the{' '}
            <Link to="/rostering/leave" className="text-[var(--color-primary)] hover:underline">Leave approvals</Link> page.
          </p>
        )}
        {availability.map((a: StaffAvailabilityDto) => {
          const e = getEdit(a)
          const dirty = isDirty(a)
          const colorClass = availTypeColors[a.availabilityType] ?? 'text-[var(--color-muted-foreground)] bg-[var(--color-surface-container)]'
          return (
            <div key={a.id} className="flex items-center gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold min-w-[72px] text-center ${colorClass}`}>
                {a.availabilityType}
              </span>
              <input type="date" value={e.startDate}
                onChange={ev => patchEdit(a.id, { startDate: ev.target.value }, a)}
                className={dateInputClass}
              />
              <span className="text-[var(--color-muted-foreground)]">—</span>
              <input type="date" value={e.endDate}
                onChange={ev => patchEdit(a.id, { endDate: ev.target.value }, a)}
                className={dateInputClass}
              />
              <input type="text" value={e.notes} placeholder="Notes…"
                onChange={ev => patchEdit(a.id, { notes: ev.target.value }, a)}
                className={notesInputClass}
              />
              {dirty && (
                <button
                  onClick={() => handleSave(a)}
                  disabled={updateAvail.isPending}
                  className="px-3 py-0.5 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  Save
                </button>
              )}
              <button
                onClick={() => handleDelete(a)}
                disabled={deleteAvail.isPending}
                title="Delete"
                className="p-1 rounded-full hover:bg-[#ffdad6]/60 text-[var(--color-muted-foreground)] hover:text-[#ba1a1a] transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={deletingAvail !== null}
        onCancel={() => setDeletingAvail(null)}
        onConfirm={confirmDelete}
        title="Delete Availability Record"
        message={
          deletingAvail
            ? `Delete the ${deletingAvail.availabilityType} record for ${staffName} (${formatDate(toDateInput(deletingAvail.startDateTime))} – ${formatDate(toDateInput(deletingAvail.endDateTime))})? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteAvail.isPending}
      />
    </div>
  )
}
```

This removes: the `Plus` icon import, `useCreateStaffAvailability` import/usage, the `adding`
state, and both the `!adding && <button>+ Add Leave</button>` block and the `{adding && (...)}`
inline-add-form block that followed it.

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/pages/schedule/AvailabilityEditor.test.tsx`
Expected: all 4 tests pass.

- [ ] **Step 5: Full suite + build, commit**

Run: `npm run build && npm test -- --run`
Expected: 0 build errors; no regressions. `SchedulePage.tsx` (the component that mounts
`AvailabilityEditor`) has no dedicated test file today (confirmed — there is no
`SchedulePage.test.tsx` anywhere under `src/pages/`), so there is no separate parent-component
test to re-run here; the full suite run above is what would catch a regression if one existed.

```bash
git add src/pages/schedule/AvailabilityEditor.tsx src/pages/schedule/AvailabilityEditor.test.tsx
git commit -m "feat(leave): AvailabilityEditor drops Leave creation, links to /rostering/leave"
```

---

## Task 7: Shared leave/unavailability form modals

**Files:**
- Create: `src/pages/portal/components/LeaveRequestFormModal.tsx`
- Create: `src/pages/portal/components/UnavailabilityFormModal.tsx`
- Modify: `src/pages/rostering/test-fixtures-leave.ts` (add `makeLeaveRequest`, `makeRecurringRule`)
- Test: `src/pages/portal/components/LeaveRequestFormModal.test.tsx`,
  `src/pages/portal/components/UnavailabilityFormModal.test.tsx`

**Interfaces:**
- Consumes: `Modal`, `FormField`, `Dropdown`, `SearchableSelect` (all `@/components/*`);
  `useUnsavedChangesWarning` (`@/hooks/useUnsavedChangesWarning`); `LEAVE_TYPES`,
  `LEAVE_TYPE_LABELS` (the shared copy from Task 1 — neither modal defines its own),
  `CreateLeaveRequestDto`, `CreateRecurringUnavailabilityDto` (Task 1).
- Produces: `LeaveRequestFormModal({ open, onClose, onSubmit, submitting, errorMessage?,
  staffOptions? })` and `UnavailabilityFormModal` with the identical prop shape (swap
  `CreateLeaveRequestDto` for `CreateRecurringUnavailabilityDto`). Omitting `staffOptions` is the
  portal (self-service) mode; passing it renders a required staff `SearchableSelect` and adds
  `userId` to the submitted payload — this is the exact prop both `PortalLeavePage` (Task 8, no
  `staffOptions`) and `LeaveApprovalsPage` (Task 9, `staffOptions` from `useStaff()`) rely on.
  `makeLeaveRequest(overrides?): LeaveRequestDto`, `makeRecurringRule(overrides?):
  RecurringUnavailabilityDto` for every later test.

Both modals wire `useUnsavedChangesWarning` to `formState.isDirty`, exactly the way
`VehicleCreatePage.tsx` (an existing RHF+zod create form) already does:

```tsx
// VehicleCreatePage.tsx:49,101,106-107 — the established pattern this task copies
const { register, control, handleSubmit, reset, formState: { errors, isDirty } } = useForm<VehicleFormData>({ ... })
...
const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)
...
return (
  <div className="space-y-6 animate-fade-in">
    {unsavedChangesDialog}
    ...
```

`useUnsavedChangesWarning` calls react-router 7's `useBlocker`, which **throws under a plain
declarative `<MemoryRouter>`/`<Routes>`** — it requires a data router
(`createMemoryRouter`/`RouterProvider` in tests, `createBrowserRouter`/`RouterProvider` in the
real app, which `App.tsx` already uses). Every test in this task, and every later task that
renders either modal (Task 8's `PortalLeavePage.test.tsx`, Task 9's
`LeaveApprovalsPage.test.tsx`), must render through `createMemoryRouter`/`RouterProvider` — see
`VehicleCreatePage.test.tsx:3,13-20` for the exact harness shape this plan's tests copy.

- [ ] **Step 1: Extend the fixtures file**

Add to `src/pages/rostering/test-fixtures-leave.ts` (alongside the existing `makeLeaveBar`):

```ts
import type { LeaveRequestDto, RecurringUnavailabilityDto } from '@/api/types'

export function makeLeaveRequest(overrides: Partial<LeaveRequestDto> = {}): LeaveRequestDto {
  return {
    id: 'leave-1',
    userId: 'staff-1',
    userFullName: 'Alex Rivera',
    leaveType: 'Annual',
    startDate: '2026-09-14',
    endDate: '2026-09-18',
    status: 'Pending',
    reason: null,
    requestedByUserId: 'staff-1',
    requestedAt: '2026-09-07T09:00:00Z',
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  }
}

export function makeRecurringRule(overrides: Partial<RecurringUnavailabilityDto> = {}): RecurringUnavailabilityDto {
  return {
    id: 'rule-1',
    userId: 'staff-1',
    userFullName: 'Alex Rivera',
    dayOfWeek: 'Monday',
    startTime: '09:00:00',
    endTime: '12:00:00',
    effectiveFrom: '2026-09-07',
    effectiveTo: null,
    notes: null,
    status: 'Pending',
    requestedByUserId: 'staff-1',
    requestedAt: '2026-09-07T09:00:00Z',
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  }
}
```

(`import type { LeaveBarDto }` stays as the file's other import — add the new one as a second
`import type` line, or merge both into one `import type { LeaveBarDto, LeaveRequestDto,
RecurringUnavailabilityDto } from '@/api/types'`.)

- [ ] **Step 2: Write the failing tests — `LeaveRequestFormModal.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { LeaveRequestFormModal, type LeaveRequestFormModalProps } from './LeaveRequestFormModal'

function noop() {}

// useUnsavedChangesWarning (wired into the modal in Step 4) calls react-router 7's useBlocker,
// which throws under a plain declarative <MemoryRouter>/<Routes> — a data router is required.
// Mirrors VehicleCreatePage.test.tsx:3,13-20, the existing precedent for testing a page/component
// that uses this hook.
function renderModal(props: LeaveRequestFormModalProps) {
  const router = createMemoryRouter(
    [{ path: '/', element: <LeaveRequestFormModal {...props} /> }],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

describe('LeaveRequestFormModal', () => {
  it('submits leaveType/startDate/endDate/reason with no userId in self-service mode', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    renderModal({ open: true, onClose: noop, onSubmit, submitting: false })

    await user.type(screen.getByLabelText(/start date/i), '2026-09-14')
    await user.type(screen.getByLabelText(/end date/i), '2026-09-18')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      leaveType: 'Annual',
      startDate: '2026-09-14',
      endDate: '2026-09-18',
      reason: null,
    })
  })

  it('does not render a staff picker in self-service mode', () => {
    renderModal({ open: true, onClose: noop, onSubmit: vi.fn(), submitting: false })
    expect(screen.queryByRole('combobox', { name: /staff member/i })).not.toBeInTheDocument()
  })

  it('renders a required staff picker in "enter on behalf" mode and includes userId in the submitted payload', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    const staffOptions = [{ value: 'staff-1', label: 'Alex Rivera' }]
    renderModal({ open: true, onClose: noop, onSubmit, submitting: false, staffOptions })

    await user.click(screen.getByRole('combobox', { name: /staff member/i }))
    await user.click(screen.getByRole('option', { name: 'Alex Rivera' }))
    await user.type(screen.getByLabelText(/start date/i), '2026-09-14')
    await user.type(screen.getByLabelText(/end date/i), '2026-09-18')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      leaveType: 'Annual',
      startDate: '2026-09-14',
      endDate: '2026-09-18',
      reason: null,
      userId: 'staff-1',
    })
  })

  it('disables the submit button while submitting', () => {
    renderModal({ open: true, onClose: noop, onSubmit: vi.fn(), submitting: true })
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })

  it('does not render at all when closed', () => {
    renderModal({ open: false, onClose: noop, onSubmit: vi.fn(), submitting: false })
    expect(screen.queryByText('Request leave')).not.toBeInTheDocument()
  })

  it('surfaces an errorMessage prop', () => {
    renderModal({ open: true, onClose: noop, onSubmit: vi.fn(), submitting: false, errorMessage: 'An identical request already exists.' })
    expect(screen.getByRole('alert')).toHaveTextContent('An identical request already exists.')
  })
})
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run src/pages/portal/components/LeaveRequestFormModal.test.tsx`
Expected: module not found.

- [ ] **Step 4: Implement `LeaveRequestFormModal.tsx`**

```tsx
import { useEffect, useMemo } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Modal } from '@/components/Modal'
import { FormField } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { LEAVE_TYPES, LEAVE_TYPE_LABELS } from '@/api/types'
import type { CreateLeaveRequestDto, LeaveType } from '@/api/types'

type LeaveFormValues = {
  userId: string
  leaveType: LeaveType
  startDate: string
  endDate: string
  reason: string
}

const DEFAULT_VALUES: LeaveFormValues = { userId: '', leaveType: 'Annual', startDate: '', endDate: '', reason: '' }

function buildSchema(requireStaff: boolean) {
  return z
    .object({
      userId: requireStaff ? z.string().min(1, 'Select a staff member') : z.string().optional(),
      leaveType: z.enum(LEAVE_TYPES),
      startDate: z.string().min(1, 'Start date is required'),
      endDate: z.string().min(1, 'End date is required'),
      reason: z.string().optional(),
    })
    .refine(data => data.endDate >= data.startDate, {
      message: 'End date must be on or after the start date.',
      path: ['endDate'],
    })
}

export type LeaveRequestFormModalProps = {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateLeaveRequestDto) => Promise<void>
  submitting: boolean
  errorMessage?: string | null
  /** Coordinator "enter on behalf" mode — renders a required staff picker and adds userId to the
   * submitted payload. Omit for the portal's self-service form. */
  staffOptions?: { value: string; label: string }[]
}

/**
 * Date-range leave request form (§2 CreateLeaveRequestDto). Reused unchanged by both
 * PortalLeavePage (self-service, no staffOptions) and LeaveApprovalsPage's "Enter on behalf"
 * (staffOptions supplied). The zod@4/@hookform/resolvers@3 mismatch means rendered validation
 * text can't be reliably asserted in tests — the schema still runs so a user gets inline errors;
 * tests assert submit payloads/disabled states instead.
 */
export function LeaveRequestFormModal({ open, onClose, onSubmit, submitting, errorMessage, staffOptions }: LeaveRequestFormModalProps) {
  const requireStaff = !!staffOptions
  const schema = useMemo(() => buildSchema(requireStaff), [requireStaff])
  const { register, control, handleSubmit, reset, formState: { errors, isDirty } } = useForm<LeaveFormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_VALUES,
  })
  // Wired the same way VehicleCreatePage.tsx (an existing RHF+zod create form) does — see this
  // task's Interfaces section for the quoted precedent (VehicleCreatePage.tsx:49,101,106-107).
  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  useEffect(() => {
    if (open) reset(DEFAULT_VALUES)
  }, [open, reset])

  const submit = handleSubmit(async values => {
    await onSubmit({
      leaveType: values.leaveType,
      startDate: values.startDate,
      endDate: values.endDate,
      reason: values.reason.trim() || null,
      ...(requireStaff ? { userId: values.userId } : {}),
    })
  })

  return (
    <>
      {unsavedChangesDialog}
      <Modal
      open={open}
      onClose={onClose}
      title={requireStaff ? 'Enter leave on behalf of staff' : 'Request leave'}
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-medium hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : requireStaff ? 'Save' : 'Submit request'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {requireStaff && staffOptions && (
          <Controller
            control={control}
            name="userId"
            render={({ field }) => (
              <FormField label="Staff member" required error={errors.userId?.message}>
                <SearchableSelect value={field.value} onChange={field.onChange} onBlur={field.onBlur} items={staffOptions} placeholder="Search staff…" />
              </FormField>
            )}
          />
        )}

        <Controller
          control={control}
          name="leaveType"
          render={({ field }) => (
            <FormField label="Leave type" required>
              <Dropdown variant="form" value={field.value} onChange={field.onChange} onBlur={field.onBlur} items={LEAVE_TYPES.map(t => ({ value: t, label: LEAVE_TYPE_LABELS[t] }))} />
            </FormField>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Start date" required error={errors.startDate?.message}>
            <input type="date" {...register('startDate')} />
          </FormField>
          <FormField label="End date" required error={errors.endDate?.message}>
            <input type="date" {...register('endDate')} />
          </FormField>
        </div>

        <FormField label="Reason" hint="Optional — shown to the coordinator reviewing this request.">
          <textarea rows={2} {...register('reason')} />
        </FormField>

        {errorMessage && (
          <p role="alert" className="text-sm text-[var(--color-destructive)]">{errorMessage}</p>
        )}
      </form>
      </Modal>
    </>
  )
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `npx vitest run src/pages/portal/components/LeaveRequestFormModal.test.tsx`
Expected: all 6 tests pass.

- [ ] **Step 6: Write the failing tests — `UnavailabilityFormModal.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { UnavailabilityFormModal, type UnavailabilityFormModalProps } from './UnavailabilityFormModal'

function noop() {}

// Same reason as LeaveRequestFormModal.test.tsx's renderModal helper: useUnsavedChangesWarning
// (wired in Step 8) needs a data router.
function renderModal(props: UnavailabilityFormModalProps) {
  const router = createMemoryRouter(
    [{ path: '/', element: <UnavailabilityFormModal {...props} /> }],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

describe('UnavailabilityFormModal', () => {
  it('submits dayOfWeek/startTime/endTime/effectiveFrom with no userId in self-service mode', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    renderModal({ open: true, onClose: noop, onSubmit, submitting: false })

    await user.type(screen.getByLabelText(/start time/i), '09:00')
    await user.type(screen.getByLabelText(/end time/i), '12:00')
    await user.type(screen.getByLabelText(/effective from/i), '2026-09-07')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      dayOfWeek: 'Monday',
      startTime: '09:00',
      endTime: '12:00',
      effectiveFrom: '2026-09-07',
      effectiveTo: null,
      notes: null,
    })
  })

  it('renders a required staff picker in "enter on behalf" mode and includes userId in the submitted payload', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    const staffOptions = [{ value: 'staff-1', label: 'Alex Rivera' }]
    renderModal({ open: true, onClose: noop, onSubmit, submitting: false, staffOptions })

    await user.click(screen.getByRole('combobox', { name: /staff member/i }))
    await user.click(screen.getByRole('option', { name: 'Alex Rivera' }))
    await user.type(screen.getByLabelText(/start time/i), '09:00')
    await user.type(screen.getByLabelText(/end time/i), '12:00')
    await user.type(screen.getByLabelText(/effective from/i), '2026-09-07')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      dayOfWeek: 'Monday',
      startTime: '09:00',
      endTime: '12:00',
      effectiveFrom: '2026-09-07',
      effectiveTo: null,
      notes: null,
      userId: 'staff-1',
    })
  })

  it('sends an explicit effectiveTo when provided', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    renderModal({ open: true, onClose: noop, onSubmit, submitting: false })

    await user.type(screen.getByLabelText(/start time/i), '09:00')
    await user.type(screen.getByLabelText(/end time/i), '12:00')
    await user.type(screen.getByLabelText(/effective from/i), '2026-09-07')
    await user.type(screen.getByLabelText(/effective to/i), '2026-12-31')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ effectiveTo: '2026-12-31' }))
  })

  it('disables the submit button while submitting', () => {
    renderModal({ open: true, onClose: noop, onSubmit: vi.fn(), submitting: true })
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })
})
```

- [ ] **Step 7: Run to confirm failure**

Run: `npx vitest run src/pages/portal/components/UnavailabilityFormModal.test.tsx`
Expected: module not found.

- [ ] **Step 8: Implement `UnavailabilityFormModal.tsx`**

```tsx
import { useEffect, useMemo } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Modal } from '@/components/Modal'
import { FormField } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import type { CreateRecurringUnavailabilityDto } from '@/api/types'

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

type UnavailabilityFormValues = {
  userId: string
  dayOfWeek: string
  startTime: string
  endTime: string
  effectiveFrom: string
  effectiveTo: string
  notes: string
}

const DEFAULT_VALUES: UnavailabilityFormValues = {
  userId: '', dayOfWeek: 'Monday', startTime: '', endTime: '', effectiveFrom: '', effectiveTo: '', notes: '',
}

function buildSchema(requireStaff: boolean) {
  return z
    .object({
      userId: requireStaff ? z.string().min(1, 'Select a staff member') : z.string().optional(),
      dayOfWeek: z.enum(DAYS_OF_WEEK),
      startTime: z.string().min(1, 'Start time is required'),
      endTime: z.string().min(1, 'End time is required'),
      effectiveFrom: z.string().min(1, 'Effective-from date is required'),
      effectiveTo: z.string().optional(),
      notes: z.string().optional(),
    })
    .refine(data => data.startTime < data.endTime, { message: 'Start time must be before end time.', path: ['endTime'] })
    .refine(data => !data.effectiveTo || data.effectiveTo >= data.effectiveFrom, { message: 'Effective-to must be on or after effective-from.', path: ['effectiveTo'] })
}

export type UnavailabilityFormModalProps = {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateRecurringUnavailabilityDto) => Promise<void>
  submitting: boolean
  errorMessage?: string | null
  staffOptions?: { value: string; label: string }[]
}

/** Weekly recurring unavailability form (§2 CreateRecurringUnavailabilityDto). See
 * LeaveRequestFormModal's doc comment for the reuse/validation-testing notes — identical here. */
export function UnavailabilityFormModal({ open, onClose, onSubmit, submitting, errorMessage, staffOptions }: UnavailabilityFormModalProps) {
  const requireStaff = !!staffOptions
  const schema = useMemo(() => buildSchema(requireStaff), [requireStaff])
  const { register, control, handleSubmit, reset, formState: { errors, isDirty } } = useForm<UnavailabilityFormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_VALUES,
  })
  // Same wiring as LeaveRequestFormModal — see that component's doc comment for the quoted
  // VehicleCreatePage.tsx precedent.
  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  useEffect(() => {
    if (open) reset(DEFAULT_VALUES)
  }, [open, reset])

  const submit = handleSubmit(async values => {
    await onSubmit({
      dayOfWeek: values.dayOfWeek,
      startTime: values.startTime,
      endTime: values.endTime,
      effectiveFrom: values.effectiveFrom,
      effectiveTo: values.effectiveTo || null,
      notes: values.notes.trim() || null,
      ...(requireStaff ? { userId: values.userId } : {}),
    })
  })

  return (
    <>
      {unsavedChangesDialog}
      <Modal
      open={open}
      onClose={onClose}
      title={requireStaff ? 'Enter regular unavailability on behalf of staff' : 'Add regular unavailability'}
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-medium hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : requireStaff ? 'Save' : 'Submit request'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {requireStaff && staffOptions && (
          <Controller
            control={control}
            name="userId"
            render={({ field }) => (
              <FormField label="Staff member" required error={errors.userId?.message}>
                <SearchableSelect value={field.value} onChange={field.onChange} onBlur={field.onBlur} items={staffOptions} placeholder="Search staff…" />
              </FormField>
            )}
          />
        )}

        <Controller
          control={control}
          name="dayOfWeek"
          render={({ field }) => (
            <FormField label="Day of week" required>
              <Dropdown variant="form" value={field.value} onChange={field.onChange} onBlur={field.onBlur} items={DAYS_OF_WEEK.map(d => ({ value: d, label: d }))} />
            </FormField>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Start time" required error={errors.startTime?.message}>
            <input type="time" {...register('startTime')} />
          </FormField>
          <FormField label="End time" required error={errors.endTime?.message}>
            <input type="time" {...register('endTime')} />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Effective from" required error={errors.effectiveFrom?.message}>
            <input type="date" {...register('effectiveFrom')} />
          </FormField>
          <FormField label="Effective to" hint="Leave blank for ongoing." error={errors.effectiveTo?.message}>
            <input type="date" {...register('effectiveTo')} />
          </FormField>
        </div>

        <FormField label="Notes" hint="Optional — shown to the coordinator reviewing this request.">
          <textarea rows={2} {...register('notes')} />
        </FormField>

        {errorMessage && (
          <p role="alert" className="text-sm text-[var(--color-destructive)]">{errorMessage}</p>
        )}
      </form>
      </Modal>
    </>
  )
}
```

- [ ] **Step 9: Run to confirm pass**

Run: `npx vitest run src/pages/portal/components/UnavailabilityFormModal.test.tsx`
Expected: all 4 tests pass.

- [ ] **Step 10: Full suite + build, commit**

Run: `npm run build && npm test -- --run`

```bash
git add src/pages/rostering/test-fixtures-leave.ts src/pages/portal/components/LeaveRequestFormModal.tsx src/pages/portal/components/LeaveRequestFormModal.test.tsx src/pages/portal/components/UnavailabilityFormModal.tsx src/pages/portal/components/UnavailabilityFormModal.test.tsx
git commit -m "feat(leave): shared leave + unavailability request form modals (self-service and on-behalf)"
```

---

## Task 8: `PortalLeavePage.tsx` + portal home link + route

**Files:**
- Create: `src/pages/portal/PortalLeavePage.tsx`
- Modify: `src/pages/portal/PortalShiftsPage.tsx:3` (icon import), `:70-112` (header links)
- Modify: `src/App.tsx:52-54` (lazy import), `:138-140` (route)
- Test: `src/pages/portal/PortalLeavePage.test.tsx`,
  extend `src/pages/portal/PortalShiftsPage.test.tsx`

**Interfaces:**
- Consumes: `useMyLeave`, `useCreateLeaveRequest`, `useCancelMyLeave`,
  `useCreateMyUnavailability`, `useCancelMyUnavailability` (Task 2, imported from `@/api/hooks`);
  `LeaveRequestFormModal`, `UnavailabilityFormModal` (Task 7 — both call
  `useUnsavedChangesWarning` internally, which requires a data router; this page's tests use
  `createMemoryRouter`/`RouterProvider` for that reason, not `<MemoryRouter>`); `canRequestLeave`
  (Task 3); `TabNav`, `DataTable`, `EmptyState`, `StatusBadge`, `ConfirmDialog`, `PageHeader`
  (`@/components/*`); `LEAVE_TYPE_LABELS`, `LEAVE_STATUS_COLORS` (Task 1 — the shared copies;
  this page does **not** define its own `LEAVE_TYPE_LABELS`); `formatEffectiveRange`
  (`@/pages/rostering/lib/roster`, unchanged).
- Produces: default export `PortalLeavePage`, mounted at `/portal/leave`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import PortalLeavePage from './PortalLeavePage'
import { makeLeaveRequest, makeRecurringRule } from '@/pages/rostering/test-fixtures-leave'

const {
  mockUseMyLeave, mockCreateLeaveMutateAsync, mockCancelLeaveMutateAsync,
  mockCreateUnavailabilityMutateAsync, mockCancelUnavailabilityMutateAsync,
} = vi.hoisted(() => ({
  mockUseMyLeave: vi.fn(),
  mockCreateLeaveMutateAsync: vi.fn(),
  mockCancelLeaveMutateAsync: vi.fn(),
  mockCreateUnavailabilityMutateAsync: vi.fn(),
  mockCancelUnavailabilityMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useMyLeave: mockUseMyLeave,
  useCreateLeaveRequest: () => ({ mutateAsync: mockCreateLeaveMutateAsync, isPending: false }),
  useCancelMyLeave: () => ({ mutateAsync: mockCancelLeaveMutateAsync, isPending: false }),
  useCreateMyUnavailability: () => ({ mutateAsync: mockCreateUnavailabilityMutateAsync, isPending: false }),
  useCancelMyUnavailability: () => ({ mutateAsync: mockCancelUnavailabilityMutateAsync, isPending: false }),
}))

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

// PortalLeavePage renders LeaveRequestFormModal/UnavailabilityFormModal, which call
// useUnsavedChangesWarning — a data router is required (see Task 7's Interfaces section; mirrors
// VehicleCreatePage.test.tsx:3,13-20).
function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/portal/leave', element: <PortalLeavePage /> }],
    { initialEntries: ['/portal/leave'] },
  )
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  localStorage.clear()
  setUserRole('SupportWorker')
  mockUseMyLeave.mockReturnValue({ data: { leave: [], unavailability: [] }, isLoading: false, isError: false, refetch: vi.fn() })
  mockCreateLeaveMutateAsync.mockReset()
  mockCancelLeaveMutateAsync.mockReset()
  mockCreateUnavailabilityMutateAsync.mockReset()
  mockCancelUnavailabilityMutateAsync.mockReset()
})

describe('PortalLeavePage', () => {
  it('renders an empty state on the Leave tab with no requests', () => {
    renderPage()
    expect(screen.getByText(/no leave requests yet/i)).toBeInTheDocument()
  })

  it('lists the caller\'s own leave requests with status', () => {
    mockUseMyLeave.mockReturnValue({
      data: { leave: [makeLeaveRequest({ id: 'leave-1', leaveType: 'Sick', status: 'Approved' })], unavailability: [] },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('Sick')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })

  it('shows the decision note on a declined leave row', () => {
    mockUseMyLeave.mockReturnValue({
      data: { leave: [makeLeaveRequest({ status: 'Declined', decisionNote: 'Insufficient notice' })], unavailability: [] },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('Insufficient notice')).toBeInTheDocument()
  })

  it('switches to the Regular unavailability tab and lists rules', async () => {
    const user = userEvent.setup()
    mockUseMyLeave.mockReturnValue({
      data: { leave: [], unavailability: [makeRecurringRule({ dayOfWeek: 'Tuesday', status: 'Pending' })] },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Regular unavailability' }))
    expect(screen.getByText('Tuesday')).toBeInTheDocument()
  })

  it('opens the leave request form and submits a new request', async () => {
    const user = userEvent.setup()
    mockCreateLeaveMutateAsync.mockResolvedValue(makeLeaveRequest())
    renderPage()

    await user.click(screen.getByRole('button', { name: /request leave/i }))
    await user.type(screen.getByLabelText(/start date/i), '2026-09-14')
    await user.type(screen.getByLabelText(/end date/i), '2026-09-18')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    expect(mockCreateLeaveMutateAsync).toHaveBeenCalledWith({
      leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18', reason: null,
    })
  })

  it('shows a Withdraw action only on Pending rows, and confirms before cancelling', async () => {
    const user = userEvent.setup()
    mockCancelLeaveMutateAsync.mockResolvedValue(makeLeaveRequest({ status: 'Cancelled' }))
    mockUseMyLeave.mockReturnValue({
      data: { leave: [
        makeLeaveRequest({ id: 'leave-pending', status: 'Pending' }),
        makeLeaveRequest({ id: 'leave-approved', status: 'Approved' }),
      ], unavailability: [] },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()

    const withdrawButtons = screen.getAllByRole('button', { name: /withdraw/i })
    expect(withdrawButtons).toHaveLength(1)

    await user.click(withdrawButtons[0])
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^withdraw$/i }))

    expect(mockCancelLeaveMutateAsync).toHaveBeenCalledWith('leave-pending')
  })

  it('surfaces the server error message when submitting fails', async () => {
    const user = userEvent.setup()
    mockCreateLeaveMutateAsync.mockRejectedValue({
      response: { data: { errors: ['An identical request already exists.'] } },
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /request leave/i }))
    await user.type(screen.getByLabelText(/start date/i), '2026-09-14')
    await user.type(screen.getByLabelText(/end date/i), '2026-09-18')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    expect(await screen.findByText('An identical request already exists.')).toBeInTheDocument()
  })

  it('hides the Request leave button and Withdraw actions for a ReadOnly viewer', () => {
    setUserRole('ReadOnly')
    mockUseMyLeave.mockReturnValue({
      data: { leave: [makeLeaveRequest({ status: 'Pending' })], unavailability: [] },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    expect(screen.queryByRole('button', { name: /request leave/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/portal/PortalLeavePage.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react'
import type { AxiosError } from 'axios'
import { CalendarOff, Plus } from 'lucide-react'
import { useMyLeave, useCreateLeaveRequest, useCancelMyLeave, useCreateMyUnavailability, useCancelMyUnavailability } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { TabNav } from '@/components/TabNav'
import { LeaveRequestFormModal } from './components/LeaveRequestFormModal'
import { UnavailabilityFormModal } from './components/UnavailabilityFormModal'
import { LEAVE_TYPE_LABELS, LEAVE_STATUS_COLORS } from '@/api/types'
import type { LeaveRequestDto, RecurringUnavailabilityDto, CreateLeaveRequestDto, CreateRecurringUnavailabilityDto } from '@/api/types'
import { formatEffectiveRange } from '@/pages/rostering/lib/roster'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

type WithdrawTarget = { kind: 'leave' | 'unavailability'; id: string }

export default function PortalLeavePage() {
  const { canRequestLeave } = usePermissions()
  const [tab, setTab] = useState<'leave' | 'unavailability'>('leave')
  const { data, isLoading, isError, refetch } = useMyLeave()
  const createLeave = useCreateLeaveRequest()
  const cancelLeave = useCancelMyLeave()
  const createUnavailability = useCreateMyUnavailability()
  const cancelUnavailability = useCancelMyUnavailability()

  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [withdrawTarget, setWithdrawTarget] = useState<WithdrawTarget | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const leave = data?.leave ?? []
  const unavailability = data?.unavailability ?? []

  function openForm() {
    setFormError(null)
    setFormOpen(true)
  }

  async function handleCreateLeave(payload: CreateLeaveRequestDto) {
    setFormError(null)
    try {
      await createLeave.mutateAsync(payload)
      setFormOpen(false)
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Could not submit this leave request. Please try again.'))
    }
  }

  async function handleCreateUnavailability(payload: CreateRecurringUnavailabilityDto) {
    setFormError(null)
    try {
      await createUnavailability.mutateAsync(payload)
      setFormOpen(false)
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Could not submit this unavailability request. Please try again.'))
    }
  }

  async function handleWithdraw() {
    if (!withdrawTarget) return
    setActionError(null)
    try {
      if (withdrawTarget.kind === 'leave') await cancelLeave.mutateAsync(withdrawTarget.id)
      else await cancelUnavailability.mutateAsync(withdrawTarget.id)
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Could not withdraw this request. Please try again.'))
    } finally {
      setWithdrawTarget(null)
    }
  }

  const leaveColumns: Column<LeaveRequestDto>[] = [
    { key: 'leaveType', header: 'Type', render: r => LEAVE_TYPE_LABELS[r.leaveType] ?? r.leaveType },
    { key: 'startDate', header: 'Start', type: 'date' },
    { key: 'endDate', header: 'End', type: 'date' },
    { key: 'status', header: 'Status', render: r => (
      <div>
        <StatusBadge status={r.status} colorMap={LEAVE_STATUS_COLORS} />
        {r.status === 'Declined' && r.decisionNote && (
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{r.decisionNote}</p>
        )}
      </div>
    ) },
    ...(canRequestLeave ? [{
      key: 'actions', header: '', align: 'right' as const, render: (r: LeaveRequestDto) => r.status === 'Pending' && (
        <button
          type="button"
          onClick={() => setWithdrawTarget({ kind: 'leave', id: r.id })}
          className="min-h-[44px] px-3 text-sm text-[var(--color-destructive)] hover:underline"
        >
          Withdraw
        </button>
      ),
    }] : []),
  ]

  const unavailabilityColumns: Column<RecurringUnavailabilityDto>[] = [
    { key: 'dayOfWeek', header: 'Day' },
    { key: 'window', header: 'Time', render: r => `${r.startTime.slice(0, 5)}–${r.endTime.slice(0, 5)}` },
    { key: 'effectiveRange', header: 'Effective range', render: r => formatEffectiveRange(r.effectiveFrom, r.effectiveTo) },
    { key: 'status', header: 'Status', render: r => (
      <div>
        <StatusBadge status={r.status} colorMap={LEAVE_STATUS_COLORS} />
        {r.status === 'Declined' && r.decisionNote && (
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{r.decisionNote}</p>
        )}
      </div>
    ) },
    ...(canRequestLeave ? [{
      key: 'actions', header: '', align: 'right' as const, render: (r: RecurringUnavailabilityDto) => r.status === 'Pending' && (
        <button
          type="button"
          onClick={() => setWithdrawTarget({ kind: 'unavailability', id: r.id })}
          className="min-h-[44px] px-3 text-sm text-[var(--color-destructive)] hover:underline"
        >
          Withdraw
        </button>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="My leave" subtitle="Request leave or a regular weekly unavailability, and track what's been decided.">
        {canRequestLeave && (
          <button
            type="button"
            onClick={openForm}
            className="flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] shadow-md hover:opacity-90"
          >
            <Plus className="w-4 h-4" /> {tab === 'leave' ? 'Request leave' : 'Add unavailability'}
          </button>
        )}
      </PageHeader>

      {actionError && (
        <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          {actionError}
        </div>
      )}

      <TabNav
        tabs={[{ key: 'leave', label: 'Leave' }, { key: 'unavailability', label: 'Regular unavailability' }]}
        active={tab}
        onChange={key => setTab(key as 'leave' | 'unavailability')}
      />

      {isLoading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : isError ? (
        <EmptyState
          icon={CalendarOff}
          title="Couldn't load your leave"
          description="Check your connection and try again."
          action={{ label: 'Try again', onClick: () => refetch() }}
        />
      ) : tab === 'leave' ? (
        leave.length === 0 ? (
          <EmptyState
            icon={CalendarOff}
            title="No leave requests yet"
            description="Request Annual, Sick, Personal or Other leave and track its status here."
            action={canRequestLeave ? { label: 'Request leave', onClick: openForm } : undefined}
          />
        ) : (
          <DataTable data={leave} columns={leaveColumns} keyField="id" emptyMessage="No leave requests" />
        )
      ) : unavailability.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="No regular unavailability set"
          description="Add a standing weekly window you're not available, e.g. every Monday morning."
          action={canRequestLeave ? { label: 'Add unavailability', onClick: openForm } : undefined}
        />
      ) : (
        <DataTable data={unavailability} columns={unavailabilityColumns} keyField="id" emptyMessage="No regular unavailability" />
      )}

      {tab === 'leave' ? (
        <LeaveRequestFormModal open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleCreateLeave} submitting={createLeave.isPending} errorMessage={formError} />
      ) : (
        <UnavailabilityFormModal open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleCreateUnavailability} submitting={createUnavailability.isPending} errorMessage={formError} />
      )}

      <ConfirmDialog
        open={withdrawTarget !== null}
        onConfirm={handleWithdraw}
        onCancel={() => setWithdrawTarget(null)}
        title="Withdraw request"
        message="This withdraws your pending request. You can submit a new one at any time."
        confirmLabel="Withdraw"
        variant="danger"
        loading={cancelLeave.isPending || cancelUnavailability.isPending}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/pages/portal/PortalLeavePage.test.tsx`
Expected: all 9 tests pass.

- [ ] **Step 5: Add the portal home link**

In `src/pages/portal/PortalShiftsPage.tsx`, add `CalendarOff` to the existing lucide-react import
(line 3, currently `import { ChevronLeft, ChevronRight, CalendarCheck2, Car, Moon, AlertTriangle,
ShieldCheck } from 'lucide-react'`):

```tsx
import { ChevronLeft, ChevronRight, CalendarCheck2, Car, Moon, AlertTriangle, ShieldCheck, CalendarOff } from 'lucide-react'
```

In the `PageHeader`'s children (before the existing "Witness approvals" `Link`, around line 72):

```tsx
          <Link
            to="/portal/leave"
            className="inline-flex items-center gap-1.5 h-11 px-3 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] text-sm transition-colors"
          >
            <CalendarOff className="w-4 h-4" />
            My leave
          </Link>
```

- [ ] **Step 6: Add one assertion to `PortalShiftsPage.test.tsx`**

Add to the existing `describe('PortalShiftsPage', ...)` block:

```tsx
  it('links to the leave portal page', () => {
    mockUseMyShifts.mockReturnValue({ data: makeShiftsResponse(), isLoading: false })
    renderPage()
    expect(screen.getByRole('link', { name: /my leave/i })).toHaveAttribute('href', '/portal/leave')
  })
```

- [ ] **Step 7: Register the route**

In `src/App.tsx`, add the lazy import after line 54 (`const PortalWitnessApprovalsPage = ...`):

```tsx
const PortalLeavePage = React.lazy(() => import('@/pages/portal/PortalLeavePage'))
```

And the route after line 140 (`/portal/witness-approvals`):

```tsx
        <Route path="/portal/leave" element={<PrivateRoute page="portal-leave"><PortalLeavePage /></PrivateRoute>} />
```

- [ ] **Step 8: Run the full suite + build**

Run: `npm run build && npm test -- --run`
Expected: 0 build errors; no regressions.

- [ ] **Step 9: Commit**

```bash
git add src/pages/portal/PortalLeavePage.tsx src/pages/portal/PortalLeavePage.test.tsx src/pages/portal/PortalShiftsPage.tsx src/pages/portal/PortalShiftsPage.test.tsx src/App.tsx
git commit -m "feat(leave): PortalLeavePage at /portal/leave, home link, route"
```

---

## Task 9: `LeaveApprovalsPage.tsx` + sidebar badge + route

**Files:**
- Create: `src/pages/rostering/LeaveApprovalsPage.tsx`
- Modify: `src/components/layout/AppLayout.tsx:2-6` (icon import), `:11` (hook import),
  `:32-41` (Rostering nav children), `:88-89` (pending-count variable), `:200-216` (child
  NavLink rendering, badge)
- Modify: `src/App.tsx:47-49` (lazy import), `:132-134` (route)
- Test: `src/pages/rostering/LeaveApprovalsPage.test.tsx`

**Interfaces:**
- Consumes: `useLeaveRequests`, `useRecurringUnavailabilities`, `useApproveLeave`,
  `useDeclineLeave`, `useCancelLeave`, `useApproveUnavailability`, `useDeclineUnavailability`,
  `useCancelUnavailability`, `useCreateLeaveOnBehalf`, `useCreateUnavailabilityOnBehalf`,
  `usePendingLeaveCount` (Task 2), `useStaff` (existing); `LeaveRequestFormModal`,
  `UnavailabilityFormModal` (Task 7 — both call `useUnsavedChangesWarning` internally, so this
  page's "Enter on behalf" tests need a data router, same as Task 8 — see that task's Interfaces
  note); `FindingsList` (existing, `@/pages/rostering/components`); `LEAVE_STATUS_COLORS` (Task 1
  — the shared `StatusBadge` colour override; this page does not define its own).
- Produces: default export `LeaveApprovalsPage`, mounted at `/rostering/leave`.

Per the spec, the approve endpoint both approves and returns overlaps — approval is never
blocked by them. **Ruling:** this is built as a two-step confirm: (1) a plain "Approve?"
`ConfirmDialog`; (2) once the mutation resolves, a second `ConfirmDialog` reporting
`overlaps.length` findings (via the existing `FindingsList`) or a plain "no overlap" message,
closed with "Done". The request is already approved by the time the second dialog shows — it is
a notice, not a second gate.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import LeaveApprovalsPage from './LeaveApprovalsPage'
import { makeLeaveRequest, makeRecurringRule } from './test-fixtures-leave'
import type { StaffListDto } from '@/api/types'

// LeaveApprovalsPage renders LeaveRequestFormModal/UnavailabilityFormModal ("Enter on behalf"),
// which call useUnsavedChangesWarning — a data router is required (see Task 7's Interfaces
// section; mirrors VehicleCreatePage.test.tsx:3,13-20).
function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/rostering/leave', element: <LeaveApprovalsPage /> }],
    { initialEntries: ['/rostering/leave'] },
  )
  return render(<RouterProvider router={router} />)
}

const {
  mockUseLeaveRequests, mockUseRecurringUnavailabilities, mockUseStaff,
  mockApproveLeaveMutateAsync, mockDeclineLeaveMutateAsync, mockCancelLeaveMutateAsync,
  mockApproveUnavailabilityMutateAsync, mockDeclineUnavailabilityMutateAsync, mockCancelUnavailabilityMutateAsync,
  mockCreateLeaveOnBehalfMutateAsync, mockCreateUnavailabilityOnBehalfMutateAsync,
} = vi.hoisted(() => ({
  mockUseLeaveRequests: vi.fn(),
  mockUseRecurringUnavailabilities: vi.fn(),
  mockUseStaff: vi.fn(() => ({ data: [{ id: 'staff-1', fullName: 'Alex Rivera' }] as StaffListDto[] })),
  mockApproveLeaveMutateAsync: vi.fn(),
  mockDeclineLeaveMutateAsync: vi.fn(),
  mockCancelLeaveMutateAsync: vi.fn(),
  mockApproveUnavailabilityMutateAsync: vi.fn(),
  mockDeclineUnavailabilityMutateAsync: vi.fn(),
  mockCancelUnavailabilityMutateAsync: vi.fn(),
  mockCreateLeaveOnBehalfMutateAsync: vi.fn(),
  mockCreateUnavailabilityOnBehalfMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useLeaveRequests: mockUseLeaveRequests,
  useRecurringUnavailabilities: mockUseRecurringUnavailabilities,
  useStaff: mockUseStaff,
  useApproveLeave: () => ({ mutateAsync: mockApproveLeaveMutateAsync, isPending: false }),
  useDeclineLeave: () => ({ mutateAsync: mockDeclineLeaveMutateAsync, isPending: false }),
  useCancelLeave: () => ({ mutateAsync: mockCancelLeaveMutateAsync, isPending: false }),
  useApproveUnavailability: () => ({ mutateAsync: mockApproveUnavailabilityMutateAsync, isPending: false }),
  useDeclineUnavailability: () => ({ mutateAsync: mockDeclineUnavailabilityMutateAsync, isPending: false }),
  useCancelUnavailability: () => ({ mutateAsync: mockCancelUnavailabilityMutateAsync, isPending: false }),
  useCreateLeaveOnBehalf: () => ({ mutateAsync: mockCreateLeaveOnBehalfMutateAsync, isPending: false }),
  useCreateUnavailabilityOnBehalf: () => ({ mutateAsync: mockCreateUnavailabilityOnBehalfMutateAsync, isPending: false }),
}))

beforeEach(() => {
  mockUseLeaveRequests.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  mockUseRecurringUnavailabilities.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  mockApproveLeaveMutateAsync.mockReset()
  mockDeclineLeaveMutateAsync.mockReset()
  mockCancelLeaveMutateAsync.mockReset()
  mockApproveUnavailabilityMutateAsync.mockReset()
  mockDeclineUnavailabilityMutateAsync.mockReset()
  mockCreateLeaveOnBehalfMutateAsync.mockReset()
  mockCreateUnavailabilityOnBehalfMutateAsync.mockReset()
})

describe('LeaveApprovalsPage', () => {
  it('defaults the status filter to Pending', () => {
    renderPage()
    expect(mockUseLeaveRequests).toHaveBeenCalledWith(expect.objectContaining({ status: 'Pending' }))
    expect(mockUseRecurringUnavailabilities).toHaveBeenCalledWith(expect.objectContaining({ status: 'Pending' }))
  })

  it('renders both leave requests and recurring unavailability rows in one table', () => {
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ userFullName: 'Alex Rivera', leaveType: 'Sick' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockUseRecurringUnavailabilities.mockReturnValue({ data: [makeRecurringRule({ userFullName: 'Jordan Smith', dayOfWeek: 'Tuesday' })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.getByText('Leave — Sick')).toBeInTheDocument()
    expect(screen.getByText('Jordan Smith')).toBeInTheDocument()
    expect(screen.getByText('Regular unavailability')).toBeInTheDocument()
  })

  it('approves a leave request and shows a follow-up notice listing the overlaps returned by the approve call', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1', userFullName: 'Alex Rivera' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockApproveLeaveMutateAsync.mockResolvedValue({
      leave: makeLeaveRequest({ id: 'leave-1', status: 'Approved' }),
      overlaps: [{ code: 'DOUBLE_BOOKED_SHIFT', severity: 'Warning', message: 'Overlaps a published shift.', requiresReason: false }],
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^approve$/i }))
    const confirmDialog = screen.getByRole('dialog')
    await user.click(within(confirmDialog).getByRole('button', { name: /^approve$/i }))

    expect(mockApproveLeaveMutateAsync).toHaveBeenCalledWith('leave-1')
    expect(await screen.findByText(/approved — this overlaps 1 rostered shift\/trip/i)).toBeInTheDocument()
    expect(screen.getByText('Overlaps a published shift.')).toBeInTheDocument()
  })

  it('approves a request with no overlaps and shows the plain success notice', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockApproveLeaveMutateAsync.mockResolvedValue({ leave: makeLeaveRequest({ id: 'leave-1', status: 'Approved' }), overlaps: [] })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^approve$/i }))
    const confirmDialog = screen.getByRole('dialog')
    await user.click(within(confirmDialog).getByRole('button', { name: /^approve$/i }))

    expect(await screen.findByText(/no rostered shifts or trips overlap this window/i)).toBeInTheDocument()
  })

  it('requires a decline reason before submitting', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1' })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^decline$/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^decline$/i }))

    expect(mockDeclineLeaveMutateAsync).not.toHaveBeenCalled()
    expect(within(dialog).getByText(/a decline reason is required/i)).toBeInTheDocument()
  })

  it('declines with a note', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockDeclineLeaveMutateAsync.mockResolvedValue(makeLeaveRequest({ id: 'leave-1', status: 'Declined' }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /^decline$/i }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'Short-staffed that week')
    await user.click(within(dialog).getByRole('button', { name: /^decline$/i }))

    expect(mockDeclineLeaveMutateAsync).toHaveBeenCalledWith({ id: 'leave-1', data: { decisionNote: 'Short-staffed that week' } })
  })

  it('cancels an already-approved request', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1', status: 'Approved' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockCancelLeaveMutateAsync.mockResolvedValue(makeLeaveRequest({ id: 'leave-1', status: 'Cancelled' }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^cancel request$/i }))

    expect(mockCancelLeaveMutateAsync).toHaveBeenCalledWith('leave-1')
  })

  it('"Enter on behalf" — Leave requires a staff selection and lands the request Approved via the on-behalf endpoint', async () => {
    const user = userEvent.setup()
    mockCreateLeaveOnBehalfMutateAsync.mockResolvedValue(makeLeaveRequest({ status: 'Approved' }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /enter on behalf/i }))
    await user.click(screen.getByRole('option', { name: 'Leave' }))

    await user.click(screen.getByRole('combobox', { name: /staff member/i }))
    await user.click(screen.getByRole('option', { name: 'Alex Rivera' }))
    await user.type(screen.getByLabelText(/start date/i), '2026-09-14')
    await user.type(screen.getByLabelText(/end date/i), '2026-09-18')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockCreateLeaveOnBehalfMutateAsync).toHaveBeenCalledWith({
      leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18', reason: null, userId: 'staff-1',
    })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/rostering/LeaveApprovalsPage.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement**

```tsx
import { useMemo, useState } from 'react'
import { CalendarOff, Plus } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { FindingsList } from '@/pages/rostering/components/FindingsList'
import {
  useLeaveRequests, useRecurringUnavailabilities, useApproveLeave, useDeclineLeave, useCancelLeave,
  useApproveUnavailability, useDeclineUnavailability, useCancelUnavailability,
  useCreateLeaveOnBehalf, useCreateUnavailabilityOnBehalf, useStaff,
} from '@/api/hooks'
import { LeaveRequestFormModal } from '@/pages/portal/components/LeaveRequestFormModal'
import { UnavailabilityFormModal } from '@/pages/portal/components/UnavailabilityFormModal'
import { LEAVE_STATUS_COLORS } from '@/api/types'
import type { LeaveRequestDto, RecurringUnavailabilityDto, LeaveStatus, RosterFindingDto, CreateLeaveRequestDto, CreateRecurringUnavailabilityDto } from '@/api/types'
import { formatEffectiveRange } from './lib/roster'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { message?: string; errors?: string[] } } }
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

type ApprovalRow =
  | { rowKind: 'leave'; key: string; data: LeaveRequestDto }
  | { rowKind: 'unavailability'; key: string; data: RecurringUnavailabilityDto }

const STATUS_FILTER_ITEMS = [
  { value: '', label: 'All statuses' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Declined', label: 'Declined' },
  { value: 'Cancelled', label: 'Cancelled' },
]

function rowType(row: ApprovalRow) {
  return row.rowKind === 'leave' ? `Leave — ${row.data.leaveType}` : 'Regular unavailability'
}

function rowWindow(row: ApprovalRow) {
  return row.rowKind === 'leave'
    ? formatEffectiveRange(row.data.startDate, row.data.endDate)
    : `${row.data.dayOfWeek} ${row.data.startTime.slice(0, 5)}–${row.data.endTime.slice(0, 5)}, ${formatEffectiveRange(row.data.effectiveFrom, row.data.effectiveTo)}`
}

export default function LeaveApprovalsPage() {
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | ''>('Pending')
  const [staffFilter, setStaffFilter] = useState('')
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')

  const filters = useMemo(() => ({
    status: statusFilter || undefined,
    userId: staffFilter || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  }), [statusFilter, staffFilter, fromFilter, toFilter])

  const { data: leaveRequests = [], isLoading: leaveLoading, isError: leaveError, refetch: refetchLeave } = useLeaveRequests(filters)
  const { data: unavailabilities = [], isLoading: unavailabilityLoading, isError: unavailabilityError, refetch: refetchUnavailability } = useRecurringUnavailabilities(filters)
  const { data: staff = [] } = useStaff()

  const approveLeave = useApproveLeave()
  const declineLeave = useDeclineLeave()
  const cancelLeave = useCancelLeave()
  const approveUnavailability = useApproveUnavailability()
  const declineUnavailability = useDeclineUnavailability()
  const cancelUnavailability = useCancelUnavailability()
  const createLeaveOnBehalf = useCreateLeaveOnBehalf()
  const createUnavailabilityOnBehalf = useCreateUnavailabilityOnBehalf()

  const staffOptions = useMemo(() => staff.map(s => ({ value: s.id, label: s.fullName })), [staff])
  const staffNameById = useMemo(() => new Map(staff.map(s => [s.id, s.fullName])), [staff])

  const [onBehalfMode, setOnBehalfMode] = useState<'leave' | 'unavailability' | null>(null)
  const [onBehalfError, setOnBehalfError] = useState<string | null>(null)
  const [approveTarget, setApproveTarget] = useState<ApprovalRow | null>(null)
  const [approveOverlaps, setApproveOverlaps] = useState<RosterFindingDto[] | null>(null)
  const [declineTarget, setDeclineTarget] = useState<ApprovalRow | null>(null)
  const [declineNote, setDeclineNote] = useState('')
  const [declineError, setDeclineError] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ApprovalRow | null>(null)

  const rows: ApprovalRow[] = [
    ...leaveRequests.map(r => ({ rowKind: 'leave' as const, key: `leave-${r.id}`, data: r })),
    ...unavailabilities.map(r => ({ rowKind: 'unavailability' as const, key: `unavailability-${r.id}`, data: r })),
  ].sort((a, b) => b.data.requestedAt.localeCompare(a.data.requestedAt))

  const isLoading = leaveLoading || unavailabilityLoading
  const isError = leaveError || unavailabilityError

  async function handleApproveConfirm() {
    if (!approveTarget) return
    try {
      if (approveTarget.rowKind === 'leave') {
        const result = await approveLeave.mutateAsync(approveTarget.data.id)
        setApproveOverlaps(result.overlaps)
      } else {
        const result = await approveUnavailability.mutateAsync(approveTarget.data.id)
        setApproveOverlaps(result.overlaps)
      }
    } catch {
      setApproveTarget(null)
    }
  }

  function closeApproveFlow() {
    setApproveTarget(null)
    setApproveOverlaps(null)
  }

  async function handleDeclineConfirm() {
    if (!declineTarget) return
    setDeclineError(null)
    if (!declineNote.trim()) {
      setDeclineError('A decline reason is required.')
      return
    }
    try {
      if (declineTarget.rowKind === 'leave') await declineLeave.mutateAsync({ id: declineTarget.data.id, data: { decisionNote: declineNote.trim() } })
      else await declineUnavailability.mutateAsync({ id: declineTarget.data.id, data: { decisionNote: declineNote.trim() } })
      setDeclineTarget(null)
      setDeclineNote('')
    } catch (err) {
      setDeclineError(extractErrorMessage(err, 'Could not decline this request. Please try again.'))
    }
  }

  async function handleCancelConfirm() {
    if (!cancelTarget) return
    if (cancelTarget.rowKind === 'leave') await cancelLeave.mutateAsync(cancelTarget.data.id)
    else await cancelUnavailability.mutateAsync(cancelTarget.data.id)
    setCancelTarget(null)
  }

  async function handleOnBehalfLeave(payload: CreateLeaveRequestDto) {
    setOnBehalfError(null)
    try {
      await createLeaveOnBehalf.mutateAsync(payload)
      setOnBehalfMode(null)
    } catch (err) {
      setOnBehalfError(extractErrorMessage(err, 'Could not save this leave record. Please try again.'))
    }
  }

  async function handleOnBehalfUnavailability(payload: CreateRecurringUnavailabilityDto) {
    setOnBehalfError(null)
    try {
      await createUnavailabilityOnBehalf.mutateAsync(payload)
      setOnBehalfMode(null)
    } catch (err) {
      setOnBehalfError(extractErrorMessage(err, 'Could not save this unavailability record. Please try again.'))
    }
  }

  function rowRequestedBy(row: ApprovalRow) {
    const { requestedByUserId, userId, requestedAt } = row.data
    const who = requestedByUserId === userId ? 'Self' : (staffNameById.get(requestedByUserId) ?? 'Coordinator')
    return `${who} · ${requestedAt.slice(0, 10)}`
  }

  const columns: Column<ApprovalRow>[] = [
    { key: 'staff', header: 'Staff', render: row => row.data.userFullName },
    { key: 'type', header: 'Type', render: rowType },
    { key: 'window', header: 'Dates', render: rowWindow },
    { key: 'requestedAt', header: 'Requested', render: rowRequestedBy },
    { key: 'status', header: 'Status', render: row => (
      <div>
        <StatusBadge status={row.data.status} colorMap={LEAVE_STATUS_COLORS} />
        {row.data.status === 'Declined' && row.data.decisionNote && (
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{row.data.decisionNote}</p>
        )}
      </div>
    ) },
    { key: 'actions', header: '', align: 'right', render: row => row.data.status === 'Pending' ? (
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setDeclineTarget(row)} className="min-h-[44px] px-3 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]">
          Decline
        </button>
        <button type="button" onClick={() => setApproveTarget(row)} className="min-h-[44px] px-3 text-sm rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90">
          Approve
        </button>
      </div>
    ) : row.data.status === 'Approved' ? (
      <button type="button" onClick={() => setCancelTarget(row)} className="min-h-[44px] px-3 text-sm text-[var(--color-destructive)] hover:underline">
        Cancel
      </button>
    ) : null },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Leave approvals" subtitle="Review and decide staff leave and regular-unavailability requests.">
        <Dropdown
          variant="menu"
          label="Enter on behalf"
          icon={<Plus className="w-4 h-4" />}
          items={[{ value: 'leave', label: 'Leave' }, { value: 'unavailability', label: 'Regular unavailability' }]}
          onSelect={value => { setOnBehalfError(null); setOnBehalfMode(value as 'leave' | 'unavailability') }}
        />
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Dropdown variant="form" value={statusFilter} onChange={v => setStatusFilter(v as LeaveStatus | '')} items={STATUS_FILTER_ITEMS} label="Status" />
        </div>
        <div className="w-56">
          <SearchableSelect
            value={staffFilter}
            onChange={setStaffFilter}
            items={[{ value: '', label: 'All staff' }, ...staffOptions]}
            placeholder="All staff"
          />
        </div>
        <input type="date" value={fromFilter} onChange={e => setFromFilter(e.target.value)} aria-label="From date" />
        <input type="date" value={toFilter} onChange={e => setToFilter(e.target.value)} aria-label="To date" />
      </div>

      {isLoading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : isError ? (
        <EmptyState
          icon={CalendarOff}
          title="Couldn't load leave requests"
          description="Check your connection and try again."
          action={{ label: 'Try again', onClick: () => { refetchLeave(); refetchUnavailability() } }}
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarOff} title="No requests match these filters" description="Try a different status, staff member or date range." />
      ) : (
        <DataTable data={rows} columns={columns} keyField="key" emptyMessage="No requests found" />
      )}

      <LeaveRequestFormModal
        open={onBehalfMode === 'leave'}
        onClose={() => setOnBehalfMode(null)}
        onSubmit={handleOnBehalfLeave}
        submitting={createLeaveOnBehalf.isPending}
        errorMessage={onBehalfError}
        staffOptions={staffOptions}
      />
      <UnavailabilityFormModal
        open={onBehalfMode === 'unavailability'}
        onClose={() => setOnBehalfMode(null)}
        onSubmit={handleOnBehalfUnavailability}
        submitting={createUnavailabilityOnBehalf.isPending}
        errorMessage={onBehalfError}
        staffOptions={staffOptions}
      />

      <ConfirmDialog
        open={approveTarget !== null && approveOverlaps === null}
        onConfirm={handleApproveConfirm}
        onCancel={() => setApproveTarget(null)}
        title="Approve request"
        message={approveTarget ? `Approve ${rowType(approveTarget).toLowerCase()} for ${approveTarget.data.userFullName}?` : ''}
        confirmLabel="Approve"
        loading={approveLeave.isPending || approveUnavailability.isPending}
      />

      <ConfirmDialog
        open={approveOverlaps !== null}
        onCancel={closeApproveFlow}
        onConfirm={closeApproveFlow}
        title="Approved"
        confirmLabel="Done"
        message={
          approveOverlaps && approveOverlaps.length > 0 ? (
            <div className="space-y-2">
              <p>{`Approved — this overlaps ${approveOverlaps.length} rostered shift/trip${approveOverlaps.length === 1 ? '' : 's'}.`}</p>
              <FindingsList findings={approveOverlaps} />
            </div>
          ) : (
            'Approved — no rostered shifts or trips overlap this window.'
          )
        }
      />

      <ConfirmDialog
        open={declineTarget !== null}
        onCancel={() => { setDeclineTarget(null); setDeclineNote(''); setDeclineError(null) }}
        onConfirm={handleDeclineConfirm}
        title="Decline request"
        variant="danger"
        confirmLabel="Decline"
        loading={declineLeave.isPending || declineUnavailability.isPending}
        message={
          <div className="space-y-2">
            <p>{declineTarget ? `Decline ${rowType(declineTarget).toLowerCase()} for ${declineTarget.data.userFullName}?` : ''}</p>
            <label className="block text-sm text-[var(--color-foreground)]">
              Reason <span className="text-[var(--color-destructive)]">*</span>
              <textarea value={declineNote} onChange={e => setDeclineNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[var(--color-border)] p-2 text-sm" />
            </label>
            {declineError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{declineError}</p>}
          </div>
        }
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onCancel={() => setCancelTarget(null)}
        onConfirm={handleCancelConfirm}
        title="Cancel approved request"
        variant="danger"
        confirmLabel="Cancel request"
        loading={cancelLeave.isPending || cancelUnavailability.isPending}
        message={cancelTarget ? `Cancel the approved ${rowType(cancelTarget).toLowerCase()} for ${cancelTarget.data.userFullName}?` : ''}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/pages/rostering/LeaveApprovalsPage.test.tsx`
Expected: all 8 tests pass.

- [ ] **Step 5: Sidebar entry + pending-count badge**

In `src/components/layout/AppLayout.tsx`, add `CalendarOff` to the existing lucide-react import
(lines 2-6):

```tsx
import {
  LayoutDashboard, Map, CalendarRange, Users, Building2, Truck, UserCog,
  ListChecks, Settings, LogOut, Menu, X, ClipboardList, AlertTriangle, Plus, ChevronDown, Receipt,
  CalendarClock, Pill, CalendarCheck2, ClipboardCheck, CalendarOff
} from 'lucide-react'
```

Change the hooks import (line 11):

```tsx
import { usePendingWitnessRequests, usePendingLeaveCount } from '@/api/hooks'
```

Add the nav entry to the Rostering group's `children` (lines 32-41):

```tsx
  {
    label: 'Rostering',
    icon: CalendarClock,
    msIcon: 'calendar_view_week',
    children: [
      { to: '/rostering', icon: CalendarClock, label: 'Board', msIcon: 'calendar_view_week', page: 'rostering' },
      { to: '/rostering/patterns', icon: CalendarClock, label: 'Patterns', msIcon: 'event_repeat', page: 'rostering' },
      { to: '/rostering/compatibility', icon: CalendarClock, label: 'Compatibility', msIcon: 'join_inner', page: 'rostering' },
      { to: '/rostering/leave', icon: CalendarOff, label: 'Leave', msIcon: 'event_busy', page: 'leave-approvals' },
    ],
  },
```

Read the pending count alongside the existing witness count (near lines 88-89):

```tsx
  const { data: pendingWitnessRequests } = usePendingWitnessRequests()
  const pendingWitnessCount = pendingWitnessRequests?.length ?? 0
  const pendingLeaveCount = usePendingLeaveCount()
```

Change the child-`NavLink` rendering inside the group block (lines 200-216) to badge
`/rostering/leave`:

```tsx
                    <div className="min-h-0 space-y-0.5">
                      {visibleChildren.map(({ to, label, msIcon }) => (
                        <NavLink key={to} to={to} end={isExactMatchOnly(to)}
                          tabIndex={isOpen ? undefined : -1}
                          className={({ isActive }) =>
                            `flex items-center gap-4 pl-12 pr-6 py-2.5 rounded-full text-sm transition-all duration-150 ${
                              isActive
                                ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)] font-bold'
                                : 'text-[var(--color-secondary)] font-medium hover:bg-[#e3e0d8]'
                            }`
                          }
                          onClick={() => setSidebarOpen(false)}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{msIcon}</span>
                          <span className="flex-1">{label}</span>
                          {to === '/rostering/leave' && pendingLeaveCount > 0 && (
                            <span
                              className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-[var(--color-destructive)] text-white text-xs font-medium"
                              aria-label={`${pendingLeaveCount} leave request${pendingLeaveCount === 1 ? '' : 's'} pending`}
                            >
                              {pendingLeaveCount > 99 ? '99+' : pendingLeaveCount}
                            </span>
                          )}
                        </NavLink>
                      ))}
                    </div>
```

(The old body was `<span className="material-symbols-outlined" ...>{msIcon}</span>{label}` — the
label is now wrapped in `<span className="flex-1">` so the badge sits flush right, matching the
top-level `/portal` leaf's existing badge treatment.)

- [ ] **Step 6: Extend `AppLayout.test.tsx`**

`AppLayout.test.tsx` already partial-mocks `@/api/hooks` (keeping every real export except
`usePendingWitnessRequests`, stubbed to an empty list) via `vi.mock('@/api/hooks', async
(importOriginal) => ({ ...actual, usePendingWitnessRequests: ... }))`. Add
`usePendingLeaveCount` to that same override object:

```tsx
vi.mock('@/api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks')>()
  return {
    ...actual,
    usePendingWitnessRequests: () => ({ data: [], isLoading: false }),
    usePendingLeaveCount: () => 0,
  }
})
```

This changes the default for every existing test in the file to "0 pending leave" — harmless,
since none of them assert on the Leave nav entry. Add a new describe block that overrides the
count per-test via `vi.mock`'s hoisted pattern — replace the static `usePendingLeaveCount: () =>
0` above with a hoisted mock function so a later test can change its return value:

```tsx
const { mockUsePendingLeaveCount } = vi.hoisted(() => ({ mockUsePendingLeaveCount: vi.fn(() => 0) }))

vi.mock('@/api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks')>()
  return {
    ...actual,
    usePendingWitnessRequests: () => ({ data: [], isLoading: false }),
    usePendingLeaveCount: mockUsePendingLeaveCount,
  }
})
```

(This replaces the file's existing `vi.mock('@/api/hooks', ...)` call at the top — the
`mockUsePendingLeaveCount` declaration must come first via `vi.hoisted` per Vitest's hoisting
rules, matching the pattern already used in `ShiftSlideOver.test.tsx`'s `vi.hoisted` block.)

```tsx
describe('AppLayout — Leave nav entry (leave-2)', () => {
  afterEach(() => {
    localStorage.clear()
    mockUsePendingLeaveCount.mockReturnValue(0)
  })

  it('renders the Leave entry under Rostering, linking to /rostering/leave', () => {
    renderAt('/rostering')
    expect(screen.getByRole('link', { name: /Leave$/ })).toHaveAttribute('href', '/rostering/leave')
  })

  it('shows no badge when there are no pending leave requests', () => {
    renderAt('/rostering')
    expect(screen.getByRole('link', { name: /Leave$/ })).not.toHaveTextContent(/\d/)
  })

  it('shows a pending-count badge on the Leave entry when usePendingLeaveCount is positive', () => {
    mockUsePendingLeaveCount.mockReturnValue(3)
    renderAt('/rostering')
    expect(screen.getByRole('link', { name: /Leave$/ })).toHaveTextContent('3')
  })
})
```

- [ ] **Step 7: Register the route**

In `src/App.tsx`, add the lazy import after line 49 (`const CompatibilityPage = ...`):

```tsx
const LeaveApprovalsPage = React.lazy(() => import('@/pages/rostering/LeaveApprovalsPage'))
```

And the route after line 134 (`/rostering/compatibility`):

```tsx
        <Route path="/rostering/leave" element={<PrivateRoute page="leave-approvals"><LeaveApprovalsPage /></PrivateRoute>} />
```

- [ ] **Step 8: Full suite + build**

Run: `npm run build && npm test -- --run`
Expected: 0 build errors; no regressions.

- [ ] **Step 9: Lint check**

Run: `npx eslint src/pages/rostering/LeaveApprovalsPage.tsx src/pages/rostering/LeaveApprovalsPage.test.tsx src/components/layout/AppLayout.tsx src/App.tsx`
Expected: no new errors introduced by these files.

- [ ] **Step 10: Commit**

```bash
git add src/pages/rostering/LeaveApprovalsPage.tsx src/pages/rostering/LeaveApprovalsPage.test.tsx src/components/layout/AppLayout.tsx src/components/layout/AppLayout.test.tsx src/App.tsx
git commit -m "feat(leave): LeaveApprovalsPage at /rostering/leave, sidebar entry + pending badge, route"
```

---

## Self-Review

**1. Spec coverage** (this plan's scope: spec "Delivery" item 2, plus the roster-board/
`ShiftSlideOver` pieces of §4 named in the brief):

| Spec requirement | Covered by |
|---|---|
| §2 Portal endpoints' TS mirror (types + hooks) | Task 1, Task 2 |
| §2 Coordinator (`LeaveController`) endpoints' TS mirror | Task 1, Task 2 |
| §2 `canRequestLeave`/`canApproveLeave`, `PageKey`s `portal-leave`/`leave-approvals` | Task 3 |
| §3 `RosterFinding.RequiresReason` consumed by `ShiftSlideOver`'s gate | Task 5 |
| §4 `LeaveBarDto.Kind` — pending dashed, approved/legacy unchanged, recurring renders **partial-day** | Task 4 |
| §4 Portal modal forms wired to `useUnsavedChangesWarning` | Task 7 |
| §4 `PortalLeavePage` — tabs, tables, create modals, withdraw, portal home link | Task 7, Task 8 |
| §4 `LeaveApprovalsPage` — filters, approve/decline/cancel, enter-on-behalf, sidebar badge | Task 7, Task 9 |
| §4 `AvailabilityEditor.tsx` drops "Leave", links to `/rostering/leave` | Task 6 |
| Error handling table (400/409 messages) | Surfaced end-to-end via each mutation's `extractErrorMessage` in Task 8/Task 9 (the messages themselves are server-authored by PR 1; this PR only ensures they reach the screen) |
| State-transition matrix | Enforced server-side (PR 1); this PR's UI only offers the transitions the matrix allows (Withdraw only on Pending, Cancel only on Approved, on-behalf lands Approved) |

**Out of this plan's scope** (per the brief's "Out of scope" and spec's Delivery item 3):
`src/pages/schedule/StaffAssignModal.tsx`'s live-check integration, `SchedulePage.tsx`'s
`Tentative` badge, `StaffTab.tsx`'s conflict marker, and every backend file — all PR 3/PR 1.

**2. Placeholder scan:** no TBD/TODO; every code step shows real, complete code; every test body
has concrete assertions. The one procedural exception is Task 9 Step 5's `AppLayout.tsx` edit,
which is a targeted diff against the exact lines read from source (quoted in Task 9) rather than
a full-file rewrite, matching how Task 5's `ShiftSlideOver.tsx` edit is also a targeted diff.

**3. Type consistency:** `CreateLeaveRequestDto`/`CreateRecurringUnavailabilityDto` (Task 1) are
the exact payload shape `LeaveRequestFormModal`/`UnavailabilityFormModal` (Task 7) submit, which
is the exact argument type `useCreateLeaveRequest`/`useCreateLeaveOnBehalf` (Task 2) accept.
`LeaveRequestDto`/`RecurringUnavailabilityDto` field names (`userFullName`, `requestedByUserId`,
`decisionNote`, etc.) are used identically across Task 4's fixtures, Task 8's `PortalLeavePage`
columns, and Task 9's `LeaveApprovalsPage` columns — no renamed field anywhere in the chain.
`RosterFindingDto.requiresReason` (Task 1) is the same name `ShiftSlideOver` (Task 5) and
`LeaveApprovalsPage`'s overlap notice (Task 9, via `FindingsList`) both read.

**Rulings** (spec was silent or ambiguous; each recorded here with its reasoning):

- Ruling: `'leave-approvals'` is **not** added to `SUPPORT_WORKER_PAGES` — it falls through to
  `canAccessPage`'s default (visible to any non-SupportWorker role, including ReadOnly) — because
  this is the exact existing pattern the `'rostering'` `PageKey` already uses today. The backend's
  `LeaveController` role gate (`Admin,Coordinator,SuperAdmin`, excluding `ReadOnly`) is stricter
  than the frontend's page-visibility check, but that asymmetry already exists for the whole
  Rostering area (`RosteringController` has the identical gate) and is not something this PR
  introduces or needs to fix.
- Ruling: the approve-with-overlaps UX is a two-step `ConfirmDialog` flow — a plain "Approve?"
  confirm, then (after the mutation succeeds) a second dialog reporting the returned
  `overlaps.length` findings via the existing `FindingsList`, or a plain "no overlap" sentence,
  closed with "Done". Approval itself is never blocked by the overlaps; the second dialog is a
  notice, not a second gate — matches the spec's literal wording ("approval itself is never
  blocked by this. The approvals UI shows... before the coordinator confirms" resolved as: confirm
  → call approve → show what happened).
- Ruling: `usePendingLeaveCount` shares the `['leave-requests', { status: 'Pending' }]` query key
  with `useLeaveRequests({ status: 'Pending' })` and polls every 60s — mirrors the existing
  `usePendingWitnessRequests` sidebar-badge pattern exactly (same shared-key-plus-poll shape), so
  the badge and `LeaveApprovalsPage`'s default view read/refresh one cached request rather than
  two independent ones.
- Ruling: `AvailabilityEditor`'s "Add Leave" button (its *only* create action — it never had a
  type dropdown; `handleAdd` always hardcoded `availabilityType: 'Leave'`) is removed outright,
  not narrowed. Existing `Unavailable`/`Training`/`Preferred`/`Available` rows keep their inline
  edit/delete unchanged.
- Ruling: `LeaveBar`'s per-`kind` styling distinguishes two things, not one: `PendingLeave` gets a
  dashed border + "(pending)" label suffix on the existing full-day bar (same as `ApprovedLeave`/
  `Legacy` otherwise); `RecurringRule` renders as a genuinely different shape — a **partial-day**
  block positioned/sized within its single occurrence day by `startTime`/`endTime`, per the
  spec's explicit "partial-day bars" wording. No hour-proportional positioning helper exists
  anywhere in `src/pages/rostering/` to reuse (the whole board is day-granularity — every other
  bar spans whole `gridColumn` units; confirmed by reading `TripBar.tsx`, `ShiftChip.tsx`,
  `RosterDayCell.tsx`, `StaffRow.tsx`), so Task 4 adds a small new `timeOfDayPercent` helper
  local to `LeaveBar.tsx` mapping the full 24h day, rather than reusing a pre-existing one. A
  recurring rule's single-weekday occurrence needs no new day-*clipping* logic since it arrives
  as its own `startDate === endDate` row, already handled by the existing `clampedDayIndex` math
  — only the *within-day* sizing is new.
- Ruling: the portal "home card" is a header link on `PortalShiftsPage` (`/portal`, the portal's
  actual home route) mirroring the existing "Witness approvals" link, not a new dashboard card —
  `DashboardPage` is coordinator-facing, not the staff portal's landing page.
- Ruling: `LeaveApprovalsPage`'s "requested by/when" column is derived, not a new backend field —
  `requestedByUserId === userId` renders "Self"; otherwise the id is resolved against the already-
  loaded `useStaff()` list (falling back to "Coordinator" if not found) and joined with the date.
  No DTO change was needed or made for this.
- Ruling: the coordinator status filter includes an explicit "All statuses" option (`value: ''`
  mapped to `status: undefined` in the query) in addition to the spec's stated Pending default —
  the spec only fixes the *default*, not whether other statuses/an "all" view are reachable, and a
  filter with no way back to "everything" would be a usability regression against the spec's own
  intent ("filters for status (default Pending)").
- Ruling: `useUnsavedChangesWarning` (named explicitly in spec §4 for the portal forms) is wired
  into both `LeaveRequestFormModal` and `UnavailabilityFormModal` (Task 7), tracking each form's
  `formState.isDirty`, exactly the way `VehicleCreatePage.tsx` — an existing RHF+zod create form —
  already does (`const { dialog } = useUnsavedChangesWarning(isDirty)`, dialog rendered alongside
  the page). Because the hook calls `useBlocker`, which throws outside a data router, every test
  that renders either modal (directly in Task 7, or indirectly via `PortalLeavePage`/
  `LeaveApprovalsPage` in Task 8/9) now renders through `createMemoryRouter`/`RouterProvider`
  instead of a plain `<MemoryRouter>` — matching `VehicleCreatePage.test.tsx`'s own harness for
  the same hook. No test asserts the unsaved-changes dialog's *visibility* (only that the router
  requirement doesn't crash the render) — this matches the codebase's own precedent, since
  `VehicleCreatePage.test.tsx` doesn't assert that either.
- Ruling: `LEAVE_TYPE_LABELS` and `LEAVE_STATUS_COLORS` are defined exactly once, in Task 1's
  `leave.ts`, and imported by every consumer (Task 7's two form modals, Task 8's
  `PortalLeavePage`, Task 9's `LeaveApprovalsPage`) rather than each page/component defining its
  own copy — avoids the drift a per-file copy invites (two different English strings for the same
  concept was exactly the kind of thing this ruling prevents). `LEAVE_STATUS_COLORS` is a
  `StatusBadge` `colorMap` override (`StatusBadge.tsx:4`, looked up lower-cased at
  `StatusBadge.tsx:55-56`) because `StatusBadge`'s own built-in `STATUS_COLORS` map
  (`StatusBadge.tsx:9-50`) has no `approved`/`declined` keys and only an unrelated `pending` key
  (a QSC status, not this domain's), so every `LeaveStatus` value would otherwise fall through to
  the same default amber colour and render visually indistinguishable.

## Anything not mapped to a task, and why

Nothing in this plan's scope (spec "Delivery" item 2 plus the named roster-board/`ShiftSlideOver`
pieces of §4) was left uncovered. Everything else in the spec — the backend (§1/§2/§3 minus the
DTO shapes this plan mirrors), and `StaffAssignModal`/`SchedulePage`/`StaffTab` (§4's trip-side
parity) — belongs to PR 1 and PR 3 respectively, per the spec's own "Delivery" split, and is
explicitly out of scope per the brief.
