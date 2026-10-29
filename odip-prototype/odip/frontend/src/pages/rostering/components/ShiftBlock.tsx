import type { CSSProperties, KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertOctagon, AlertTriangle, CalendarOff, Check, KeyRound, Lock, Siren } from 'lucide-react'
import type { ShiftDto } from '@/api/types'
import { formatShiftTime } from '@/lib/utils'
import { ON_TINT, TONE } from '@/lib/tone'
import {
  NIGHT_TYPE_LABELS, RATIO_LABELS, formatDayAccessibleName, formatDayHeader, formatShiftRange, formatShiftTimeRange, isUnfilledShift,
  participantWeekHref, shiftSource, staffWeekHref, weekStartFromDateParam,
} from '../lib/roster'
import { firstName, isLockedShift, lockedWords } from '../lib/rosterDrag'
import { nextDate, type Segment } from '../lib/weekGrid'
import { findingsSeverityLabel } from './ShiftChip'
import { OVER_BUDGET_MARKER, markerForAcknowledgedCodes } from './parallel-budget-override'

export type ShiftBlockProps = {
  seg: Segment
  context: 'staff' | 'participant'
  /** top/height/left/width from the grid's lane maths. */
  style: CSSProperties
  heightPx: number
  laneWidthPx: number
  onOpen: (shift: ShiftDto) => void
}

// The chip's name-link styles (ShiftChip.tsx LABEL_LINK), kept private there, copied here.
const LABEL_LINK =
  'min-w-0 flex-1 pointer-coarse:flex-initial truncate rounded-sm pointer-coarse:leading-[var(--tap-min)] text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'

const DASHED = 'color-mix(in srgb, var(--color-muted-foreground) 60%, transparent)'

/** Sentence case for a night type ("Active night"); the shared map is title case. */
function nightWord(nightType: string): string | null {
  const label = NIGHT_TYPE_LABELS[nightType]
  return nightType === 'None' || !label ? null : label.replace(/ N/, ' n')
}

function continuation(seg: Segment): string | null {
  if (seg.part === 'first') return `continues on ${formatDayAccessibleName(nextDate(seg.date))}`
  if (seg.part === 'second') return `continued from ${formatDayAccessibleName(nextDate(seg.date, -1))}`
  return null
}

/** The block's lines, the chip's `openName` order plus night type, Cancelled and the continuation. */
function blockLines(shift: ShiftDto, seg: Segment, context: 'staff' | 'participant') {
  const filled = Boolean(shift.staffId && shift.staffName)
  const source = shiftSource(shift)
  const locked = isLockedShift(shift)
  const unstaffedDraft = shift.status === 'Draft' && isUnfilledShift(shift)
  const budgetMarker = markerForAcknowledgedCodes(shift.acknowledgedFindingCodes)
  const budgetReviewWords = budgetMarker === 'emergency' ? (shift.budgetReview?.state === 'Reviewed' ? 'Reviewed' : 'Admin review pending') : null
  const budgetName = budgetMarker ? [OVER_BUDGET_MARKER[budgetMarker], budgetReviewWords].filter(Boolean).join(', ') : null
  const awayLine = shift.regularAwayReason ? `Regular away: ${shift.regularAwayReason}` : null
  const lockTitle = `${lockedWords(shift.status)}: can't be changed here`
  const label = context === 'participant' ? (filled ? shift.staffName : 'Needs staff') : shift.participantName
  const statusWords = locked ? lockTitle : unstaffedDraft ? 'Needs staff' : shift.status
  const night = nightWord(shift.nightType)
  const lines = [
    shift.findings.length ? findingsSeverityLabel(shift.findings) : null,
    `${formatShiftTimeRange(shift.startTime, shift.endTime)}${shift.endsNextDay ? ' (ends the next day)' : ''}`,
    label,
    shift.isRegular ? `${firstName(shift.staffName)} is the regular` : null,
    awayLine,
    source.kind === 'adhoc' ? null : source.word,
    source.title,
    shift.ratio !== 'OneToOne' ? `${RATIO_LABELS[shift.ratio] ?? shift.ratio} ratio` : null,
    night,
    budgetName ?? (shift.overrideReason ? `Assigned with an override: ${shift.overrideReason}` : null),
    filled && shift.assigneeOnApprovedLeave ? 'On leave' : null,
    statusWords,
    continuation(seg),
  ].filter((x): x is string => Boolean(x))
  return { lines, lockTitle, budgetMarker, budgetName }
}

