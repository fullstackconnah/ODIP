/**
 * What the screen shows while changes are still waiting to send: the server's copy with the worker's own unsent
 * changes laid on top, so a tick stays ticked and a started shift reads "In progress". Only Waiting records count;
 * once the server has refused one (Not sent) the screen falls back to the server's truth.
 */
import type { PortalShiftDetailDto, PortalShiftsResponseDto, ShiftBreakDto, ShiftCompletionDto, ShiftNoteDto } from '@/api/types'
import type { QueueRecord } from './queue'

const waitingFor = (records: readonly QueueRecord[], shiftId: string) => records.filter((r) => r.shiftId === shiftId && r.status === 'waiting')

export type QueuedNote = ShiftNoteDto & { waiting?: boolean }

export function applyQueued(detail: PortalShiftDetailDto, records: readonly QueueRecord[]): PortalShiftDetailDto {
  const mine = waitingFor(records, detail.id)
  if (!mine.length) return detail
  let out = detail
  for (const r of mine) {
    switch (r.kind) {
      case 'start': {
        const completion = {
          ...(out.completion ?? {}),
          id: out.completion?.id ?? `queued:${r.id}`,
          shiftId: detail.id,
          actualStart: r.clientTime,
          actualEnd: null,
          startedAt: r.clientTime,
          submittedAt: null,
          timeZoneId: detail.timeZoneId,
          geolocationDeclined: (r.body as { geolocationDeclined?: boolean } | undefined)?.geolocationDeclined ?? false,
          startWasManual: false,
          submittedByUserId: r.userId,
          submittedByName: '',
        } as ShiftCompletionDto
        out = { ...out, status: 'InProgress', completion }
        break
      }
      case 'tick':
      case 'untick': {
        const on = r.kind === 'tick'
        out = { ...out, shiftRoutines: out.shiftRoutines.map((x) => (x.id === r.target ? { ...x, isChecked: on, checkedAt: on ? r.clientTime : null, checkedByName: on ? (x.checkedByName ?? '') : null } : x)) }
        break
      }
      case 'ack':
        if (out.handover) out = { ...out, handover: { ...out.handover, isRead: true, readAt: r.clientTime } }
        break
      case 'breakStart': {
        const b: ShiftBreakDto = { id: r.id, startedAt: r.clientTime, endedAt: null, isRunning: true, minutes: 0, editedAt: null, createdByUserId: r.userId }
        out = { ...out, breaks: [...out.breaks, b] }
        break
      }
      case 'breakEnd': {
        out = {
          ...out,
          breaks: out.breaks.map((b) => (b.id === r.target
            ? { ...b, endedAt: r.clientTime, isRunning: false, minutes: Math.max(0, Math.round((Date.parse(r.clientTime) - Date.parse(b.startedAt)) / 60_000)) }
            : b)),
          finishBlockers: out.finishBlockers.filter((x) => x.code !== 'BREAK_RUNNING'),
        }
        break
      }
    }
  }
  return out
}

export function applyQueuedNotes(notes: readonly ShiftNoteDto[], records: readonly QueueRecord[], shiftId: string): QueuedNote[] {
  const queued: QueuedNote[] = waitingFor(records, shiftId)
    .filter((r) => r.kind === 'note')
    .map((r) => {
      const b = r.body as { body?: string; createdAt?: string }
      const at = b.createdAt ?? r.clientTime
      return { id: r.id, shiftId, authorUserId: r.userId, authorName: '', body: b.body ?? '', createdAt: at, updatedAt: at, flaggedCategories: [], flagsAcknowledgedAt: null, incidentId: null, waiting: true }
    })
  const known = new Set(notes.map((n) => n.id))
  return [...notes, ...queued.filter((n) => !known.has(n.id))]
}

/** Record lookups the screens use to place the "Waiting to send" marker. */
export const waitingTick = (records: readonly QueueRecord[], shiftId: string, routineId: string) =>
  [...waitingFor(records, shiftId)].reverse().find((r) => (r.kind === 'tick' || r.kind === 'untick') && r.target === routineId)
export const waitingKind = (records: readonly QueueRecord[], shiftId: string, kind: QueueRecord['kind']) => waitingFor(records, shiftId).find((r) => r.kind === kind)
export const waitingBreak = (records: readonly QueueRecord[], shiftId: string, breakId: string) =>
  waitingFor(records, shiftId).find((r) => (r.kind === 'breakStart' && r.id === breakId) || (r.kind === 'breakEnd' && r.target === breakId))

/** The My shifts list: a shift whose Start is waiting to send reads In progress. */
export function applyQueuedList(data: PortalShiftsResponseDto, records: readonly QueueRecord[]): PortalShiftsResponseDto {
  const started = new Set(records.filter((r) => r.kind === 'start' && r.status === 'waiting').map((r) => r.shiftId))
  if (!started.size) return data
  return { ...data, shifts: data.shifts.map((s) => (started.has(s.id) && s.status === 'Published' ? { ...s, status: 'InProgress' as const } : s)) }
}
