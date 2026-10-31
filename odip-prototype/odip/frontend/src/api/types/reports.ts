import type { LeaveType } from './leave'

export type ReportRange = { from: string; to: string }

export interface HoursByWorkerRowDto {
  workerId: string
  workerName: string
  approvedShifts: number
  approvedHours: number
  awaitingApprovalHours: number
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
