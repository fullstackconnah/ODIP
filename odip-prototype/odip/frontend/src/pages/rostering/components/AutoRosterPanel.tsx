import { useEffect, useId, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CalendarX2, CheckCircle2, Loader2, X } from 'lucide-react'
import type {
  AutoRosterApplyDto, AutoRosterApplyResultDto, AutoRosterDraftDto, AutoRosterHoursDto, AutoRosterPick, AutoRosterSplitDto, AutoRosterUncoveredDto, UncoveredReason,
} from '@/api/types'
import { EMPLOYMENT_TYPE_LABELS } from '@/api/types/enums'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { DisclosureToggle } from '@/components/DisclosureToggle'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { SlideOver } from '@/components/SlideOver'
import { StatusBadge } from '@/components/StatusBadge'
import { Tabs } from '@/components/Tabs'
import { plural } from '@/lib/format'
import { extractErrorMessage } from '@/lib/utils'
import { formatShiftTime, formatShiftTimeRange } from '../lib/roster'

/** One row's text, kept for the board's skipped-rows notice: "Tue 8 Sep, 7pm–7am, Grace Palmer-Hughes". */
export type AutoRosterRowText = { shiftId: string; text: string }

export type AutoRosterPanelProps = {
  open: boolean
  onClose: () => void
  /** "7 – 13 Sep 2026", plus a sentence when a board filter is on. */
  description: string
  /** The run: pending, failed, or the draft. */
  run: { status: 'loading' } | { status: 'error'; message: string } | { status: 'draft'; draft: AutoRosterDraftDto }
  onRetryRun: () => void
  /** Sends the kept rows and splits. A rejection leaves the draft on screen. */
  onApply: (rows: AutoRosterApplyDto['rows'], splits: NonNullable<AutoRosterApplyDto['splits']>) => Promise<AutoRosterApplyResultDto>
  /** After the server answered: what it applied and skipped, with each row's display text. */
  onApplied: (result: AutoRosterApplyResultDto, rows: AutoRosterRowText[], stillOpen: number) => void
  /** True while the draft has at least one kept row: the board's leave guard reads it. */
  onArmedChange: (armed: boolean) => void
}

type Choice = { staffId: string; staffName: string; pick: AutoRosterPick; rank?: number | null }
type Edit = Choice & { was: string }

const PICK_LABEL: Record<AutoRosterPick, string> = { Regular: 'Regular', Preferred: 'Preferred', Backup: 'Backup', Emergency: 'Emergency', Allowed: 'Allowed' }
const pickLabel = (c: { pick: AutoRosterPick; rank?: number | null }) => (c.pick === 'Preferred' && c.rank ? `Preferred #${c.rank}` : PICK_LABEL[c.pick])

// "Tue 8 Sep" for a day heading; the range keeps its en dash with a word joiner so it never breaks.
const dayLabel = (iso: string) => format(parseISO(iso), 'EEE d MMM')
const range = (c: { startTime: string; endTime: string }) => formatShiftTimeRange(c.startTime, c.endTime).replace('–', '–⁠')
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
/** A shift's length in hours: an end at or before its start runs past midnight. */
const durationHours = (c: { startTime: string; endTime: string }) => ((minutes(c.endTime) - minutes(c.startTime) + 1440) % 1440 || 1440) / 60
const hours = (n: number) => String(Math.round(n * 100) / 100)
/** A split's two halves as plain shifts for one person each: the first from the start to the cut, the second from the cut to the end. */
const halvesOf = (s: AutoRosterSplitDto) => [
  { staffId: s.first.staffId, staffName: s.first.staffName, serviceDate: s.serviceDate, startTime: s.startTime, endTime: s.cutAt },
  { staffId: s.second.staffId, staffName: s.second.staffName, serviceDate: s.serviceDate, startTime: s.cutAt, endTime: s.endTime },
]
const byTime = (a: { serviceDate: string; startTime: string; participantName: string; shiftId: string }, b: typeof a) =>
  a.serviceDate.localeCompare(b.serviceDate) || a.startTime.localeCompare(b.startTime) || a.participantName.localeCompare(b.participantName) || a.shiftId.localeCompare(b.shiftId)

// shortcut: overnight rows are compared on their service date only, until a real report.
const overlaps = (a: { serviceDate: string; startTime: string; endTime: string }, b: typeof a) => a.serviceDate === b.serviceDate && a.startTime < b.endTime && b.startTime < a.endTime

