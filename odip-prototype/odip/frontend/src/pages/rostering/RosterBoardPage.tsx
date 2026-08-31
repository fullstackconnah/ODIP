import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import { CalendarClock, X } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { usePermissions } from '@/lib/permissions'
import { useRosterBoard, useAssignShift, useDeleteShift, useParticipants, useStaff, getRosterFindings } from '@/api/hooks'
import type { ShiftDto, RosterFindingDto, RosterBoardDto } from '@/api/types'
import {
  WeekToolbar, RosterGrid, RosterGridSkeleton, ShiftSlideOver, FindingsList, ExceptionsDrawer,
  type ShiftSlideOverTarget,
} from './components'
import { weekStartOf, shiftWeek, daysOfWeek } from './lib/roster'
import { useBoardViewMode } from './lib/useBoardViewMode'

type PendingAssign = { shift: ShiftDto; staffId: string | null; findings: RosterFindingDto[] }
type PendingBlocked = { shift: ShiftDto; findings: RosterFindingDto[] }

const HINT_DISMISSED_KEY = 'odip.roster.hintDismissed'

/** Every shift currently on the board, across whichever grouping is loaded — used to resolve an exception's shiftId back to a full ShiftDto. */
function allBoardShifts(board: RosterBoardDto | undefined): ShiftDto[] {
  if (!board) return []
  return board.groupBy === 'Participant'
    ? board.participantRows.flatMap(r => r.shifts)
    : [...board.unfilled, ...board.staffRows.flatMap(r => r.shifts)]
}

