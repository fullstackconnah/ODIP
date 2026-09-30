import type { Tone } from '@/lib/tone'
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
 * `StatusBadge`'s built-in STATUS_TONE (lib/tone.ts) has no `approved`/`declined` keys for this domain, `pending` only exists there for
 * an unrelated QSC status, and its `cancelled` is danger while a cancelled leave request is just over: so every `LeaveStatus` value would
 * otherwise fall through to the same amber fallback or read as a failure, making Pending/Approved/Declined rows indistinguishable.
 * `StatusBadge` accepts an override via its `colorMap` prop (looked up by the lower-cased status); this is that override, shared by
 * `PortalLeavePage` and `LeaveApprovalsPage` so every leave/unavailability status badge in the app renders identically: pending is the
 * warning tone (awaiting a decision), approved success, declined danger, cancelled neutral.
 */
export const LEAVE_STATUS_COLORS: Record<string, Tone> = {
  pending: 'warning',
  approved: 'success',
  declined: 'danger',
  cancelled: 'neutral',
}

/** Mirrors StaffUnavailabilityQuery.UnavailabilityKind — which of the three sources (plus the
 * legacy StaffAvailability table) a LeaveBarDto/roster-conflict window came from.
 * PendingRecurringRule (2026-09-09 audit ruling) is RecurringRule's pending counterpart, exactly
 * as PendingLeave is to ApprovedLeave — a Pending RecurringUnavailability rule now surfaces on
 * the board/gate instead of being invisible until approved. */
export const UNAVAILABILITY_KINDS = ['ApprovedLeave', 'PendingLeave', 'RecurringRule', 'PendingRecurringRule', 'Legacy'] as const
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

/** PUT /leave/{id} body. userId is never editable — a leave request stays attached to whoever
 * it was raised for. Editable only while Pending/Approved server-side (409 otherwise). */
export interface UpdateLeaveRequestDto {
  leaveType: LeaveType
  startDate: string
  endDate: string
  reason?: string | null
}

export interface LeaveDecisionDto {
  decisionNote: string
}

/** A rostered shift that overlaps the leave/unavailability window just approved or edited —
 * beside the finding-shaped `overlaps` summary, this is enough to act on directly (per-row
 * "Unassign and mark open" in the approvals dialog) without a second fetch. Mirrors backend
 * ShiftDto's own date/time fields (serviceDate 'yyyy-MM-dd', start/endTime 'HH:mm:ss'). */
export interface OverlapShiftDto {
  shiftId: string
  serviceDate: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  participantId: string
  participantName: string
}

/** POST /leave/{id}/approve response — approval is never blocked by overlaps; the UI shows them. */
export interface ApproveLeaveResultDto {
  leave: LeaveRequestDto
  overlaps: RosterFindingDto[]
  overlapShifts: OverlapShiftDto[]
}

/** PUT /leave/{id} response — same { leave, overlaps } shape as approve; overlaps is empty when
 * the edited request is still Pending. */
export type LeaveApprovalResultDto = ApproveLeaveResultDto

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

/** PUT /leave/unavailability/{id} body. userId is never editable. Editable only while
 * Pending/Approved server-side (409 otherwise). */
export interface UpdateRecurringUnavailabilityDto {
  dayOfWeek: string
  startTime: string
  endTime: string
  effectiveFrom: string
  effectiveTo?: string | null
  notes?: string | null
}

export interface ApproveRecurringUnavailabilityResultDto {
  unavailability: RecurringUnavailabilityDto
  overlaps: RosterFindingDto[]
  overlapShifts: OverlapShiftDto[]
}

/** PUT /leave/unavailability/{id} response — same shape as approve. */
export type RecurringUnavailabilityApprovalResultDto = ApproveRecurringUnavailabilityResultDto

// ── Portal combined response ──────────────────────────────

/** GET /portal/leave */
export interface MyLeaveResponseDto {
  leave: LeaveRequestDto[]
  unavailability: RecurringUnavailabilityDto[]
}
