import { useMemo, useState } from 'react'
import { CalendarClock, Pencil, Plus, Power, Repeat, X } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'
import { useUiPreferences } from '@/hooks/useUiPreferences'
import { usePatterns, useUpdatePattern, useParticipants, useStaff } from '@/api/hooks'
import type { ShiftPatternDto, CreateShiftPatternDto } from '@/api/types'
import { PatternSlideOver, GeneratePatternDialog, type PatternSlideOverTarget } from './components'
import { formatShiftRange, formatEffectiveRange, RATIO_LABELS, NIGHT_TYPE_LABELS, DAY_OF_WEEK_INDEX } from './lib/roster'

/** The write fields off a loaded pattern, for round-tripping through update without re-typing every field. */
function toPayload(p: ShiftPatternDto): CreateShiftPatternDto {
  return {
    participantId: p.participantId,
    defaultStaffId: p.defaultStaffId,
    dayOfWeek: p.dayOfWeek,
    startTime: p.startTime,
    endTime: p.endTime,
    endsNextDay: p.endsNextDay,
    ratio: p.ratio,
    nightType: p.nightType,
    effectiveFrom: p.effectiveFrom,
    effectiveTo: p.effectiveTo,
    isActive: p.isActive,
    notes: p.notes,
  }
}

function PatternRowActions({
  pattern, onEdit, onGenerate, onToggleActive,
}: {
  pattern: ShiftPatternDto
  onEdit: () => void
  onGenerate: () => void
  onToggleActive: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={onEdit}
        title="Edit pattern"
        aria-label={`Edit ${pattern.participantName}'s ${pattern.dayOfWeek} pattern`}
        className="rounded-lg p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onGenerate}
        disabled={!pattern.isActive}
        title={pattern.isActive ? 'Generate shifts' : 'Inactive patterns generate nothing'}
        aria-label={`Generate shifts for ${pattern.participantName}'s ${pattern.dayOfWeek} pattern`}
        className="rounded-lg p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 disabled:pointer-events-none"
      >
        <Repeat className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onToggleActive}
        title={pattern.isActive ? 'Deactivate pattern' : 'Activate pattern'}
        aria-label={`${pattern.isActive ? 'Deactivate' : 'Activate'} ${pattern.participantName}'s ${pattern.dayOfWeek} pattern`}
        className="rounded-lg p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Power className="h-4 w-4" />
      </button>
    </div>
  )
}

