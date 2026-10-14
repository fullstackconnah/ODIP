import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent, type Modifier,
} from '@dnd-kit/core'
import { CalendarClock, X } from 'lucide-react'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'
import { plural } from '@/lib/format'
import { useRosterBoard, useAssignShift, useMoveStaff, usePublishWeek, useDeleteShift, useParticipants, useStaff, getRosterFindings } from '@/api/hooks'
import { CAN_RECEIVE_SERVICES } from '@/api/types/participants'
import type { ShiftDto, RosterFindingDto, RosterBoardDto, MoveStaffMode } from '@/api/types'
import {
  WeekToolbar, RosterGrid, RosterGridSkeleton, ShiftSlideOver, FindingsList, ExceptionsDrawer, StaffStrip, CarriedPuck,
  type ShiftSlideOverTarget,
} from './components'
import { weekStartOf, weekStartFromDateParam, shiftWeek, daysOfWeek, isUnfilledShift, formatWeekSpan } from './lib/roster'
import { useBoardViewMode } from './lib/useBoardViewMode'
import {
  DropStateContext, ROSTER_SCREEN_READER_INSTRUCTIONS, assignedSentence, dropOutcome, movedSentence, publishWeekMessage, publishedSentence, replacePromptLines, rosterAnnouncements,
  rosterCollision, staffWeekHours, swappedSentence, type DragCarry, type DropTarget, type PendingDrop,
} from './lib/rosterDrag'

/** One roster write, given the reason and the codes a warnings dialog collected (none the first time). */
type Send = (overrideReason: string | null, acknowledgedFindingCodes: string[]) => Promise<unknown>
type PendingAssign = { findings: RosterFindingDto[]; retry: (overrideReason: string, codes: string[]) => Promise<boolean> }
type PendingBlocked = { findings: RosterFindingDto[] }
type DropPrompt = { carry: DragCarry; shift: ShiftDto; canSwap: boolean }

/** The carried puck rides one coarse row (48px, --row-h under pointer: coarse) above a finger, so its outcome line is not under the thumb. A mouse or keyboard drag is left alone. */
const liftAboveFinger: Modifier = ({ transform, activatorEvent }) => (activatorEvent?.type === 'touchstart' ? { ...transform, y: transform.y - 48 } : transform)