export function ShiftBlock({ seg, context, style, heightPx, laneWidthPx, onOpen }: ShiftBlockProps) {
  const { shift } = seg
  const filled = Boolean(shift.staffId && shift.staffName)
  const onLeave = filled && shift.assigneeOnApprovedLeave
  const locked = isLockedShift(shift)
  const isDraft = shift.status === 'Draft' && !isUnfilledShift(shift)
  const hole = isUnfilledShift(shift) || onLeave
  const hasFindings = shift.findings.length > 0
  const hasBlocking = shift.findings.some(f => f.severity === 'Blocking')
  const { lines, lockTitle, budgetMarker, budgetName } = blockLines(shift, seg, context)
  const rows = Math.floor((heightPx - 4) / 16)
  const showName = rows >= 2
  const showLink = showName && laneWidthPx >= 60
  const showTags = rows >= 3
  const cancelled = shift.status === 'Cancelled'
  const night = nightWord(shift.nightType)

  const BudgetIcon = budgetMarker === 'adminOverride' ? KeyRound : shift.budgetReview?.state === 'Reviewed' ? Check : Siren
  const budgetInk = budgetMarker === 'adminOverride' ? TONE.info.ink : shift.budgetReview?.state === 'Reviewed' ? TONE.success.ink : TONE.warning.ink
  const iconCount = Number(hasFindings) + Number(Boolean(budgetMarker)) + Number(locked)

  const cue = seg.part === 'first' ? `to ${formatDayHeader(nextDate(seg.date)).weekday}` : seg.part === 'second' ? `from ${formatDayHeader(nextDate(seg.date, -1)).weekday}` : null
  const title = [
    onLeave ? `${shift.staffName} has approved leave covering this shift — this slot needs a new assignee.` : null,
    shift.regularAwayReason ? `Regular away: ${shift.regularAwayReason}` : null,
    shift.isRegular ? `${shift.staffName} is the regular` : null,
    budgetName,
    hasFindings ? findingsSeverityLabel(shift.findings) : null,
    formatShiftRange(shift.startTime, shift.endTime, shift.endsNextDay),
    lines[lines.length - 1],
  ].filter(Boolean).join('\n')

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(shift)
    }
  }

  const link = (to: string, text: string | null | undefined) => (
    <Link to={to} onClick={e => e.stopPropagation()} className={LABEL_LINK} title={text ?? undefined}>{text}</Link>
  )
  const nameLine = context === 'participant'
    ? filled
      ? showLink ? link(staffWeekHref(shift.staffId!, weekStartFromDateParam(shift.serviceDate)), shift.staffName) : <span className="min-w-0 flex-1 truncate">{shift.staffName}</span>
      : <span className="min-w-0 flex-1 truncate italic text-muted-foreground">Needs staff</span>
    : showLink ? link(participantWeekHref(shift.participantId, weekStartFromDateParam(shift.serviceDate)), shift.participantName) : <span className="min-w-0 flex-1 truncate">{shift.participantName}</span>

  const tint = isDraft ? TONE.warning.soft : hole ? 'bg-card' : 'bg-surface-container'
  const cut = seg.part === 'first' ? 'rounded-b-none border-b-0' : seg.part === 'second' ? 'rounded-t-none border-t-0' : ''

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={lines.join(', ')}
      title={title}
      // Both segments of an overnight shift share this attribute and open the same panel.
      data-shift-open={shift.id}
      data-segment={seg.part}
      onClick={() => onOpen(shift)}
      onKeyDown={onKeyDown}
      style={{ ...style, ...(hole ? { borderColor: DASHED } : null) }}
      className={`absolute box-border cursor-pointer overflow-hidden rounded-sm border px-1.5 pt-1 text-left text-xs leading-4 transition-[box-shadow] duration-100 ease-out ${tint} ${hole ? 'border-dashed' : 'border-border'} ${cut} hover:shadow-[inset_0_0_0_999px_color-mix(in_srgb,var(--color-foreground)_4%,transparent)] active:shadow-[inset_0_0_0_999px_color-mix(in_srgb,var(--color-foreground)_8%,transparent)] focus:outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card`}
    >
      {iconCount > 0 && (
        <span className="absolute right-1 top-1 flex gap-0.5" aria-hidden="true">
          {hasFindings && (
            <span className={isDraft ? `flex h-4 w-4 items-center justify-center rounded-full ${hasBlocking ? ON_TINT.danger : ON_TINT.warning}` : 'flex h-3 w-3'} role="img" aria-label={findingsSeverityLabel(shift.findings)}>
              {hasBlocking ? <AlertOctagon className={isDraft ? 'h-3 w-3' : 'h-3 w-3 text-destructive'} /> : <AlertTriangle className={isDraft ? 'h-3 w-3' : 'h-3 w-3 text-[var(--color-on-warning-container)]'} />}
            </span>
          )}
          {budgetMarker && <BudgetIcon className={`h-3 w-3 ${budgetInk}`} data-budget-marker={budgetMarker} />}
          {locked && <Lock className="h-3 w-3 text-muted-foreground" data-lock aria-label={lockTitle} />}
        </span>
      )}
      {/* One clipped 16px line that wraps: an item that does not fit moves whole onto the hidden second line, never clipped mid-glyph. */}
      <div className="flex h-4 flex-wrap gap-x-1 overflow-hidden" style={iconCount ? { paddingRight: iconCount * 14 } : undefined}>
        <span className={`font-medium tabular-nums ${cancelled ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{formatShiftTime(shift.startTime)}</span>
        <span className={`tabular-nums ${cancelled ? 'text-muted-foreground line-through' : 'text-foreground'}`}>–{formatShiftTime(shift.endTime)}</span>
        {cue && <span className="text-muted-foreground">{cue}</span>}
      </div>
      {showName && <div className="flex h-4 min-w-0 items-center">{nameLine}</div>}
      {showTags && (
        <div className="flex h-4 flex-wrap gap-x-1.5 overflow-hidden text-muted-foreground">
          {isDraft && <span className={`font-semibold ${TONE.warning.ink}`}>Draft</span>}
          {cancelled && <span>Cancelled</span>}
          {shift.ratio !== 'OneToOne' && <span>{RATIO_LABELS[shift.ratio] ?? shift.ratio}</span>}
          {night && <span>{night}</span>}
          {onLeave && <span className="inline-flex items-center gap-1"><CalendarOff className="h-3 w-3" aria-hidden="true" />On leave</span>}
          {shift.regularAwayReason && <span className="inline-flex items-center gap-1"><CalendarOff className="h-3 w-3" aria-hidden="true" />Regular away</span>}
        </div>
      )}
    </div>
  )
}
