import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, MouseSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent, type Modifier,
} from '@dnd-kit/core'
import { CalendarClock, CalendarPlus, X } from 'lucide-react'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { BudgetWarnings } from '@/components/BudgetWarnings'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'
import { apiErrorCode, apiErrorStatus } from '@/lib/shiftPackageErrors'
import { plural } from '@/lib/format'
import { useRosterBoard, useAssignShift, useMoveStaff, usePublishWeek, useStartWeek, useSetRegular, useDeleteShift, useParticipants, useStaff, getRosterFindings } from '@/api/hooks'
import { CAN_RECEIVE_SERVICES } from '@/api/types/participants'
import type { ShiftDto, RosterFindingDto, RosterBoardDto, MoveStaffMode, StartWeekResultDto } from '@/api/types'
import {
  WeekToolbar, WEEK_HEADING_ID, RosterGrid, RosterGridSkeleton, ShiftSlideOver, FindingsList, ExceptionsDrawer, StaffStrip, CarriedPuck, StaffPicker, SwapPicker, PendingAgreementNotice,
  type ShiftSlideOverTarget,
} from './components'
import { weekStartOf, weekStartFromDateParam, shiftWeek, daysOfWeek, isUnfilledShift, formatWeekSpan } from './lib/roster'
import { useBoardViewMode } from './lib/useBoardViewMode'
import {
  DropStateContext, ROSTER_SCREEN_READER_INSTRUCTIONS, assignedSentence, dropOutcome, movedSentence, publishWeekMessage, publishedSentence, replacePromptLines, rosterAnnouncements,
  rosterCollision, staffWeekHours, swappedSentence, keepInWindow, isLockedShift, leaveFromStaffRows, type DragCarry, type DropTarget, type PendingDrop, type PickRow,
} from './lib/rosterDrag'
import {
  ALREADY_STARTED, LEAVE_TITLE, START_FAILED, alreadyInWeekLine, leaveMessage, regularConfirm, regularDone, bannerBlockedLine, bannerTitle, isBlocked, startBudgetWarnings, startResultBody, startResultTitle,
} from './lib/rosterWeek'

/** One roster write, given the reason and the codes a warnings dialog collected (none the first time). */
type Send = (overrideReason: string | null, acknowledgedFindingCodes: string[]) => Promise<unknown>
type PendingAssign = { findings: RosterFindingDto[]; retry: (overrideReason: string, codes: string[]) => Promise<boolean> }
type PendingBlocked = { findings: RosterFindingDto[] }
type DropPrompt = { carry: DragCarry; shift: ShiftDto; canSwap: boolean }
/** What Start said about the week on screen: what it made, or that someone else had started it. */
type StartNotice = { kind: 'started'; result: StartWeekResultDto } | { kind: 'already' }

/** The carried puck rides one coarse row (48px, --row-h under pointer: coarse) above a finger, so its outcome line is not under the thumb. A mouse or keyboard drag is left alone. */
const liftAboveFinger: Modifier = ({ transform, activatorEvent }) => (activatorEvent?.type === 'touchstart' ? { ...transform, y: transform.y - 48 } : transform)

/** Focus on a shift's menu button (the ⋮): where a menu item that opened a picker or dialog gives focus back to. */
function focusChipMenu(id: string) {
  document.querySelector<HTMLElement>(`[data-shift-chip="${id}"] button[aria-label^="Actions for"]`)?.focus({ preventScroll: true })
}

/** Focus on a shift's open control (ShiftChip's data-shift-open): the thing a keyboard drop changed. */
function focusShift(id: string) {
  document.querySelector<HTMLElement>(`[data-shift-open="${id}"]`)?.focus()
}

