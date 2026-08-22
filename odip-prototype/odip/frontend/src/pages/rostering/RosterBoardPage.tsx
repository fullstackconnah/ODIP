import { useMemo, useState } from 'react'
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import { CalendarClock, CalendarPlus } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { usePermissions } from '@/lib/permissions'
import { useRosterBoard, useAssignShift, useDeleteShift, useParticipants, useStaff, getRosterFindings } from '@/api/hooks'
import type { ShiftDto, RosterFindingDto } from '@/api/types'
import {
  WeekToolbar, RosterGrid, RosterGridSkeleton, ShiftSlideOver, FindingsList, ExceptionsDrawer,
  type ShiftSlideOverTarget,
} from './components'
import { weekStartOf, shiftWeek, daysOfWeek } from './lib/roster'

type PendingAssign = { shift: ShiftDto; staffId: string | null; findings: RosterFindingDto[] }
type PendingBlocked = { shift: ShiftDto; findings: RosterFindingDto[] }

export default function RosterBoardPage() {
  const { canWrite } = usePermissions()
  const [weekStart, setWeekStart] = useState(() => weekStartOf(new Date()))
  const [participantFilter, setParticipantFilter] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [unfilledOnly, setUnfilledOnly] = useState(false)
  const [exceptionsOpen, setExceptionsOpen] = useState(false)
  const [slideOverTarget, setSlideOverTarget] = useState<ShiftSlideOverTarget | null>(null)
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<ShiftDto | null>(null)
  const [pendingAssign, setPendingAssign] = useState<PendingAssign | null>(null)
  const [pendingBlocked, setPendingBlocked] = useState<PendingBlocked | null>(null)
  const [overrideReasonDraft, setOverrideReasonDraft] = useState('')

  const { data: board, isLoading, isError, refetch } = useRosterBoard(weekStart)
  const { data: participants = [] } = useParticipants()
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
    const matchesParticipant = (s: ShiftDto) => !participantFilter || s.participantId === participantFilter
    return {
      ...board,
      unfilled: board.unfilled.filter(matchesParticipant),
      rows: board.rows
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

  const isEmptyWeek = !!board && board.rows.every(r => r.shifts.length === 0) && board.unfilled.length === 0

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Rostering" subtitle="Week roster board — community shifts, trip work, and leave in one view." />

      <WeekToolbar
        days={days}
        onPrevWeek={() => setWeekStart(w => shiftWeek(w, -1))}
        onThisWeek={() => setWeekStart(weekStartOf(new Date()))}
        onNextWeek={() => setWeekStart(w => shiftWeek(w, 1))}
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

      {!isLoading && !isError && filteredBoard && isEmptyWeek && (
        <div className="flex flex-col items-center gap-2">
          <EmptyState
            icon={CalendarClock}
            title="Nothing rostered this week"
            description="Set up a recurring weekly pattern for a participant's regular shifts, or add a one-off shift for this week."
            action={canWrite ? { label: 'Set up a pattern', to: '/rostering/patterns' } : undefined}
          />
          {canWrite && (
            <button
              type="button"
              onClick={() => setSlideOverTarget({ mode: 'create', serviceDate: weekStart })}
              className="-mt-2 flex items-center gap-1.5 text-sm font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              <CalendarPlus className="h-4 w-4" /> Or add a one-off shift instead
            </button>
          )}
        </div>
      )}

      {!isLoading && !isError && filteredBoard && !isEmptyWeek && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <RosterGrid
            board={filteredBoard}
            canWrite={canWrite}
            unfilledOnly={unfilledOnly}
            onOpenShift={shift => setSlideOverTarget({ mode: 'edit', shift })}
            onAssignTo={shift => setSlideOverTarget({ mode: 'edit', shift })}
            onUnassign={shift => performAssign(shift, null)}
            onDeleteShift={shift => setConfirmDeleteTarget(shift)}
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
      />

      <ExceptionsDrawer
        open={exceptionsOpen}
        onClose={() => setExceptionsOpen(false)}
        exceptions={board?.exceptions ?? []}
        onJumpToShift={shiftId => {
          const shift = [...(board?.unfilled ?? []), ...(board?.rows.flatMap(r => r.shifts) ?? [])].find(s => s.id === shiftId)
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