/** Focus on a shift's open control (ShiftChip's data-shift-open): the thing a keyboard drop changed. */
function focusShift(id: string) {
  document.querySelector<HTMLElement>(`[data-shift-open="${id}"]`)?.focus()
}

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
  // React's "adjust state when a prop changes" pattern: compare the param during render, no effect. A missing param never resets the week.
  const [seenDateParam, setSeenDateParam] = useState(dateParam)
  if (seenDateParam !== dateParam) {
    setSeenDateParam(dateParam)
    if (dateParam !== null) setWeekStart(weekStartFromDateParam(dateParam))
  }
  const [groupBy, setGroupBy] = useBoardViewMode()
  // `?participant=<id>` and `?unfilled=1` (plan builder phase D: the links an approval and its confirm dialog give) open the board already filtered to that participant, and to open shifts, through the same
  // local filters the toolbar owns. Read like `date`: they open the filter, a later change of the address moves it, and a missing one never resets what the toolbar chose in between.
  const participantParam = searchParams.get('participant')
  const unfilledParam = searchParams.get('unfilled')
  const [participantFilter, setParticipantFilter] = useState(participantParam ?? '')
  const [regionFilter, setRegionFilter] = useState('')
  const [unfilledOnly, setUnfilledOnly] = useState(unfilledParam === '1')
  const [seenFilterParams, setSeenFilterParams] = useState({ participantParam, unfilledParam })
  if (seenFilterParams.participantParam !== participantParam || seenFilterParams.unfilledParam !== unfilledParam) {
    setSeenFilterParams({ participantParam, unfilledParam })
    if (participantParam !== null) setParticipantFilter(participantParam)
    if (unfilledParam !== null) setUnfilledOnly(unfilledParam === '1')
  }
  const [exceptionsOpen, setExceptionsOpen] = useState(false)
  const [slideOverTarget, setSlideOverTarget] = useState<ShiftSlideOverTarget | null>(null)
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<ShiftDto | null>(null)
  const [pendingAssign, setPendingAssign] = useState<PendingAssign | null>(null)
  const [pendingBlocked, setPendingBlocked] = useState<PendingBlocked | null>(null)
  const [overrideReasonDraft, setOverrideReasonDraft] = useState('')
  // The server's refusal of an assign / unassign that is NOT the 422 findings protocol (e.g. Enforce mode's 400 "Participant is not ready
  // for booking or rostering."). It used to be swallowed, leaving a drag that silently snapped back.
  const [assignError, setAssignError] = useState<string | null>(null)
  const [carry, setCarry] = useState<DragCarry | null>(null)
  const [dropPending, setDropPending] = useState<PendingDrop | null>(null)
  const [prompt, setPrompt] = useState<DropPrompt | null>(null)
  // Decision 6: a person carried off a puck onto an empty day MOVES. Their old shift waits here until the new one saves; the panel's Cancel forgets it.
  const [createMoveSource, setCreateMoveSource] = useState<ShiftDto | null>(null)
  const [announcement, setAnnouncement] = useState('')
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
  const { data: participants = [] } = useParticipants(CAN_RECEIVE_SERVICES)
  const { data: staff = [], isLoading: staffLoading } = useStaff()
  const assignShift = useAssignShift()
  const moveStaff = useMoveStaff()
  const belowMd = useIsBelowMd()
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
          // "Unfilled only" on this board keeps every row (the grid is always whole) and draws only the shifts nobody is assigned to.
          .map(row => unfilledOnly ? { ...row, shifts: row.shifts.filter(isUnfilledShift) } : row)
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
  }, [board, participantFilter, regionFilter, staffRegionById, unfilledOnly])

  // Decisions 1 and 10: drag and drop is the Participant view's, for writers, from md up; the Staff view and phones keep click and the menus.
  const dragOn = canWrite && groupBy === 'participant' && !belowMd
  const boardShifts = useMemo(() => allBoardShifts(board), [board])
  const hours = useMemo(() => staffWeekHours(boardShifts), [boardShifts])
  const publishWeek = usePublishWeek()
  const [publishOpen, setPublishOpen] = useState(false)
  // Counted from the raw board, all participants (the brief, section 8); the server publishes the same week for every participant the board shows.
  const drafts = useMemo(() => boardShifts.filter(s => s.status === 'Draft'), [boardShifts])

  async function handlePublishWeek() {
    try {
      setAnnouncement(publishedSentence(await publishWeek.mutateAsync(weekStart)))
    } catch (err: unknown) {
      setAssignError(extractErrorMessage(err, 'Something went wrong publishing this week. Please try again.'))
    } finally {
      setPublishOpen(false)
    }
  }
  const dragsOff = dropPending !== null || prompt !== null || pendingAssign !== null || pendingBlocked !== null

  // A mouse lifts after a 4px move. A finger lifts a strip puck after a 200 ms press, so a swipe still scrolls the strip; a grip (touch-none, a person off a puck) lifts at once.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
      bypassActivationConstraint: ({ activeNode }) => Boolean((activeNode.data.current as DragCarry | undefined)?.fromShift),
    }),
    useSensor(KeyboardSensor),
  )

  /**
   * One roster write and today's answers to it: a 422 with a Blocking finding opens "Can't assign"; warnings open "Assign with warnings", whose "Assign anyway" re-sends this SAME
   * request with the reason and the codes; any other refusal is the error Callout, in the server's words. True when the write went through.
   */
  async function runRosterWrite(send: Send, overrideReason: string | null = null, codes: string[] = []): Promise<boolean> {
    setAssignError(null)
    try {
      await send(overrideReason, codes)
      setPendingAssign(null)
      setOverrideReasonDraft('')
      return true
    } catch (err: unknown) {
      const findings = getRosterFindings(err)
      if (!findings) {
        // Say what the server said. The "Assign anyway" dialog (the other way in here) closes first: its modal overlay would
        // otherwise cover the banner, and a retry from it cannot fix a refusal that is not about findings.
        setPendingAssign(null)
        setOverrideReasonDraft('')
        setAssignError(extractErrorMessage(err, 'Something went wrong assigning this shift. Please try again.'))
        return false
      }
      if (findings.some(f => f.severity === 'Blocking')) {
        setPendingBlocked({ findings })
      } else {
        setPendingAssign({ findings, retry: (reason, retryCodes) => runRosterWrite(send, reason, retryCodes) })
        setOverrideReasonDraft('')
      }
      return false
    }
  }

  function performAssign(shift: ShiftDto, staffId: string | null) {
    return runRosterWrite((overrideReason, acknowledgedFindingCodes) =>
      assignShift.mutateAsync({ id: shift.id, data: { staffId, overrideReason, acknowledgedFindingCodes } }))
  }

  /** A drop's write: the pending look on its shifts while it is out (every drag waits), and the sentence a screen reader hears once it lands, a retry included. */
  async function dropWrite(pending: PendingDrop, sentence: string, send: Send) {
    setDropPending(pending)
    await runRosterWrite(async (reason, codes) => { await send(reason, codes); setAnnouncement(sentence) })
    setDropPending(null)
  }

  function dropAssign(person: DragCarry, shift: ShiftDto) {
    return dropWrite({ targetId: shift.id, staffName: person.staffName }, assignedSentence(person, shift), (overrideReason, acknowledgedFindingCodes) =>
      // expectedStaffId: who the board showed (nobody, an on-leave worker, or the person the prompt replaces); the server refuses with 409 if that changed since.
      assignShift.mutateAsync({ id: shift.id, data: { staffId: person.staffId, overrideReason, acknowledgedFindingCodes, expectedStaffId: shift.staffId ?? null } }))
  }

  /** A person carried off a puck: one all-or-nothing request, so a refused second half leaves both shifts as they were. */
  function dropMove(person: DragCarry, from: ShiftDto, to: ShiftDto, mode: MoveStaffMode) {
    const sentence = mode === 'Swap' ? swappedSentence(person, to) : movedSentence(person, to)
    return dropWrite({ targetId: to.id, sourceId: from.id, staffName: person.staffName }, sentence, (overrideReason, acknowledgedFindingCodes) =>
      // expectedToStaffId: who the board showed on the target; for Replace and Swap the server refuses with 409 if that changed since.
      moveStaff.mutateAsync({ fromShiftId: from.id, toShiftId: to.id, mode, staffId: person.staffId, expectedToStaffId: to.staffId ?? null, overrideReason, acknowledgedFindingCodes }))
  }

  function handleDragStart(event: DragStartEvent) {
    setCarry(event.active.data.current as DragCarry)
  }

  function handleDragEnd(event: DragEndEvent) {
    setCarry(null)
    const person = event.active.data.current as DragCarry | undefined
    if (!person) return
    const outcome = dropOutcome(person, event.over?.data.current as DropTarget | undefined)
    // A keyboard drop that lands, or opens a dialog, leaves focus on the shift it changed (the dialog hands focus back to it). dnd-kit's own focus return is off, so
    // a cancel, or a drop on nothing, simply leaves focus where the drag began.
    if (event.activatorEvent instanceof KeyboardEvent && (outcome.kind === 'assign' || outcome.kind === 'move' || outcome.kind === 'prompt')) focusShift(outcome.shift.id)
    if (outcome.kind === 'assign') void dropAssign(person, outcome.shift)
    else if (outcome.kind === 'move') void dropMove(person, outcome.from, outcome.shift, outcome.mode)
    else if (outcome.kind === 'prompt') setPrompt({ carry: person, shift: outcome.shift, canSwap: outcome.canSwap })
    else if (outcome.kind === 'create') {
      setCreateMoveSource(person.fromShift ?? null)
      setSlideOverTarget({ mode: 'create', participantId: outcome.participantId, staffId: person.staffId, serviceDate: outcome.day, focusField: 'start', moveFromShiftId: person.fromShift?.id })
    }
  }

  function choosePrompt(choice: 'Replace' | 'Swap') {
    if (!prompt) return
    const { carry: person, shift } = prompt
    setPrompt(null)
    // From the strip, Replace is an assign (the shift's worker comes off); off a puck it is one move-staff request.
    if (person.fromShift) void dropMove(person, person.fromShift, shift, choice)
    else void dropAssign(person, shift)
  }

  // Decision 6: a person carried off a puck onto an empty day moves. The panel saves the new shift and clears the old one in one guarded request (deep review S6).
  // shortcut: the panel's live check still counts the shift they leave, so a same-day overlap can show a DOUBLE_BOOKED warning before Save; the save itself is judged without it.
  function handleShiftSaved(saved: ShiftDto) {
    const source = createMoveSource
    // Only when the new shift is the carried person's: if the Staff field was changed in the panel, they have not moved, so their old shift stays as it is.
    if (!source || saved.staffId !== source.staffId) return
    setAnnouncement(movedSentence({ staffId: saved.staffId ?? '', staffName: saved.staffName ?? '', fromShift: source }, saved))
    // The grip that started it went with the old shift, so focus goes to the new one, once the refetch has drawn it.
    requestAnimationFrame(() => focusShift(saved.id))
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

  const grid = filteredBoard && (
    <RosterGrid
      board={filteredBoard}
      canWrite={canWrite}
      draggable={dragOn}
      unfilledOnly={unfilledOnly}
      weekHasNoShifts={weekHasNoShifts}
      onOpenShift={shift => setSlideOverTarget({ mode: 'edit', shift })}
      onAssignTo={shift => setSlideOverTarget({ mode: 'edit', shift })}
      onUnassign={shift => performAssign(shift, null)}
      onDeleteShift={shift => setConfirmDeleteTarget(shift)}
      onAddParticipantShift={handleAddParticipantShift}
      onAddStaffShift={handleAddStaffShift}
    />
  )

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <AnnouncementRegion message={announcement} />
      {/* PageHeader is a fragment, so title row and toolbar sit in one tight block here (title 28px + 8px + toolbar 32px)
          instead of being spaced apart by the page's --section-gap. */}
      <div className="flex flex-col gap-2">
        <PageHeader title="Roster board" />

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
          draftCount={board && !weekHasNoShifts ? drafts.length : null}
          onPublishWeek={() => setPublishOpen(true)}
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

      {!isLoading && !isError && grid && (dragOn ? (
        <DropStateContext.Provider value={{ disabled: dragsOff, pending: dropPending }}>
          <DndContext
            sensors={sensors}
            collisionDetection={rosterCollision}
            accessibility={{ announcements: rosterAnnouncements, screenReaderInstructions: ROSTER_SCREEN_READER_INSTRUCTIONS, restoreFocus: false }}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setCarry(null)}
          >
            <StaffStrip staff={staff} isLoading={staffLoading} hours={hours} regionOptions={regionOptions} regionFilter={regionFilter} onRegionFilterChange={setRegionFilter} />
            {grid}
            {/* A portal (the brief, section 5), so no ancestor's overflow or transform clips or shifts it. No drop animation: the default flies the puck back to its source, which reads as a refusal.
                pointer-events-none: rosterCollision asks what is on top at the pointer, and that must never be the carried puck itself. */}
            {createPortal(
              <DragOverlay className="pointer-events-none" dropAnimation={null} modifiers={[liftAboveFinger]}>
                {carry && <CarriedPuck carry={carry} hours={hours.get(carry.staffId) ?? 0} />}
              </DragOverlay>,
              document.body,
            )}
          </DndContext>
        </DropStateContext.Provider>
      ) : grid)}

      <ShiftSlideOver
        key={slideOverTarget ? (slideOverTarget.mode === 'edit' ? `shift-${slideOverTarget.shift.id}` : 'shift-new') : 'shift-closed'}
        target={slideOverTarget}
        onClose={() => { setSlideOverTarget(null); setCreateMoveSource(null) }}
        onSaved={handleShiftSaved}
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
        open={publishOpen}
        onCancel={() => setPublishOpen(false)}
        onConfirm={handlePublishWeek}
        title={`Publish ${formatWeekSpan(days)}?`}
        message={<p>{publishWeekMessage(drafts)}</p>}
        confirmLabel={`Publish ${plural(drafts.length, 'shift')}`}
        loading={publishWeek.isPending}
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
              disabled={!overrideReasonDraft.trim() || assignShift.isPending || moveStaff.isPending}
              onClick={() => pendingAssign && pendingAssign.retry(overrideReasonDraft.trim(), pendingAssign.findings.map(f => f.code))}
            >
              {assignShift.isPending || moveStaff.isPending ? 'Assigning…' : 'Assign anyway'}
            </Button>
          </>
        }
      />

      {/* Replace or swap (the brief, sections 5 and 10): a ConfirmDialog with its own footer, right-aligned Cancel, Swap (only for a person carried off a puck) and Replace. Esc is Cancel. */}
      <ConfirmDialog
        open={prompt !== null}
        onCancel={() => setPrompt(null)}
        title={prompt ? `${prompt.shift.staffName} is on this shift` : ''}
        message={prompt && replacePromptLines(prompt.carry, prompt.shift, prompt.canSwap).map(line => <p key={line}>{line}</p>)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPrompt(null)}>Cancel</Button>
            {prompt?.canSwap && <Button variant="secondary" onClick={() => choosePrompt('Swap')}>Swap</Button>}
            <Button onClick={() => choosePrompt('Replace')}>Replace</Button>
          </>
        }
      />
    </div>
  )
}
