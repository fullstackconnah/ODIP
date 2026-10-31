import type { LeaveType } from './leave'
/** Settings → Integrations → Employment Hero. There is never an API-key field: the key is write-only. */
import type { PayrollShiftStatus, SleepoverType } from './enums'
export type EmploymentHeroAttentionKind = 'NotLinked' | 'FixInEmploymentHero' | 'FixInOdip' | 'MissingFromEmploymentHero' | 'ConfirmAddress'

export interface EmploymentHeroAttentionDto {
  id: string
  kind: EmploymentHeroAttentionKind
  userId: string | null
  /** The EH employee the item is about or, on a NotLinked item, the same-name match to suggest. */
  employeeId: string | null
  name: string
  reason: string
}

export interface EmploymentHeroStatusDto {
  /** False when the server has no INTEGRATIONS_MASTER_KEY: connecting is refused. */
  configured: boolean
  connected: boolean
  businessId: string | null
  businessName: string | null
  connectedAt: string | null
  connectedByName: string | null
  lastSyncAt: string | null
  /** Why the last sync failed, in words for the Admin; null when it worked. */
  lastSyncError: string | null
  staffLinked: number
  staffNotLinked: number
  attention: EmploymentHeroAttentionDto[]
  /** Timesheets sent to EH (Sent), and queued but not yet sent (Pending or Failed). */
  timesheetsSent: number
  timesheetsWaiting: number
  workTypes: EmploymentHeroWorkTypesDto
  /** Leave sent to EH, and leave queued to send or waiting for its category. */
  leaveSent: number
  leaveWaiting: number
  leaveCategories: EmploymentHeroLeaveCategoriesDto
  /** Leave (or a cancellation) EH didn't take. waiting: held for a category or a link, so no Try again. reason is the server's words. */
  leaveProblems: EmploymentHeroLeaveProblemDto[]
}

/** The EH leave category id (a string) each kind of ODIP leave is sent under; null is not set. */
export interface EmploymentHeroLeaveCategoriesDto {
  annual: string | null
  sick: string | null
  personal: string | null
  other: string | null
}
export interface EmploymentHeroLeaveCategoryDto { id: string; name: string }
export interface EmploymentHeroLeaveProblemDto {
  id: string
  leaveId: string
  name: string
  leaveType: LeaveType
  startDate: string
  endDate: string
  cancelling: boolean
  waiting: boolean
  reason: string
}

/** GET portal/leave/balances and staff/{id}/leave-balances. */
export interface LeaveBalanceDto { category: string; amount: number; unit: string }
export interface LeaveBalancesDto { status: 'NotConnected' | 'NotLinked' | 'Ready'; balances: LeaveBalanceDto[] }

/** The EH work type id (a string) each kind of hours is sent under; null is not set. */
export interface EmploymentHeroWorkTypesDto {
  standard: string | null
  activeNight: string | null
  passiveNight: string | null
  sleepover: string | null
}
export interface EmploymentHeroWorkTypeDto { id: string; name: string }

export interface EmploymentHeroBusinessDto { id: string; name: string }
/** addedBySync: linked to someone the sync added who has never signed in; Link moves the id to the chosen person and archives that duplicate. */
export interface EmploymentHeroEmployeeDto { id: string; name: string; email: string | null; addedBySync?: boolean }

export interface PayPeriodDto { payScheduleId: number; scheduleName: string; from: string; to: string; finalised: boolean }
export interface PayPeriodsDto { connected: boolean; today: string; periods: PayPeriodDto[] }

export interface PayrollShiftDto {
  shiftId: string
  serviceDate: string
  participantName: string
  rosteredStart: string
  rosteredEnd: string
  endsNextDay: boolean
  rosteredMinutes: number
  actualStart: string
  actualEnd: string | null
  timeZoneId: string
  breakMinutes: number
  paidMinutes: number
  nightType: SleepoverType
  status: PayrollShiftStatus
  reason: string | null
  sentAt: string | null
  /** Send missing would queue this shift. */
  sendable: boolean
}
export interface PayrollWorkerDto { userId: string; name: string; linked: boolean; rosteredMinutes: number; paidMinutes: number; shifts: PayrollShiftDto[] }
export interface PayrollCheckDto {
  from: string
  to: string
  approved: number
  sent: number
  waiting: number
  failed: number
  changed: number
  notLinked: number
  sendable: number
  awaitingApproval: number
  workers: PayrollWorkerDto[]
}
export interface PayrollRangeDto { from: string; to: string }
export interface SendMissingResultDto { queued: number; check: PayrollCheckDto }