/** What the server reads as "no regular was shown" in a Make or Stop (REV281B). */
const NO_REGULAR = '00000000-0000-0000-0000-000000000000'
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
  // Declared above the ?date= block, which clears it: a week's notices belong to that week (the brief, 2.3).
  const [startNotice, setStartNotice] = useState<StartNotice | null>(null)
  const [regularNotice, setRegularNotice] = useState<string | null>(null)
  // React's "adjust state when a prop changes" pattern: compare the param during render, no effect. A missing param never resets the week.
  const [seenDateParam, setSeenDateParam] = useState(dateParam)
  if (seenDateParam !== dateParam) {
    setSeenDateParam(dateParam)
    if (dateParam !== null) { setWeekStart(weekStartFromDateParam(dateParam)); setStartNotice(null); setRegularNotice(null) }
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
  // The staff picker (spec 2026-10-15, decision C): one at a time, for a Needs staff shift. Stored as the shift that opened it; read back from the CURRENT board below.
  const [pickerTarget, setPickerTarget] = useState<ShiftDto | null>(null)
  // The menu's Swap with… (the lead's decision 1, 2026-10-15): one picker at a time, for an assigned shift. Read back from the CURRENT board like the staff picker.
  const [swapTarget, setSwapTarget] = useState<ShiftDto | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // How much taller than one row of controls the toolbar is: it wraps to two rows at 1280, which the board frame's fixed allowance does not know (finish review).
  // Re-measured whenever the toolbar resizes, since the wrap follows the window's width.
  const headerRef = useRef<HTMLDivElement>(null)
  const [toolbarExtra, setToolbarExtra] = useState(0)
  useLayoutEffect(() => {
    const toolbar = headerRef.current?.lastElementChild as HTMLElement | null | undefined
    if (!toolbar) return
    const measure = () => setToolbarExtra(Math.max(0, toolbar.offsetHeight - (parseFloat(getComputedStyle(toolbar).getPropertyValue('--control-h')) || 0)))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [])
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

  // Who waits for an approval for rostering (spec 2026-10-15, decision A; L10), with a row or not, in name order. With the participant filter on, only that participant. Participant view only.
  const waiting = useMemo(() => (board?.groupBy === 'Participant'
    ? (board.pendingAgreements ?? []).filter(p => !participantFilter || p.participantId === participantFilter).sort((a, b) => a.displayName.localeCompare(b.displayName))
    : []), [board, participantFilter])
  const hasNotice = waiting.length > 0

  // Decisions 1 and 10: drag and drop is the Participant view's, for writers, from md up; the Staff view and phones keep click and the menus.
  const dragOn = canWrite && groupBy === 'participant' && !belowMd && board?.weekStarted !== false
  const boardShifts = useMemo(() => allBoardShifts(board), [board])
  const hours = useMemo(() => staffWeekHours(boardShifts), [boardShifts])
  // The picker's shift as the board has it now: a refetch that filled, removed or locked it closes the picker (Review Focus 2). React's adjust-state-in-render pattern, as for `?date=` above.
  const pickerShift = pickerTarget ? boardShifts.find(s => s.id === pickerTarget.id && isUnfilledShift(s) && !isLockedShift(s)) ?? null : null
  if (pickerTarget && !pickerShift) setPickerTarget(null)
  // A refetch that emptied, removed or locked the shift closes the swap picker the same way.
  const swapShift = swapTarget ? boardShifts.find(s => s.id === swapTarget.id && s.staffId && !isLockedShift(s)) ?? null : null
  if (swapTarget && !swapShift) setSwapTarget(null)
  // Leave for the picker: the participant board sends the week's leave; the Staff view has it on its rows' leave bars (lead decision L3).
  const boardLeave = useMemo(() => (!board ? [] : board.groupBy === 'Participant' ? board.staffLeave ?? [] : leaveFromStaffRows(board.staffRows)), [board])
  const publishWeek = usePublishWeek()
  const [publishOpen, setPublishOpen] = useState(false)
  // Counted from the raw board, all participants (the brief, section 8); the server publishes the same week for every participant the board shows.
  const drafts = useMemo(() => boardShifts.filter(s => s.status === 'Draft'), [boardShifts])
  // Only an explicit false is unstarted: a board without the field (old fixtures) reads as started.
  const unstarted = board?.weekStarted === false
  const blocked = useMemo(() => drafts.filter(isBlocked), [drafts])
  const publishable = useMemo(() => drafts.filter(s => !isBlocked(s)), [drafts])
  // The banner (the brief, 3.1): a started week with drafts, for writers and readers.
  const showBanner = !unstarted && drafts.length > 0
  const noticesShown = showBanner || hasNotice || !!assignError || !!startNotice || !!regularNotice
  // The height of what stands above the board (the banner, the notices and the error, in one wrapper), for the board frame (finish review fix 5): with them above it, strip and grid still share one screen.
  // shortcut: measured when any of them changes, not when the window resizes; a ResizeObserver if a long message ever wraps differently after a resize.
  const noticeRef = useRef<HTMLDivElement>(null)
  const [noticeHeight, setNoticeHeight] = useState<number | null>(null)
  useLayoutEffect(() => { setNoticeHeight(noticesShown ? noticeRef.current?.offsetHeight ?? 0 : null) }, [noticesShown, assignError, waiting, drafts.length, blocked.length, startNotice, regularNotice])

  const startWeek = useStartWeek()
  // Keyed to its week: a Start still out for a week no longer shown never says "Starting…" on this week's card, and one week settling never clears another's.
  const [startingWeeks, setStartingWeeks] = useState<ReadonlySet<string>>(new Set())
  const startsInFlight = useRef(new Set<string>())   // the state lags a render, so two clicks in one render both see "not starting"
  const starting = startingWeeks.has(weekStart)
  const startNoticeRef = useRef<HTMLDivElement>(null)
  // The week on screen now, for an answer that comes back after a week move (the brief, 2.4).
  const shownWeek = useRef(weekStart)
  useLayoutEffect(() => { shownWeek.current = weekStart }, [weekStart])
  // The card has gone (the board says started) by the time a notice is set, so focus goes to the notice, never to body.
  useEffect(() => { if (startNotice) startNoticeRef.current?.focus() }, [startNotice])

  /** Moves the board to another week. Its notices (Start's result, a regular's change) belong to the week they were about (the brief, 2.3 and 5.2). */
  function showWeek(target: string) {
    setWeekStart(target)
    setStartNotice(null)
    setRegularNotice(null)
  }

  const setRegular = useSetRegular()
  const [regularTarget, setRegularTarget] = useState<ShiftDto | null>(null)
  // Lead decision 1: the board's regularUserId is the slot's live regular, so a Make over someone else names them (from the staff list).
  const replacing = (shift: ShiftDto) => (shift.regularUserId && shift.regularUserId !== shift.staffId ? staff.find(s => s.id === shift.regularUserId)?.fullName : undefined)
  const regularCopy = regularTarget ? regularConfirm(regularTarget, replacing(regularTarget)) : null

  /** The menu item that opened the dialog went with the menu, so focus goes back to the chip's ⋮ by hand (as closeSwap does). */
  function closeRegular() {
    const id = regularTarget?.id
    setRegularTarget(null)
    if (id) requestAnimationFrame(() => focusChipMenu(id))
  }

  async function handleSetRegular() {
    const shift = regularTarget
    if (!shift?.shiftPatternId) return
    try {
      await setRegular.mutateAsync({ patternId: shift.shiftPatternId, shiftId: shift.id, staffId: shift.isRegular ? null : shift.staffId ?? null, expectedRegularId: shift.regularUserId ?? NO_REGULAR })
      setRegularNotice(regularDone(shift))
    } catch (err: unknown) {
      setAssignError(extractErrorMessage(err, 'Something went wrong changing the regular. Please try again.'))
    } finally {
      closeRegular()
    }
  }

  // The leave guard (the brief, section 4): a writer, a started week, and a draft Publish could send. Drafts only a rule blocks never ask: publishing can't fix them.
  const leaveArmed = canWrite && !unstarted && publishable.length > 0
  const leaveCopy = { title: LEAVE_TITLE, message: leaveMessage(publishable.length, formatWeekSpan(days)), confirmLabel: 'Leave without publishing', stayLabel: 'Stay' }
  const { dialog: leaveDialog } = useUnsavedChangesWarning(leaveArmed, {
    leaveCopy,
    // Another week by address (a bell or task link) leaves this one; the filters (?participant=, ?unfilled=) keep it.
    blockIf: (_current, next) => {
      const date = new URLSearchParams(next.search).get('date')
      return date !== null && weekStartFromDateParam(date) !== weekStart
    },
  })
  const [pendingWeek, setPendingWeek] = useState<string | null>(null)

  /** Prev, Next and This week are local state, out of useBlocker's sight, so they ask here. The week already shown asks nothing. */
  function moveToWeek(target: string) {
    if (target === weekStart) return
    if (leaveArmed) setPendingWeek(target)
    else showWeek(target)
  }

  async function handleStartWeek() {
    const week = weekStart
    if (startsInFlight.current.has(week)) return
    startsInFlight.current.add(week)
    const span = formatWeekSpan(days)
    setAssignError(null)
    setStartingWeeks(weeks => new Set(weeks).add(week))
    try {
      const result = await startWeek.mutateAsync(week)
      if (shownWeek.current !== week) { setAnnouncement(startResultTitle(span, result)); return }
      setStartNotice({ kind: 'started', result })
    } catch (err: unknown) {
      // Lead decision 4: PR 1's code says "already started" (two coordinators at once); anything else, busy included, is an error in the server's words.
      const already = apiErrorStatus(err) === 409 && apiErrorCode(err) === 'roster-week-started'
      const words = already ? ALREADY_STARTED : extractErrorMessage(err, START_FAILED)
      if (shownWeek.current !== week) { setAnnouncement(words); return }
      if (already) setStartNotice({ kind: 'already' })
      else setAssignError(words)
    } finally {
      startsInFlight.current.delete(week)
      setStartingWeeks(weeks => { const rest = new Set(weeks); rest.delete(week); return rest })
    }
  }

  async function handlePublishWeek() {
    try {
      setAnnouncement(publishedSentence(await publishWeek.mutateAsync(weekStart)))
      // The banner's button is about to go (nothing left to publish) or to hide (only blocked drafts left): focus goes to the week heading, never to body (the brief, 3.4).
      requestAnimationFrame(() => document.getElementById(WEEK_HEADING_ID)?.focus())
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

  /** The plus, and an unfilled chip's "Assign to…": opens the picker, or closes it when it is already open for that shift. */
  const togglePicker = (shift: ShiftDto) => { setSwapTarget(null); setPickerTarget(current => (current?.id === shift.id ? null : shift)) }
  const openSwap = (shift: ShiftDto) => { setPickerTarget(null); setSwapTarget(shift) }

  /** Closed without a pick: focus goes back to the plus (below md the SlideOver does that itself). */
  function closePicker() {
    const id = pickerTarget?.id
    setPickerTarget(null)
    if (id) document.querySelector<HTMLElement>(`[data-shift-plus="${id}"]`)?.focus({ preventScroll: true })
  }

  /**
   * A pick is a drop without the drag (the brief, section 4). The picker closes first, so nothing sits over a dialog or the Callout. Focus goes to the shift's open control, where
   * the dialogs hand it back. Then comes the same request a drop sends, with the same pending look, dialogs, Callout and announcement.
   */
  function handlePick(row: PickRow) {
    const target = pickerShift
    setPickerTarget(null)
    if (!target) return
    const person = { staffId: row.person.id, staffName: row.person.fullName }
    focusShift(target.id)
    // Below md the SlideOver hands focus back to the plus as it closes: move it on in the next frame, as handleShiftSaved does, unless a dialog has opened since.
    if (belowMd) requestAnimationFrame(() => { if (!document.querySelector('[role="alertdialog"]')) focusShift(target.id) })
    if (row.source) void dropMove({ ...person, fromShift: row.source }, row.source, target, 'Move')
    else void dropAssign(person, target)
  }

  /** Closed without a pick: focus goes back to the shift's menu, where Swap with… was chosen. */
  function closeSwap() {
    const id = swapTarget?.id
    setSwapTarget(null)
    if (id) focusChipMenu(id)
  }

  /** A swap pick is a drag swap without the drag: the same move-staff request, sentence, dialogs and pending look (choosePrompt('Swap')). Focus goes to the shift it was chosen on, as a pick's does. */
  function handleSwap(to: ShiftDto) {
    const from = swapShift
    setSwapTarget(null)
    if (!from) return
    focusShift(from.id)
    if (belowMd) requestAnimationFrame(() => { if (!document.querySelector('[role="alertdialog"]')) focusShift(from.id) })
    void dropMove({ staffId: from.staffId ?? '', staffName: from.staffName ?? '', fromShift: from }, from, to, 'Swap')
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
    setAssignError(null)
    try {
      await deleteShift.mutateAsync(confirmDeleteTarget.id)
    } catch (err: unknown) {
      setAssignError(extractErrorMessage(err, 'Something went wrong deleting this shift. Please try again.'))
    } finally {
      setConfirmDeleteTarget(null)
    }
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

  const dismissNotice = (onClick: () => void) => (
    <Button variant="ghost" size="sm" iconOnly onClick={onClick} aria-label="Dismiss notice">
      <X className="h-4 w-4" />
    </Button>
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
      onSetRegular={canWrite ? setRegularTarget : undefined}
      onAddParticipantShift={handleAddParticipantShift}
      onAddStaffShift={handleAddStaffShift}
    />
  )

  return (
    <div
      className="flex flex-col gap-[var(--section-gap)] animate-fade-in"
      style={{
        '--roster-toolbar-extra': `${toolbarExtra}px`,
        ...(noticeHeight === null ? {} : { '--roster-notice-h': `calc(${noticeHeight}px + var(--section-gap))` }),
      } as React.CSSProperties}
    >
      <AnnouncementRegion message={announcement} />
      {/* PageHeader is a fragment, so title row and toolbar sit in one tight block here (title 28px + 8px + toolbar 32px)
          instead of being spaced apart by the page's --section-gap. */}
      <div ref={headerRef} className="flex flex-col gap-2">
        <PageHeader title="Roster board" />

        <WeekToolbar
          days={days}
          onPrevWeek={() => moveToWeek(shiftWeek(weekStart, -1))}
          onThisWeek={() => moveToWeek(weekStartOf(new Date()))}
          onNextWeek={() => moveToWeek(shiftWeek(weekStart, 1))}
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
          allPublished={!!board && !unstarted && !weekHasNoShifts && drafts.length === 0}
          newShiftSecondary={unstarted || publishable.length > 0}
        />
      </div>

      {/* The banner, the standing notice, then the error, in ONE wrapper measured for the board frame: the notice never jumps when an error comes and goes (the brief, section 6). */}
      {noticesShown && (
        <div ref={noticeRef} className="flex flex-col gap-[var(--section-gap)]">
          {showBanner && (
            <Callout
              tone="warning"
              // A standing state, not news: as role="alert" it would re-announce on every week change and refetch (the brief, 3.1). Publishing keeps its own sentence.
              announce={false}
              title={bannerTitle(drafts.length)}
              // One line beside a 32px button: centred, or the 19px title sits at the top (the brief, 3.2).
              className={blocked.length === 0 ? 'items-center!' : undefined}
              actions={canWrite && publishable.length > 0 ? <Button size="md" onClick={() => setPublishOpen(true)}>Publish week</Button> : undefined}
            >
              {bannerBlockedLine(drafts.length, blocked.length)}
            </Callout>
          )}
          {hasNotice && <PendingAgreementNotice waiting={waiting} />}
          {startNotice && (
            // Focus lands here after Start (the brief, 2.4), so neither Callout announces itself as well.
            <div ref={startNoticeRef} tabIndex={-1} className="flex flex-col gap-[var(--section-gap)] outline-none">
              {startNotice.kind === 'started' ? (
                <>
                  <Callout tone="success" announce={false} title={startResultTitle(formatWeekSpan(days), startNotice.result)} actions={dismissNotice(() => setStartNotice(null))}>
                    {startResultBody(startNotice.result)}
                  </Callout>
                  <BudgetWarnings
                    warnings={startBudgetWarnings(startNotice.result)}
                    note="This is a warning only. The shifts were made."
                    announce={false}
                    onDismiss={() => setStartNotice({ kind: 'started', result: { ...startNotice.result, budgetWarnings: undefined } })}
                  />
                </>
              ) : (
                <Callout tone="info" announce={false} title={ALREADY_STARTED} actions={dismissNotice(() => setStartNotice(null))}>
                  Someone started it a moment ago, so nothing was added twice. The board shows what's on the roster now.
                </Callout>
              )}
            </div>
          )}
          {/* Its own polite status is the announcement: nothing on the chip changes at rest (the brief, 5.2). */}
          {regularNotice && <Callout tone="success" actions={dismissNotice(() => setRegularNotice(null))}>{regularNotice}</Callout>}
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
        </div>
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
      {!isLoading && !isError && filteredBoard && weekHasNoShifts && !hintDismissed && !hasNotice && !unstarted && (
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

      {!isLoading && !isError && grid && (unstarted ? (
        // The brief, 2.2: one grid cell, two layers. Below, the week's grid, faded, inert (no pointer, no Tab, no drop target) and hidden from assistive tech;
        // above it, outside the scrolling frame so it never scrolls away sideways, the card. No scrim and no blur: the faded grid reads as dormant paper.
        <div className="grid grid-cols-[minmax(0,1fr)]">
          <div inert aria-hidden="true" className="col-start-1 row-start-1 min-w-0 opacity-40">{grid}</div>
          {/* relative: the faded layer's opacity paints it as a positioned layer, so this one must be positioned too, and later in the tree, to paint above it. */}
          <div className="relative col-start-1 row-start-1 flex min-w-0 items-start justify-center pt-12 pb-6 md:items-center md:py-6">
            <section aria-labelledby="start-week-heading" aria-busy={starting || undefined} className="w-[min(24rem,calc(100%_-_2*var(--card-pad)))]">
              {/* The Floating Panel shadow (Dropdown's), its tint written from the foreground token: the house colour rule allows no literal colour. */}
              <Card className="p-[calc(2*var(--card-pad))]! shadow-[0_24px_40px_-12px_color-mix(in_srgb,var(--color-foreground)_14%,transparent)]">
                <div className="flex items-center gap-2">
                  <CalendarPlus className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <h3 id="start-week-heading" className="font-display text-base font-semibold text-foreground">This week hasn't been started</h3>
                </div>
                {canWrite ? (
                  <>
                    <p className="mt-2 text-sm text-muted-foreground">Adds the week's scheduled shifts from approved agreements, with the regular on each one where they're free. Staff see nothing until you publish.</p>
                    {boardShifts.length > 0 && <p className="mt-2 text-sm text-muted-foreground">{alreadyInWeekLine(boardShifts.length)}</p>}
                    {/* aria-disabled, not disabled, while it runs: a disabled button drops focus to body, and a failure must leave focus here (the brief, 2.4). */}
                    <Button
                      size="lg"
                      className="mt-4 w-full md:w-auto aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                      aria-disabled={starting || undefined}
                      onClick={() => { if (!starting) void handleStartWeek() }}
                    >
                      {starting ? 'Starting…' : `Start rostering ${formatWeekSpan(days)}`}
                    </Button>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">A coordinator starts each week's rostering.</p>
                )}
              </Card>
            </section>
          </div>
        </div>
      ) : (
        // In every mode, not only while drag is on: the plus, and a pick's pending look, reach phones and the Staff view too (SHAPE departure 15). The DndContext stays drag-only.
        <DropStateContext.Provider value={{ disabled: dragsOff, pending: dropPending, pick: canWrite ? togglePicker : undefined, swap: canWrite ? openSwap : undefined, pickingId: pickerShift?.id ?? swapShift?.id ?? null }}>
          {dragOn ? (
            <DndContext
              sensors={sensors}
              collisionDetection={rosterCollision}
              accessibility={{ announcements: rosterAnnouncements, screenReaderInstructions: ROSTER_SCREEN_READER_INSTRUCTIONS, restoreFocus: false }}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setCarry(null)}
            // The new-shift slot mounts only once a person is carried; the default (measure while dragging) can miss a droppable that appears mid-drag (plan check S2).
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            >
              <StaffStrip staff={staff} isLoading={staffLoading} hours={hours} regionOptions={regionOptions} regionFilter={regionFilter} onRegionFilterChange={setRegionFilter} />
              {grid}
              {/* A portal (the brief, section 5), so no ancestor's overflow or transform clips or shifts it. No drop animation: the default flies the puck back to its source, which reads as a refusal.
                  pointer-events-none: rosterCollision asks what is on top at the pointer, and that must never be the carried puck itself. */}
              {createPortal(
                <DragOverlay className="pointer-events-none" style={{ width: 'max-content', height: 'auto' }} dropAnimation={null} modifiers={[liftAboveFinger, keepInWindow]}>
                  {carry && <CarriedPuck carry={carry} hours={hours.get(carry.staffId) ?? 0} />}
                </DragOverlay>,
                document.body,
              )}
            </DndContext>
          ) : grid}
        </DropStateContext.Provider>
      ))}

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

      <StaffPicker
        key={pickerShift?.id ?? 'closed'}
        target={pickerShift}
        staff={staff}
        staffLoading={staffLoading}
        shifts={boardShifts}
        leave={boardLeave}
        hours={hours}
        sheet={belowMd}
        onPick={handlePick}
        onClose={closePicker}
      />

      <SwapPicker key={swapShift?.id ?? 'swap-closed'} source={swapShift} shifts={boardShifts} sheet={belowMd} onPick={handleSwap} onClose={closeSwap} />

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

      {leaveDialog}
      <ConfirmDialog
        open={regularCopy !== null}
        onCancel={closeRegular}
        onConfirm={handleSetRegular}
        title={regularCopy?.title ?? ''}
        message={regularCopy?.lines.map(line => <p key={line}>{line}</p>)}
        confirmLabel={regularCopy?.confirmLabel}
        loading={setRegular.isPending}
      />
      <ConfirmDialog
        open={pendingWeek !== null}
        onCancel={() => setPendingWeek(null)}
        onConfirm={() => { if (pendingWeek) showWeek(pendingWeek); setPendingWeek(null) }}
        title={leaveCopy.title}
        message={<p>{leaveCopy.message}</p>}
        cancelLabel={leaveCopy.stayLabel}
        confirmLabel={leaveCopy.confirmLabel}
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
        message={<p>{publishWeekMessage(publishable)}</p>}
        confirmLabel={`Publish ${plural(publishable.length, 'shift')}`}
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