const REASON: Record<UncoveredReason, (u: AutoRosterUncoveredDto) => string> = {
  ParticipantNotReady: u => `${u.participantName} isn't ready to be rostered yet.`,
  NoStaff: () => 'There’s no one in your organisation to draft from.',
  OnlyNoStaff: () => 'No one can be placed as it stands. Someone on the participant’s No list is free, and they’re never placed.',
  HoursCapReached: () => 'Everyone free would go over their hours limit.',
  NeedsOverride: () => 'Everyone free needs a reason to be placed.',
  NobodyFree: () => 'No one on the list is free at this time.',
}

/** Hours against goal as a 56 px track (the segmented ProgressBar draws a segment per goal hour, far wider than the panel); the numbers sit in the Total column. */
function GoalBar({ total, goal }: { total: number; goal: number }) {
  const label = `${hours(total)} of ${hours(goal)} h`
  return (
    <div role="progressbar" aria-label={label} title={label} aria-valuenow={Math.min(total, goal)} aria-valuemin={0} aria-valuemax={goal} className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--color-surface-container)]">
      <div className="h-full rounded-full bg-[var(--color-primary-fixed)]" style={{ width: `${Math.min(100, (total / goal) * 100)}%` }} />
    </div>
  )
}

/** Groups rows under a sticky day heading with a muted count. */
function DayGroups<T extends { serviceDate: string; shiftId: string }>({ rows, render }: { rows: T[]; render: (row: T) => React.ReactNode }) {
  const days = [...new Set(rows.map(r => r.serviceDate))]
  return (
    <>
      {days.map(day => {
        const inDay = rows.filter(r => r.serviceDate === day)
        return (
          <section key={day} aria-label={dayLabel(day)}>
            <h3 className="sticky top-0 z-10 -mx-[var(--card-pad)] flex items-baseline gap-2 bg-card px-[var(--card-pad)] py-1.5 text-sm font-semibold text-foreground">
              {dayLabel(day)}<span className="font-normal text-muted-foreground">{inDay.length}</span>
            </h3>
            <ul>{inDay.map(r => <li key={r.shiftId} className="flex min-h-14 items-start gap-2 border-b border-border py-2">{render(r)}</li>)}</ul>
          </section>
        )
      })}
    </>
  )
}

