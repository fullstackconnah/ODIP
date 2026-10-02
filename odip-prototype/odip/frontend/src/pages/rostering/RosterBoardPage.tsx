import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import { CalendarClock, X } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'
import { useRosterBoard, useAssignShift, useDeleteShift, useParticipants, useStaff, getRosterFindings } from '@/api/hooks'
import type { ShiftDto, RosterFindingDto, RosterBoardDto } from '@/api/types'
import {
  WeekToolbar, RosterGrid, RosterGridSkeleton, ShiftSlideOver, FindingsList, ExceptionsDrawer,
  type ShiftSlideOverTarget,
} from './components'
import { weekStartOf, weekStartFromDateParam, shiftWeek, daysOfWeek } from './lib/roster'
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
  // `?date=` (the server's "Re-cover shift" task link) opens the week that contains it, and a later change of it moves the board there; the toolbar owns the week in between.
  const [searchParams] = useSearchParams()
  const dateParam = searchParams.get('date')
  const [weekStart, setWeekStart] = useState(() => weekStartFromDateParam(dateParam))
  useEffect(() => {
    if (dateParam !== null) setWeekStart(weekStartFromDateParam(dateParam))
  }, [dateParam])
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
  // The server's refusal of an assign / unassign that is NOT the 422 findings protocol (e.g. Enforce mode's 400 "Participant is not ready
  // for booking or rostering."). It used to be swallowed, leaving a drag that silently snapped back.
  const [assignError, setAssignError] = useState<string | null>(null)
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
  // What is still missing per participant, for the slide-over's quiet warning line. Every listed participant gets an entry (an empty
  // list is "ready"), so a fresh list wins over a shift's older snapshot of the same participant.
  const participantReadiness = useMemo(
    () => Object.fromEntries(participants.map(p => [p.id, p.readinessIssues ?? []])) as Record<string, string[]>,
    [participants],
  )
  const staffOptions = useMemo(() => staff.map(s => ({ value: s.id, label: s.fullName })), [staff])
  const regionOptions = useMemo(() => {
    const regions = new Set(staff.map(s => s.region).filter((r): r is string => !!r))
    return Array.from(regions).sort().map(r => ({ value: r, label: r }))
  }, [staff])
  const staffRegionById = useMemo(() => new Map(staff.map(s => [s.id, s.region])), [staff])

  // The board's own server-computed `exceptions` now include an ASSIGNEE_ON_LEAVE entry for
  // every shift whose assignee's leave was approved after the assignment (RosteringController.
  // GetBoard) — no client-side synthesis needed here any more.
  const combinedExceptions = board?.exceptions ?? []

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
    setAssignError(null)
    try {
      await assignShift.mutateAsync({ id: shift.id, data: { staffId, overrideReason, acknowledgedFindingCodes } })
      setPendingAssign(null)
      setOverrideReasonDraft('')
    } catch (err: unknown) {
      const findings = getRosterFindings(err)
      if (!findings) {
        // Say what the server said. The "Assign anyway" dialog (the other way in here) closes first: its modal overlay would
        // otherwise cover the banner, and a retry from it cannot fix a refusal that is not about findings.
        setPendingAssign(null)
        setOverrideReasonDraft('')
        setAssignError(extractErrorMessage(err, 'Something went wrong assigning this shift. Please try again.'))
        return
      }
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
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {/* PageHeader is a fragment, so title row and toolbar sit in one tight block here (title 28px + 8px + toolbar 32px)
          instead of being spaced apart by the page's --section-gap. */}
      <div className="flex flex-col gap-2">
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
          exceptionsCount={combinedExceptions.length}
          onOpenExceptions={() => setExceptionsOpen(true)}
          canWrite={canWrite}
          onNewShift={() => setSlideOverTarget({ mode: 'create', serviceDate: weekStart })}
        />
      </div>

      {assignError && (
        <Callout
          tone="error"
          actions={
            <Button variant="ghost" size="sm" iconOnly onClick={() => setAssignError(null)} aria-label="Dismiss error">
              <X className="h-4 w-4" />
            </Button>
          }
        >
          {assignError}
        </Callout>
      )}

      {isLoading && <RosterGridSkeleton days={days} />}

      {isError && (
        // Retry is a real <Button size="md"> under the EmptyState, not EmptyState's own `action` slot, which
        // draws a hand-rolled min-h-[44px] text button that ignores the density tokens (44px on a mouse).
        // gap-5 + pb-10 reproduce the slot's spacing (gap-3 + mt-2 above it, py-10 around it), hence pb-0!.
        <div className="flex flex-col items-center gap-5 pb-10">
          <EmptyState
            icon={CalendarClock}
            title="Couldn't load the roster board"
            description="Something went wrong fetching this week. Try again."
            className="pb-0!"
          />
          <Button variant="secondary" size="md" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* The grid always renders, even for a week with zero shifts — that empty grid is the
          add-a-shift affordance. Guidance for a first-time/empty week is this dismissible hint
          above the grid, never a replacement for it. */}
      {!isLoading && !isError && filteredBoard && weekHasNoShifts && !hintDismissed && (
        <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface-container-low p-[var(--card-pad)]">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Nothing rostered this week</p>
            <p className="text-sm text-muted-foreground">
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
          <Button variant="ghost" size="sm" iconOnly onClick={dismissHint} aria-label="Dismiss hint" className="shrink-0">
            <X className="h-4 w-4" />
          </Button>
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
        participantReadiness={participantReadiness}
      />

      <ExceptionsDrawer
        open={exceptionsOpen}
        onClose={() => setExceptionsOpen(false)}
        exceptions={combinedExceptions}
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
          <Button onClick={() => setPendingBlocked(null)}>
            Got it
          </Button>
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
              className="mt-3 w-full rounded-[var(--radius-sm)] bg-input border border-border px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </>
        )}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setPendingAssign(null); setOverrideReasonDraft('') }}>
              Cancel
            </Button>
            <Button
              disabled={!overrideReasonDraft.trim() || assignShift.isPending}
              onClick={() => pendingAssign && performAssign(pendingAssign.shift, pendingAssign.staffId, overrideReasonDraft.trim(), pendingAssign.findings.map(f => f.code))}
            >
              {assignShift.isPending ? 'Assigning…' : 'Assign anyway'}
            </Button>
          </>
        }
      />
    </div>
  )
}
