import type { ShiftCancellationReason } from './enums'
import type { LeaveType } from './leave'

export type ReportRange = { from: string; to: string }

export interface HoursByWorkerRowDto {
  workerId: string
  workerName: string
  approvedShifts: number
  approvedHours: number
  awaitingApprovalHours: number
}

/** One row of Cancellations by reason. A null reason is the cancelled shifts with no reason recorded. */
export interface CancellationReasonCountDto {
  reason: ShiftCancellationReason | null
  cancelled: number
}

export interface ShiftFulfilmentWeekDto {
  /** The Monday, "YYYY-MM-DD". */
  weekStart: string
  shifts: number
  filled: number
  unstaffed: number
  cancelled: number
  /** Null when nothing in the week needed filling. */
  fillRatePercent: number | null
  /** The range cuts this week, so the counts cover only its days inside the range. */
  partWeek: boolean
}

export interface LeaveTakenRowDto {
  leaveId: string
  workerId: string
  workerName: string
  type: LeaveType
  from: string
  to: string
  daysInRange: number
}
