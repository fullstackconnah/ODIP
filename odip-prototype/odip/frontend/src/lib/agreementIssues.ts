// What stands in the way of the agreement, or deserves a look, in the wizard's words: one list for the Check step. It joins what can be seen from the shifts alone (a missing number, two shifts
// at once, a limit) with what the pricing engine says about the blocks they make, mapped back to the shifts. `fix` stops a save or an approval; `review` does not.
import type { PlanBlock, PlanIssue, PlanPricingSettingsDto } from '@/api/types'
import { plural } from './format'
import { writtenDay } from './fundingPlan'
import { groupLabel, limitMessage, overlappingShiftIds, shiftWords, type EngineLimits, type Shift, type ShiftGroup } from './agreementShifts'
import { DAY_SHORT, blockProblems } from './planBlocks'
import { REASON_COPY, groupIssues, isRefusal, issueWhere } from './planQuote'

/** The last day the 2026-27 catalogue prices. */
export const CATALOGUE_LAST_DAY = '2027-06-30'

export interface AgreementIssue {
  key: string
  tone: 'fix' | 'review'
  title: string
  detail?: string
  advice?: string
  /** The shifts it is about: "Fix" selects them in the Week step. Empty when it is about the whole week or the dates. */
  shiftIds: string[]
  /** Where it is fixed. */
  step: 'agreement' | 'week'
}

type Input = {
  shifts: readonly Shift[]
  groups: readonly ShiftGroup[]
  quoteIssues: readonly PlanIssue[]
  limits: EngineLimits
  /** The agreement's last day, for the catalogue note. */
  to: string
  settings?: PlanPricingSettingsDto
}

const dated = (text: string) => text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (whole, iso: string) => writtenDay(iso).replace('–', whole))

export function agreementIssues({ shifts, groups, quoteIssues, limits, to, settings }: Input): AgreementIssue[] {
  const issues: AgreementIssue[] = []

  groups.forEach(group => {
    const block: PlanBlock = group.entry.block
    blockProblems(block, { groupsHeld: settings?.registrationGroupsHeld, groupOutings: settings?.groupOutings, claimProviderTravel: settings?.claimProviderTravel }).forEach(problem => {
      issues.push({ key: `${block.id}-${problem.field}`, tone: 'fix', title: `${groupLabel(block)}: ${shiftWords(problem.message, groups)}`, shiftIds: group.shiftIds, step: 'week' })
    })
  })

  const clash = overlappingShiftIds(shifts)
  if (clash.size > 0) {
    const overlapping = shifts.filter(shift => clash.has(shift.id))
    const days = [...new Set(overlapping.map(shift => DAY_SHORT[shift.day]))].join(', ')
    issues.push({
      key: 'overlap', tone: 'review', title: `${plural(clash.size, 'shift')} overlap another shift`, detail: `On ${days}. The same hour would be priced twice.`,
      advice: 'Move one of them, or make it one shift with 2 workers.', shiftIds: overlapping.map(shift => shift.id), step: 'week',
    })
  }

  const limit = limitMessage(limits)
  if (limit) issues.push({ key: 'limit', tone: limits.exceeded === 'blocks' ? 'fix' : 'review', title: limit, shiftIds: [], step: 'week' })

  groupIssues(quoteIssues).filter(issue => issue.reason !== 'BlocksOverlap').forEach((issue, index) => {
    const copy = REASON_COPY[issue.reason]
    const where = issueWhere(issue)
    issues.push({
      key: `${issue.blockId}-${issue.reason}-${index}`,
      tone: isRefusal(issue.reason) ? 'fix' : 'review',
      title: shiftWords(copy?.title ?? 'Needs a look', groups),
      detail: `${dated(shiftWords(issue.message, groups))}${where ? ` (${where})` : ''}`,
      advice: copy ? shiftWords(copy.advice, groups) : undefined,
      shiftIds: groups.find(group => group.entry.block.id === issue.blockId)?.shiftIds ?? [],
      step: 'week',
    })
  })

  if (to > CATALOGUE_LAST_DAY) {
    issues.push({
      key: 'catalogue', tone: 'review', title: `The NDIS catalogue is published to ${writtenDay(CATALOGUE_LAST_DAY)}. Shifts after that date are not priced yet.`,
      advice: 'End the agreement on or before that day, or come back when the next catalogue is out.', shiftIds: [], step: 'agreement',
    })
  }
  return issues
}
