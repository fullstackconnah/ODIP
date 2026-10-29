import { useMemo } from 'react'
import { useParticipants, useStaff } from '@/api/hooks'
import { CAN_RECEIVE_SERVICES } from '@/api/types/participants'
import { usePermissions } from '@/lib/permissions'
import { ShiftSlideOver, type ShiftSlideOverTarget } from './ShiftSlideOver'

/**
 * The shift panel for a person's Week tab, the board's own ShiftSlideOver with the board's option lists. Mounted by PersonWeek only after the first
 * open, so the detail pages (whose tests mock the hooks wholesale) never call these hooks until a shift is opened. There is no onSaved: the board-prefix
 * invalidation after a save refreshes the week.
 */
export function PersonWeekPanel({ kind, target, onClose }: { kind: 'staff' | 'participant'; target: ShiftSlideOverTarget | null; onClose: () => void }) {
  const { canWrite } = usePermissions()
  const { data: participants = [] } = useParticipants(CAN_RECEIVE_SERVICES)
  const { data: staff = [] } = useStaff()
  const participantOptions = useMemo(() => participants.map(p => ({ value: p.id, label: p.fullName })), [participants])
  const participantReadiness = useMemo(
    () => Object.fromEntries(participants.map(p => [p.id, p.readinessIssues ?? []])) as Record<string, string[]>,
    [participants],
  )
  const staffOptions = useMemo(() => staff.map(s => ({ value: s.id, label: s.fullName })), [staff])
  return (
    <ShiftSlideOver
      key={target ? (target.mode === 'edit' ? `shift-${target.shift.id}` : 'shift-new') : 'shift-closed'}
      target={target}
      onClose={onClose}
      canWrite={canWrite}
      participantOptions={participantOptions}
      staffOptions={staffOptions}
      groupBy={kind}
      participantReadiness={participantReadiness}
    />
  )
}
