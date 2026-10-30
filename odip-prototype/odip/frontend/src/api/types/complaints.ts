import type { ComplaintChannel, ComplainantKind, ComplaintStatus } from './enums'

/** Open longer than this many calendar days is "long open". The server counts and filters with the same number (Odip.Domain ComplaintAge.LongOpenDays). */
export const LONG_OPEN_DAYS = 21

/** Dates are `yyyy-mm-dd` strings (DateOnly on the wire). */
export interface ComplaintListDto {
  id: string
  receivedOn: string
  channel: ComplaintChannel
  complainantKind: ComplainantKind
  complainantName?: string | null
  participantName?: string | null
  summary: string
  status: ComplaintStatus
  /** Calendar days open on the organisation's date; null once Resolved or Closed. */
  openDays?: number | null
  acknowledgedOn?: string | null
  isActive: boolean
  updatedAt: string
}

export interface ComplaintDto {
  id: string
  receivedOn: string
  channel: ComplaintChannel
  complainantKind: ComplainantKind
  participantId?: string | null
  participantName?: string | null
  complainantName?: string | null
  summary: string
  status: ComplaintStatus
  acknowledgedOn?: string | null
  actionsTaken?: string | null
  outcome?: string | null
  outcomeCommunicatedOn?: string | null
  toldAboutCommission: boolean
  toldAboutCommissionOn?: string | null
  closedOn?: string | null
  handledByUserId?: string | null
  handledByName?: string | null
  incidentReportId?: string | null
  incidentReportTitle?: string | null
  openDays?: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/** The body of both POST and PUT. */
export interface SaveComplaintDto {
  receivedOn: string
  channel: ComplaintChannel
  complainantKind: ComplainantKind
  participantId: string | null
  complainantName: string | null
  summary: string
  status: ComplaintStatus
  acknowledgedOn: string | null
  actionsTaken: string | null
  outcome: string | null
  outcomeCommunicatedOn: string | null
  toldAboutCommission: boolean
  toldAboutCommissionOn: string | null
  closedOn: string | null
  handledByUserId: string | null
  incidentReportId: string | null
  /** PUT only: the version the form loaded; a stale one is a 409. */
  expectedUpdatedAt?: string | null
}