/** The draft roster: review the proposed placements, change or drop some, then apply them in one go. The draft lives only in this component. */
export function AutoRosterPanel({ open, onClose, description, run, onRetryRun, onApply, onApplied, onArmedChange }: AutoRosterPanelProps) {
  const draft = run.status === 'draft' ? run.draft : null
  const firstTab = (d: AutoRosterDraftDto | null) => (d && d.changes.length === 0 && d.splits.length === 0 && d.uncovered.length > 0 ? 'cant' : 'changes')
  const [tab, setTab] = useState(() => firstTab(draft))
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [leftOpenShown, setLeftOpenShown] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<{ busy: boolean; unconfirmed: boolean; message: string } | null>(null)
  const leftOpenId = useId()

  // A new draft starts clean, on the tab that has something to show (state adjusted during render, not in an effect).
  const [seen, setSeen] = useState(draft)
  if (seen !== draft) {
    setSeen(draft); setEdits({}); setRemoved(new Set()); setLeftOpenShown(false); setApplyError(null)
    setTab(firstTab(draft))
  }

  const rows = useMemo(
    () => (draft?.changes ?? []).map(c => ({ ...c, ...(edits[c.shiftId] ?? {}), rank: edits[c.shiftId] ? edits[c.shiftId].rank : c.rank, underGoal: edits[c.shiftId] ? false : c.underGoal, was: edits[c.shiftId]?.was })).sort(byTime),
    [draft, edits],
  )
  const kept = rows.filter(r => !removed.has(r.shiftId))
  const left = rows.filter(r => removed.has(r.shiftId))
  const splits = useMemo(() => [...(draft?.splits ?? [])].sort(byTime), [draft])
  const keptSplits = splits.filter(s => !removed.has(s.shiftId))
  const leftSplits = splits.filter(s => removed.has(s.shiftId))
  const keptCount = kept.length + keptSplits.length, leftCount = left.length + leftSplits.length
  const uncoveredCount = draft?.uncovered.length ?? 0
  useEffect(() => { onArmedChange(open && keptCount > 0) }, [open, keptCount, onArmedChange])
  useEffect(() => () => onArmedChange(false), [onArmedChange])

  const choicesFor = (row: (typeof rows)[number]): Choice[] => {
    const original = draft!.changes.find(c => c.shiftId === row.shiftId)!
    const busy = (id: string) => kept.some(k => k.shiftId !== row.shiftId && k.staffId === id && overlaps(k, row))
      || keptSplits.some(s => halvesOf(s).some(h => h.staffId === id && overlaps(h, row)))   // a split's halves count as that person's shifts
    return [{ staffId: original.staffId, staffName: original.staffName, pick: original.pick, rank: original.rank }, ...original.alternates]
      .filter(c => c.staffId !== row.staffId && !busy(c.staffId))
  }
  const change = (row: (typeof rows)[number], c: Choice) => setEdits(e => ({ ...e, [row.shiftId]: { ...c, was: edits[row.shiftId]?.was ?? row.staffName } }))
  const setGone = (id: string, gone: boolean) => setRemoved(s => { const n = new Set(s); if (gone) n.add(id); else n.delete(id); return n })

  const hoursRows = useMemo(() => {
    const added = new Map<string, number>()
    for (const r of kept) added.set(r.staffId, (added.get(r.staffId) ?? 0) + durationHours(r))
    for (const s of keptSplits) for (const h of halvesOf(s)) added.set(h.staffId, (added.get(h.staffId) ?? 0) + durationHours(h))   // each half counts its own hours
    const listed = new Set((draft?.hours ?? []).map(h => h.staffId))
    const missing: AutoRosterHoursDto[] = []   // a person on a row but not in the pool list still gets a row
    for (const r of [...rows, ...splits.flatMap(halvesOf)]) if (!listed.has(r.staffId)) { listed.add(r.staffId); missing.push({ staffId: r.staffId, staffName: r.staffName, goalHours: 0, goalIsDefault: false, rosteredHours: 0, draftHours: 0 }) }
    const load = (h: { goalHours: number; total: number }) => (h.goalHours > 0 ? h.total / h.goalHours : h.total > 0 ? Infinity : -1)
    return [...(draft?.hours ?? []), ...missing]
      .map(h => ({ ...h, draftHours: added.get(h.staffId) ?? 0, total: h.rosteredHours + (added.get(h.staffId) ?? 0) }))
      .sort((a, b) => load(b) - load(a) || a.staffName.localeCompare(b.staffName, undefined, { sensitivity: 'base' }))
  }, [draft, kept, keptSplits, rows, splits])

  const apply = async () => {
    const sent = kept.map(r => ({ shiftId: r.shiftId, staffId: r.staffId }))
    const sentSplits = keptSplits.map(s => ({ shiftId: s.shiftId, startTime: s.startTime, endTime: s.endTime, cutAt: s.cutAt, firstStaffId: s.first.staffId, secondStaffId: s.second.staffId }))
    const texts = [
      ...kept.map(r => ({ shiftId: r.shiftId, text: `${dayLabel(r.serviceDate)}, ${formatShiftTimeRange(r.startTime, r.endTime)}, ${r.staffName}` })),
      ...keptSplits.map(s => ({ shiftId: s.shiftId, text: `${dayLabel(s.serviceDate)}, ${formatShiftTimeRange(s.startTime, s.endTime)}, ${s.first.staffName} and ${s.second.staffName}` })),
    ]
    setApplying(true); setApplyError(null)
    try {
      const result = await onApply(sent, sentSplits)
      onApplied(result, texts, uncoveredCount + leftCount)
    } catch (err) {
      const response = (err as { response?: { status?: number } })?.response
      const busy = response?.status === 409
      const message = extractErrorMessage(err, 'Check your connection and try again.')
      setApplyError({ busy, unconfirmed: !response, message })   // no response: the apply may have landed, so never say nothing was saved
    } finally { setApplying(false) }
  }

  const hoursColumns: Column<(typeof hoursRows)[number]>[] = [
    { key: 'staffName', header: 'Name', mobile: 'primary', render: h => (
      <div className="max-w-[8rem]"><div className="truncate" title={h.staffName}>{h.staffName}</div>
        {h.employmentType && <div className="text-xs text-muted-foreground">{EMPLOYMENT_TYPE_LABELS[h.employmentType]}</div>}</div>) },
    { key: 'goalHours', header: 'Goal', align: 'right', mobile: 'hidden', render: h => (
      <div className="tabular-nums">{hours(h.goalHours)} h{h.goalIsDefault && <div className="text-xs text-muted-foreground">default</div>}</div>) },
    { key: 'rosteredHours', header: 'This week', align: 'right', mobile: 'meta', render: h => (<span className="tabular-nums whitespace-nowrap"><span className="sm:hidden">{hours(h.rosteredHours)} h rostered + {hours(h.draftHours)} h draft</span><span className="max-sm:hidden">{hours(h.rosteredHours)} + {hours(h.draftHours)} h</span></span>) },
    { key: 'total', header: 'Total', align: 'right', mobile: 'trail', render: h => (
      <div className="tabular-nums whitespace-nowrap">{hours(h.total)} h{h.goalHours > 0 && h.total > h.goalHours && <div className="text-xs text-warning-text">{hours(h.total - h.goalHours)} h over</div>}</div>) },
    { key: 'progress', header: '', srHeader: 'Progress', mobile: 'hidden', render: h => (h.goalHours > 0
      ? <GoalBar total={h.total} goal={h.goalHours} /> : null) },
  ]

  const rowActions = (row: (typeof rows)[number]) => {
    const choices = choicesFor(row)
    return (
      <div className="flex shrink-0 items-start gap-2 pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11">
        {choices.length > 0 && (
          <Dropdown variant="menu" triggerVariant="secondary" label="Change" align="right"
            items={choices.map(c => ({ value: c.staffId, label: c.staffName, description: pickLabel(c) }))}
            onSelect={id => change(row, choices.find(c => c.staffId === id)!)} />
        )}
        <Button iconOnly variant="ghost" aria-label={`Leave ${row.participantName} ${formatShiftTimeRange(row.startTime, row.endTime)} open`} onClick={() => setGone(row.shiftId, true)}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    )
  }

  const splitText = (s: AutoRosterSplitDto) => `${s.participantName} ${formatShiftTimeRange(s.startTime, s.endTime)}`
  const changesTab = (
    <div>
      {keptCount === 0 && leftCount === 0 && (
        uncoveredCount > 0
          ? <EmptyState size="inline" icon={CalendarX2} title="No one could be placed" description="See Can't cover for why and who to ask." />
          : <EmptyState size="inline" icon={CheckCircle2} title="No open shifts to fill" description="Every shift this week already has someone." />
      )}
      <DayGroups rows={[...kept, ...keptSplits].sort(byTime)} render={row => 'cutAt' in row ? (
        <>
          <div className="min-w-0 flex-1 text-sm">
            <p className="flex min-w-0 items-baseline gap-1">
              <span className="whitespace-nowrap tabular-nums">{range(row)}</span><span aria-hidden="true">·</span>
              <span className="truncate" title={row.participantName}>{row.participantName}</span>
            </p>
            {halvesOf(row).map(h => (
              <p key={h.staffId} className="flex min-w-0 items-baseline gap-2">
                <span className="truncate font-semibold" title={h.staffName}>{h.staffName}</span>
                <span className="whitespace-nowrap tabular-nums text-muted-foreground">{range(h)}</span>
              </p>
            ))}
            <p className="text-muted-foreground">Split at {formatShiftTime(row.cutAt)}</p>
          </div>
          <div className="flex shrink-0 items-start gap-2 pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11">
            <Button iconOnly variant="ghost" aria-label={`Leave ${splitText(row)} open`} onClick={() => setGone(row.shiftId, true)}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="min-w-0 flex-1 text-sm">
            <p className="flex min-w-0 items-baseline gap-1">
              <span className="whitespace-nowrap tabular-nums">{range(row)}</span><span aria-hidden="true">·</span>
              <span className="truncate" title={row.participantName}>{row.participantName}</span>
            </p>
            <div className="sm:flex sm:items-center sm:gap-2">
              <p className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold" title={row.staffName}>{row.staffName}</span>
                <StatusBadge size="sm" tone="neutral" label={pickLabel(row)} className="shrink-0" />
              </p>
              {/* Below sm it is its own muted line, so line 2 is the name and the badge only. */}
              {row.underGoal && <p className="whitespace-nowrap text-muted-foreground"><span className="max-sm:hidden" aria-hidden="true">· </span>under goal</p>}
            </div>
            {row.regularAway && <p className="text-muted-foreground">{row.regularAway}</p>}
            {row.warnings.map(w => <p key={w.code + w.message} className="text-muted-foreground">{w.message}</p>)}
            {row.was && <p className="text-muted-foreground">Was {row.was}</p>}
          </div>
          {rowActions(row)}
        </>
      )} />
      {leftCount > 0 && (
        <div className="mt-3">
          <DisclosureToggle label={`Left open (${leftCount})`} open={leftOpenShown} onToggle={() => setLeftOpenShown(v => !v)} controls={leftOpenId} />
          <ul id={leftOpenId} hidden={!leftOpenShown}>
            {left.map(row => (
              <li key={row.shiftId} className="flex min-h-14 items-start gap-2 border-b border-border py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-baseline gap-1"><span className="whitespace-nowrap tabular-nums">{dayLabel(row.serviceDate)}, {range(row)}</span><span aria-hidden="true">·</span><span className="truncate" title={row.participantName}>{row.participantName}</span></p>
                  <p className="text-muted-foreground">Was {row.staffName}</p>
                </div>
                <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" aria-label={`Put ${row.staffName} back on ${row.participantName} ${formatShiftTimeRange(row.startTime, row.endTime)}`} onClick={() => setGone(row.shiftId, false)}>Undo</Button>
              </li>
            ))}
            {leftSplits.map(s => (
              <li key={s.shiftId} className="flex min-h-14 items-start gap-2 border-b border-border py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-baseline gap-1"><span className="whitespace-nowrap tabular-nums">{dayLabel(s.serviceDate)}, {range(s)}</span><span aria-hidden="true">·</span><span className="truncate" title={s.participantName}>{s.participantName}</span></p>
                  <p className="text-muted-foreground">Was {s.first.staffName} and {s.second.staffName}</p>
                </div>
                <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" aria-label={`Put the split of ${splitText(s)} back`} onClick={() => setGone(s.shiftId, false)}>Undo</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )

  const cantTab = (
    <div>
      {uncoveredCount === 0 && <EmptyState size="inline" icon={CheckCircle2} title="Every open shift has someone" />}
      <DayGroups rows={[...(draft?.uncovered ?? [])].sort(byTime)} render={u => (
        <div className="min-w-0 flex-1 text-sm">
          <p className="flex min-w-0 items-baseline gap-1"><span className="whitespace-nowrap tabular-nums">{range(u)}</span><span aria-hidden="true">·</span><span className="truncate" title={u.participantName}>{u.participantName}</span></p>
          <p>{REASON[u.reason](u)}</p>
          {u.recommendations.length > 0 && (
            <ul className="mt-1 space-y-1">
              {u.recommendations.map((rec, i) => (
                <li key={i} className="text-muted-foreground">
                  {rec.kind === 'Override' && <StatusBadge size="sm" tone="warning" label="Needs a reason" className="mr-2" />}
                  {rec.text}
                  {rec.kind === 'Override' && <span className="block">Assign them on the board. You'll be asked for the reason there.</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )} />
    </div>
  )

  const body = run.status === 'loading' ? (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Drafting the week…</div>
  ) : run.status === 'error' ? (
    <Callout tone="danger" title="Couldn't draft this week" actions={<Button size="sm" variant="secondary" onClick={onRetryRun}>Try again</Button>}>{run.message}</Callout>
  ) : (
    <div className="space-y-3" inert={applying || undefined}>
      {applyError && (
        <Callout tone={applyError.busy ? 'warning' : 'danger'} title={applyError.busy ? 'Someone else is saving this week’s roster' : applyError.unconfirmed ? 'We couldn’t confirm the apply' : 'Couldn’t apply the draft'}
          actions={<Button size="sm" variant="secondary" onClick={() => void apply()}>Try again</Button>}>
          {applyError.unconfirmed ? 'Check the board before you apply again.' : `${applyError.message} ${applyError.busy ? 'Your draft is kept.' : 'Nothing was saved.'}`}
        </Callout>
      )}
      <Tabs variant="underline" ariaLabel="Draft roster" active={tab} onChange={setTab} tabs={[
        { id: 'changes', label: 'Changes', badge: keptCount || undefined, content: changesTab },
        { id: 'hours', label: 'Hours', content: <DataTable data={hoursRows} columns={hoursColumns} keyField="staffId" /> },
        { id: 'cant', label: "Can't cover", badge: uncoveredCount || undefined, content: cantTab },
      ]} />
    </div>
  )

  const applyLabel = keptCount === 0 ? 'Apply changes' : `Apply ${plural(keptCount, 'change')}`
  const footer = (
    <div className="flex justify-end gap-2 max-sm:[&>button]:flex-1">
      <Button variant="secondary" aria-disabled={applying || undefined} onClick={() => { if (!applying) onClose() }}>{draft ? 'Discard' : 'Cancel'}</Button>
      {draft && (
        <Button disabled={keptCount === 0} aria-disabled={applying || undefined} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50" onClick={() => { if (!applying) void apply() }}>
          <span className="grid">
            <span aria-hidden="true" data-reserve={applyLabel} className="invisible col-start-1 row-start-1 before:content-[attr(data-reserve)]" />
            <span className="col-start-1 row-start-1">{applying ? 'Applying…' : applyLabel}</span>
          </span>
        </Button>
      )}
    </div>
  )

  return (
    <SlideOver open={open} onClose={onClose} size="lg" title="Draft roster" description={description} footer={footer}
      dirty={Object.keys(edits).length > 0 || removed.size > 0} beforeClose={() => !applying}>
      {body}
    </SlideOver>
  )
}
