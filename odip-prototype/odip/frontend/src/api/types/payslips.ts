/** What My payslips can say. NotConnected and NotLinked are answers (200), not failures. */
export type PayslipListStatus = 'NotConnected' | 'NotLinked' | 'Ready'

/** One payslip in the caller's own list: dates only (DateOnly strings, "2026-10-08"). No figure is ever sent. */
export interface PortalPayslipDto {
  payRunId: number
  datePaid: string | null
  periodStart: string | null
  periodEnd: string | null
  paySchedule: string | null
}

export interface PortalPayslipsDto {
  status: PayslipListStatus
  payslips: PortalPayslipDto[]
}
