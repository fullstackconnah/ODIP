import type { AgreementBulkAction, AgreementDraftRef, AgreementRow, PriceList } from '@/api/types'
import { endingBadgeWords } from '@/lib/agreementEnding'
import { formatDateRange } from '@/lib/dateRange'
import type { Tone } from '@/lib/tone'
import { formatCurrency } from '@/lib/utils'

export const SHOW_VALUES = ['all', 'ending', 'ended', 'draft', 'new-price-list'] as const
export type Show = (typeof SHOW_VALUES)[number]

export const parseShow = (raw: string | null): Show => (SHOW_VALUES as readonly string[]).includes(raw ?? '') ? raw as Show : 'all'

/** The most rows one selection may hold: more than a minute of approving, and too many to review by eye. */
export const MAX_SELECTED = 100

export interface RowFilters { show: Show; list: string; q: string }

/** Reads the row's facts, never its one status word (a draft waiting hides "ending"). "Ending soon" also holds the ended ones, as the old Agreements ending view did. */
export function filterRows(rows: readonly AgreementRow[], { show, list, q }: RowFilters): AgreementRow[] {
  const term = q.trim().toLowerCase()
  return rows.filter(r =>
    (show === 'all'
      || (show === 'ending' && r.endingState !== 'None')
      || (show === 'ended' && r.endingState === 'Ended')
      || (show === 'draft' && r.hasWaitingDraft)
      || (show === 'new-price-list' && r.newerPriceList !== null))
    && (!list || r.priceList?.version === list)
    && (!term || r.participantName.toLowerCase().includes(term)))
}

/** The price lists the rows are on, newest first. */
export function listOptions(rows: readonly AgreementRow[]): PriceList[] {
  const byVersion = new Map<string, PriceList>()
  for (const r of rows) if (r.priceList) byVersion.set(r.priceList.version, r.priceList)
  return [...byVersion.values()].sort((a, b) => b.start.localeCompare(a.start) || b.version.localeCompare(a.version))
}

export function statusBadge(r: AgreementRow): { tone: Tone; label: string } {
  switch (r.status) {
    case 'NotApproved': return { tone: 'neutral', label: 'Not approved yet' }
    case 'DraftWaiting': return { tone: 'warning', label: 'Draft waiting' }
    case 'Ended': return { tone: 'danger', label: 'Ended' }
    case 'Ending': return { tone: 'warning', label: endingBadgeWords(r.daysLeft ?? 0) }
    default: return { tone: 'success', label: 'Active' }
  }
}

/** The ticked rows that have a draft waiting, as the approve request names them. */
export function approveTargets(rows: readonly AgreementRow[], selected: ReadonlySet<string>): AgreementDraftRef[] {
  return rows.filter(r => selected.has(r.participantId) && r.waiting).map(r => ({ participantId: r.participantId, draftId: r.waiting!.draftId }))
}

export interface TermView { range: string; total: number; from: string | null; draftLine: string | null }

/** What the Term and Total cells show: the approved term (from its first revision), or the unapproved draft when nothing is approved. */
export function termView(r: AgreementRow): TermView {
  const shown = r.current ?? r.waiting
  if (!shown) return { range: '', total: 0, from: null, draftLine: null }
  const start = r.current ? (r.termStart ?? r.current.agreementStartDate) : shown.agreementStartDate
  return {
    range: formatDateRange(start, shown.agreementEndDate),
    total: shown.total,
    from: r.current && r.termStart && r.current.agreementStartDate > r.termStart ? r.current.agreementStartDate : null,
    draftLine: !r.current ? `Draft v${shown.version}, never approved` : r.waiting ? `Draft v${r.waiting.version}: ${formatDateRange(r.waiting.agreementStartDate, r.waiting.agreementEndDate)}` : null,
  }
}

/** What the server will leave alone in a bulk run, one line per reason, each row counted once (waiting draft, then ended, then already on the list). The server still decides per agreement. */
export function bulkSkipNotes(selected: readonly AgreementRow[], action: AgreementBulkAction, list?: PriceList | null): string[] {
  let waiting = 0, ended = 0, already = 0
  for (const r of selected) {
    if (r.hasWaitingDraft) waiting++
    else if (action === 'reprice' && r.endingState === 'Ended') ended++
    else if (action === 'reprice' && list && r.priceList && r.priceList.start >= list.start) already++
  }
  const has = (n: number) => (n === 1 ? 'has' : 'have')
  return [
    waiting && `${waiting} ${has(waiting)} a draft waiting and will be skipped.`,
    ended && `${ended} ${has(ended)} ended and will be skipped.`,
    already && `${already} ${already === 1 ? 'is' : 'are'} already on ${list!.version} or a newer price list and will be skipped.`,
  ].filter(Boolean) as string[]
}

/** The latest end among the ticked agreements that are approved: an extension must run past it. */
export function latestEnd(selected: readonly AgreementRow[]): string | null {
  return selected.reduce<string | null>((latest, r) => (r.current && (!latest || r.current.agreementEndDate > latest) ? r.current.agreementEndDate : latest), null)
}

/** After minus before, signed: a rise is not good or bad, so it is plain ink, with a true minus sign. */
export function changeWords(before: number, after: number): string {
  const delta = Math.round((after - before) * 100) / 100
  return delta === 0 ? formatCurrency(0) : `${delta > 0 ? '+' : '−'}${formatCurrency(Math.abs(delta))}`
}