export default function RosterBoardPage() {
  const { canWrite } = usePermissions()
  const [weekStart, setWeekStart] = useState(() => weekStartOf(new Date()))
  const [groupBy, setGroupBy] = useBoardViewMode()
  const [participantFilter, setParticipantFilter] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [unfilledOnly, setUnfilledOnly] = useState(false)
  const [exceptionsOpen, setExceptionsOpen] = useState(false)
  const [slideOverTarget, setSlideOverTarget] = useState<ShiftSlideOverTarget | null>(null)
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<ShiftDto | null>(null)
  const [pendingAssign, setPendingAssign] = useState<PendingAssign | null>(null)
  const [pendingBlocked, setPendingBlocked] = useState<PendingBlocked | null>(null)
  const [overrideReasonDraft, setOverrideReasonDraft] = useState('')
  const [hintDismissed, setHintDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(HINT_DISMISSED_KEY) === '1'
    } catch {
      return false
    }
  })

  const { data: board, isLoading, isError, refetch } = useRosterBoard(weekStart, groupBy)
  // INTAKE-08: the board's participant filter/assignment picker excludes drafts (the board
  // query itself already excludes them server-side; this keeps the filter dropdown in sync).
  const { data: participants = [] } = useParticipants({ isDraft: 'false' })
  const { data: staff = [] } = useStaff()
  const assignShift = useAssignShift()
  const deleteShift = useDeleteShift()

  const days = board?.days ?? daysOfWeek(weekStart)

  const participantOptions = useMemo(
    () => participants.map(p => ({ value: p.id, label: p.fullName })),
    [participants],
  )
  const staffOptions = useMemo(() => staff.map(s => ({ value: s.id, label: s.fullName })), [staff])
  const regionOptions = useMemo(() => {
    const regions = new Set(staff.map(s => s.region).filter((r): r is string => !!r))
    return Array.from(regions).sort().map(r => ({ value: r, label: r }))
  }, [staff])
  const staffRegionById = useMemo(() => new Map(staff.map(s => [s.id, s.region])), [staff])

  const filteredBoard = useMemo(() => {
    if (!board) return undefined
    if (board.groupBy === 'Participant') {
      return {
        ...board,
        // Alphabetical by name, not the API's own order (which isn't guaranteed alphabetical)
        // and never by daysWithoutCover/coverage — a coordinator looking for a specific
        // participant needs to find them where they expect; the per-row coverage badge is
        // what's meant to surface gaps, not row position.
        participantRows: board.participantRows
          .filter(row => !participantFilter || row.participantId === participantFilter)
          .slice()
          .sort((a, b) => a.fullName.localeCompare(b.fullName)),
      }
    }
    const matchesParticipant = (s: ShiftDto) => !participantFilter || s.participantId === participantFilter
    return {
      ...board,
      unfilled: board.unfilled.filter(matchesParticipant),
      staffRows: board.staffRows
        .filter(row => !regionFilter || staffRegionById.get(row.staffId) === regionFilter)
        .map(row => ({ ...row, shifts: row.shifts.filter(matchesParticipant) })),
    }
  }, [board, participantFilter, regionFilter, staffRegionById])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  async function performAssign(shift: ShiftDto, staffId: string | null, overrideReason: string | null = null, acknowledgedFindingCodes: string[] = []) {
    try {
      await assignShift.mutateAsync({ id: shift.id, data: { staffId, overrideReason, acknowledgedFindingCodes } })
      setPendingAssign(null)
      setOverrideReasonDraft('')
    } catch (err: unknown) {
      const findings = getRosterFindings(err)
      if (!findings) return
      const blocking = findings.filter(f => f.severity === 'Blocking')
      if (blocking.length > 0) {
        setPendingBlocked({ shift, findings })
      } else {
        setPendingAssign({ shift, staffId, findings })
        setOverrideReasonDraft('')
      }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!canWrite) return
    const shift = event.active.data.current?.shift as ShiftDto | undefined
    const overId = event.over?.id
    if (!shift || !overId) return
    if (overId === 'unassign-target') {
      if (shift.staffId !== null) performAssign(shift, null)
      return
    }
    if (typeof overId === 'string' && overId.startsWith('staff:')) {
      const targetStaffId = overId.slice('staff:'.length)
      if (targetStaffId !== shift.staffId) performAssign(shift, targetStaffId)
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDeleteTarget) return
    await deleteShift.mutateAsync(confirmDeleteTarget.id)
    setConfirmDeleteTarget(null)
  }

  function handleAddParticipantShift(participantId: string, _participantName: string, day: string) {
    if (!canWrite) return
    setSlideOverTarget({ mode: 'create', participantId, staffId: null, serviceDate: day, focusField: 'staff' })
  }

  function handleAddStaffShift(staffId: string, day: string) {
    if (!canWrite) return
    setSlideOverTarget({ mode: 'create', staffId, serviceDate: day, focusField: 'participant' })
  }

  function dismissHint() {
    setHintDismissed(true)
    try {
      sessionStorage.setItem(HINT_DISMISSED_KEY, '1')
    } catch {
      // nothing to persist to
    }
  }

  // Computed from the raw (unfiltered) board so an active filter narrowing to zero rows doesn't
  // mistakenly surface the "nothing rostered" hint for what's actually a filter, not an empty week.
  const weekHasNoShifts = !!board && (
    board.groupBy === 'Participant'
      ? board.participantRows.every(r => r.shifts.length === 0)
      : board.staffRows.every(r => r.shifts.length === 0) && board.unfilled.length === 0
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Rostering" subtitle="Week roster board — community shifts, trip work, and leave in one view." />

      <WeekToolbar
        days={days}
        onPrevWeek={() => setWeekStart(w => shiftWeek(w, -1))}
        onThisWeek={() => setWeekStart(weekStartOf(new Date()))}
        onNextWeek={() => setWeekStart(w => shiftWeek(w, 1))}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        participantOptions={participantOptions}
        participantFilter={participantFilter}
        onParticipantFilterChange={setParticipantFilter}
        regionOptions={regionOptions}
        regionFilter={regionFilter}
        onRegionFilterChange={setRegionFilter}
        unfilledOnly={unfilledOnly}
        onUnfilledOnlyChange={setUnfilledOnly}
        exceptionsCount={board?.exceptions.length ?? 0}
        onOpenExceptions={() => setExceptionsOpen(true)}
        canWrite={canWrite}
        onNewShift={() => setSlideOverTarget({ mode: 'create', serviceDate: weekStart })}
      />

      {isLoading && <RosterGridSkeleton days={days} />}

      {isError && (
        <EmptyState
          icon={CalendarClock}
          title="Couldn't load the roster board"
          description="Something went wrong fetching this week. Try again."
          action={{ label: 'Retry', onClick: () => refetch() }}
        />
      )}

      {/* The grid always renders, even for a week with zero shifts — that empty grid is the
          add-a-shift affordance. Guidance for a first-time/empty week is this dismissible hint
          above the grid, never a replacement for it. */}
      {!isLoading && !isError && filteredBoard && weekHasNoShifts && !hintDismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-container-low px-4 py-3">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Nothing rostered this week</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {canWrite ? (
                <>
                  Click an empty cell below to add a shift, or{' '}
                  <Link to="/rostering/patterns" className="font-medium text-primary hover:underline">
                    set up a recurring pattern
                  </Link>{' '}
                  for a participant's regular shifts.
                </>
              ) : (
                'No shifts are rostered for this week yet.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={dismissHint}
            aria-label="Dismiss hint"
            className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!isLoading && !isError && filteredBoard && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <RosterGrid
            board={filteredBoard}
            canWrite={canWrite}
            unfilledOnly={unfilledOnly}
            weekHasNoShifts={weekHasNoShifts}
            onOpenShift={shift => setSlideOverTarget({ mode: 'edit', shift })}
            onAssignTo={shift => setSlideOverTarget({ mode: 'edit', shift })}
            onUnassign={shift => performAssign(shift, null)}
            onDeleteShift={shift => setConfirmDeleteTarget(shift)}
            onAddParticipantShift={handleAddParticipantShift}
            onAddStaffShift={handleAddStaffShift}
          />
        </DndContext>
      )}

      <ShiftSlideOver
        key={slideOverTarget ? (slideOverTarget.mode === 'edit' ? `shift-${slideOverTarget.shift.id}` : 'shift-new') : 'shift-closed'}
        target={slideOverTarget}
        onClose={() => setSlideOverTarget(null)}
        canWrite={canWrite}
        participantOptions={participantOptions}
        staffOptions={staffOptions}
        groupBy={groupBy}
      />

      <ExceptionsDrawer
        open={exceptionsOpen}
        onClose={() => setExceptionsOpen(false)}
        exceptions={board?.exceptions ?? []}
        onJumpToShift={shiftId => {
          const shift = allBoardShifts(board).find(s => s.id === shiftId)
          setExceptionsOpen(false)
          if (shift) setSlideOverTarget({ mode: 'edit', shift })
        }}
      />

      <ConfirmDialog
        open={confirmDeleteTarget !== null}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteTarget(null)}
        title="Delete shift"
        message="This permanently removes the shift from the roster. This can't be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteShift.isPending}
      />

      <ConfirmDialog
        open={pendingBlocked !== null}
        onCancel={() => setPendingBlocked(null)}
        title="Can't assign this shift"
        message={pendingBlocked && (
          <>
            <p>This assignment was blocked by a rostering rule that can't be overridden.</p>
            <FindingsList findings={pendingBlocked.findings} className="mt-3" />
          </>
        )}
        footer={
          <button
            type="button"
            onClick={() => setPendingBlocked(null)}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90"
          >
            Got it
          </button>
        }
      />

      <ConfirmDialog
        open={pendingAssign !== null}
        onCancel={() => { setPendingAssign(null); setOverrideReasonDraft('') }}
        title="Assign with warnings"
        message={pendingAssign && (
          <>
            <p>This assignment raises the following. Give a reason to assign anyway.</p>
            <FindingsList findings={pendingAssign.findings} className="mt-3" />
            <textarea
              rows={2}
              value={overrideReasonDraft}
              onChange={e => setOverrideReasonDraft(e.target.value)}
              placeholder="Reason for overriding these warnings"
              className="mt-3 w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </>
        )}
        footer={
          <>
            <button
              type="button"
              onClick={() => { setPendingAssign(null); setOverrideReasonDraft('') }}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!overrideReasonDraft.trim() || assignShift.isPending}
              onClick={() => pendingAssign && performAssign(pendingAssign.shift, pendingAssign.staffId, overrideReasonDraft.trim(), pendingAssign.findings.map(f => f.code))}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {assignShift.isPending ? 'Assigning…' : 'Assign anyway'}
            </button>
          </>
        }
      />
    </div>
  )
}
