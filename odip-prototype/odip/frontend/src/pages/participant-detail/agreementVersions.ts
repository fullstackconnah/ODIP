import type { ServiceAgreementDraftDto } from '@/api/types'
import { localIsoDate } from '@/lib/dateOnly'
import { formatDateRange } from '@/lib/dateRange'

export type VersionStatus = 'Draft' | 'Approved' | 'Upcoming' | 'Replaced' | 'Ended' | 'Ended early'

export interface VersionRow {
  id: string
  version: number
  status: VersionStatus
  /** The signed end was moved up (shows from the day it is set, the badge only once the last day has passed). */
  endedEarly: boolean
  newest: boolean
  term: string
  total: number
  approvedLine: string
  /** The start of the first newer approved revision that begins on or before this one's end (a renewal begins the day after, so it is not one). */
  takesOverOn: string | null
  start: string
  end: string
  original: string | null
  /** The signed end an early end replaced, as a day; the section shows it muted after the term. */
  was: string | null
}

const day = (iso: string) => formatDateRange(iso, iso)

/**
 * One row for each version, in the order given (newest first). The status is date-aware, as the server's AgreementEnding and the approval are: a version is Replaced only once the revision that
 * takes over has started, Upcoming until its own start, Ended once its end has passed. `today` is the viewer's calendar day (`localIsoDate`).
 */
export function versionRows(drafts: readonly ServiceAgreementDraftDto[], today: string): VersionRow[] {
  const newestVersion = Math.max(0, ...drafts.map(d => d.version))
  const approved = drafts.filter(d => d.approval)
  return drafts.map(d => {
    const takesOver = approved.filter(n => n.version > d.version && n.agreementStartDate <= d.agreementEndDate).map(n => n.agreementStartDate).sort()[0] ?? null
    const original = d.originalAgreementEndDate && d.originalAgreementEndDate !== d.agreementEndDate ? d.originalAgreementEndDate : null
    const ended = d.agreementEndDate < today
    const status: VersionStatus = !d.approval ? 'Draft'
      : takesOver && takesOver <= today ? 'Replaced'
      : d.agreementStartDate > today ? 'Upcoming'
      : ended ? (original ? 'Ended early' : 'Ended')
      : 'Approved'
    const range = d.isOngoing ? `${formatDateRange(d.agreementStartDate, null)} – Ongoing` : formatDateRange(d.agreementStartDate, d.agreementEndDate)
    return {
      id: d.id,
      version: d.version,
      status,
      endedEarly: !!original,
      newest: d.version === newestVersion,
      term: `${status === 'Upcoming' ? 'from ' : ''}${range}`,
      was: original ? day(original) : null,
      total: d.total,
      approvedLine: d.approval ? `${day(localIsoDate(new Date(d.approval.approvedAt)))} · ${d.approval.approvedByName}` : '—',
      takesOverOn: takesOver,
      start: d.agreementStartDate,
      end: d.agreementEndDate,
      original,
    }
  })
}