/** Loading state — a skeleton matching the final table's shape, no spinner. */
function PatternsSkeleton() {
  const { prefs } = useUiPreferences()
  const dividerClass = prefs.tableVerticalDividers ? 'divide-x divide-[var(--color-border)]' : ''
  const headers = ['Participant', 'Day', 'Time', 'Ratio', 'Night type', 'Default staff', 'Effective range', 'Status', '']
  const widths = ['w-28', 'w-16', 'w-20', 'w-10', 'w-16', 'w-24', 'w-32', 'w-14', 'w-8']
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border bg-card" aria-hidden="true">
      <table className="w-full text-sm">
        <thead className="bg-accent">
          <tr className={dividerClass}>
            {headers.map(h => (
              <th key={h} className="p-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {Array.from({ length: 6 }, (_, rowIdx) => (
            <tr key={rowIdx} className={dividerClass}>
              {widths.map((w, colIdx) => (
                <td key={colIdx} className="p-3">
                  <div className={`h-3.5 ${w} animate-pulse rounded-sm bg-muted`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PatternsPage() {
  const { canWrite } = usePermissions()
  const { data: patterns = [], isLoading, isError, refetch } = usePatterns()
  // INTAKE-08: the shift pattern participant picker excludes drafts.
  const { data: participants = [] } = useParticipants({ isDraft: 'false' })
  const { data: staff = [] } = useStaff()
  const updatePattern = useUpdatePattern()

  const [slideOverTarget, setSlideOverTarget] = useState<PatternSlideOverTarget | null>(null)
  const [generateTarget, setGenerateTarget] = useState<ShiftPatternDto | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<ShiftPatternDto | null>(null)
  // The server's refusal of an activate / deactivate (e.g. Enforce mode's 400 "Participant is not ready for booking or rostering.").
  // Both used to fail silently: the activate had no error handler and the deactivate was an unhandled rejection.
  const [toggleError, setToggleError] = useState<string | null>(null)

  const participantOptions = useMemo(() => participants.map(p => ({ value: p.id, label: p.fullName })), [participants])
  const staffOptions = useMemo(() => staff.map(s => ({ value: s.id, label: s.fullName })), [staff])

  function handleToggleActive(pattern: ShiftPatternDto) {
    setToggleError(null)
    if (pattern.isActive) {
      setDeactivateTarget(pattern)
    } else {
      updatePattern.mutate(
        { id: pattern.id, data: { ...toPayload(pattern), isActive: true } },
        { onError: (err: unknown) => setToggleError(extractErrorMessage(err, 'Something went wrong activating this pattern. Please try again.')) },
      )
    }
  }

  async function handleConfirmDeactivate() {
    if (!deactivateTarget) return
    setToggleError(null)
    try {
      await updatePattern.mutateAsync({ id: deactivateTarget.id, data: { ...toPayload(deactivateTarget), isActive: false } })
    } catch (err: unknown) {
      setToggleError(extractErrorMessage(err, 'Something went wrong deactivating this pattern. Please try again.'))
    }
    // Closed either way: on a failure the banner is what the user needs to see, and the dialog's overlay would cover it.
    setDeactivateTarget(null)
  }

  const columns: Column<ShiftPatternDto>[] = [
    { key: 'participantName', header: 'Participant', sortable: true, className: 'font-medium' },
    {
      key: 'dayOfWeek',
      header: 'Day',
      sortable: true,
      sortFn: (a, b) => DAY_OF_WEEK_INDEX[a.dayOfWeek] - DAY_OF_WEEK_INDEX[b.dayOfWeek],
    },
    { key: 'time', header: 'Time', render: p => formatShiftRange(p.startTime, p.endTime, p.endsNextDay) },
    { key: 'ratio', header: 'Ratio', render: p => RATIO_LABELS[p.ratio] ?? p.ratio },
    { key: 'nightType', header: 'Night type', render: p => NIGHT_TYPE_LABELS[p.nightType] ?? p.nightType },
    { key: 'defaultStaffName', header: 'Default staff', render: p => p.defaultStaffName ?? 'Unfilled' },
    { key: 'effectiveRange', header: 'Effective range', render: p => formatEffectiveRange(p.effectiveFrom, p.effectiveTo) },
    { key: 'isActive', header: 'Status', render: p => <StatusBadge status={p.isActive ? 'Active' : 'Inactive'} /> },
  ]

  if (canWrite) {
    columns.push({
      key: 'actions',
      header: '',
      render: p => (
        <PatternRowActions
          pattern={p}
          onEdit={() => setSlideOverTarget({ mode: 'edit', pattern: p })}
          onGenerate={() => setGenerateTarget(p)}
          onToggleActive={() => handleToggleActive(p)}
        />
      ),
    })
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Shift patterns"
        subtitle="Weekly recurring shifts that generate real shifts onto the roster."
        action={canWrite && (
          <Button onClick={() => setSlideOverTarget({ mode: 'create' })} size="md">
            <Plus className="h-4 w-4" /> New pattern
          </Button>
        )}
      />

      {toggleError && (
        <Callout
          tone="error"
          actions={
            <Button variant="ghost" size="sm" iconOnly onClick={() => setToggleError(null)} aria-label="Dismiss error">
              <X className="h-4 w-4" />
            </Button>
          }
        >
          {toggleError}
        </Callout>
      )}

      {isLoading && <PatternsSkeleton />}

      {!isLoading && isError && (
        <EmptyState
          icon={CalendarClock}
          title="Couldn't load shift patterns"
          description="Something went wrong fetching patterns. Try again."
          action={{ label: 'Retry', onClick: () => refetch() }}
        />
      )}

      {!isLoading && !isError && patterns.length === 0 && (
        <EmptyState
          icon={Repeat}
          title="No recurring patterns yet"
          description="A pattern generates a participant's regular shifts automatically, week after week, instead of you adding them to the board one at a time."
          action={canWrite ? { label: 'Set up a pattern', onClick: () => setSlideOverTarget({ mode: 'create' }) } : undefined}
        />
      )}

      {!isLoading && !isError && patterns.length > 0 && (
        <DataTable
          data={patterns}
          columns={columns}
          keyField="id"
          sortable
          defaultSort={{ key: 'participantName', direction: 'asc' }}
          emptyMessage="No shift patterns found"
        />
      )}

      <PatternSlideOver
        key={slideOverTarget ? (slideOverTarget.mode === 'edit' ? `pattern-${slideOverTarget.pattern.id}` : 'pattern-new') : 'pattern-closed'}
        target={slideOverTarget}
        onClose={() => setSlideOverTarget(null)}
        canWrite={canWrite}
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />

      <GeneratePatternDialog
        key={generateTarget ? `generate-${generateTarget.id}` : 'generate-closed'}
        pattern={generateTarget}
        onClose={() => setGenerateTarget(null)}
      />

      <ConfirmDialog
        open={deactivateTarget !== null}
        onConfirm={handleConfirmDeactivate}
        onCancel={() => setDeactivateTarget(null)}
        title="Deactivate pattern"
        message={
          <>
            <p>This stops the pattern from generating any further shifts.</p>
            <p>It does not remove shifts already generated — those stay on the roster exactly as they are.</p>
          </>
        }
        confirmLabel="Deactivate"
        variant="danger"
        loading={updatePattern.isPending}
      />
    </div>
  )
}
