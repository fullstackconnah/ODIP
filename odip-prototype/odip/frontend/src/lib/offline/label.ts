/** The words kept on a queued record so its heading survives the shift being reassigned (SHAPE 4c). */
import type { QueueRecord } from './queue'

const clock12 = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`
}

export function shiftLabel(s: { participantName?: string; participant?: { fullName: string }; serviceDate: string; startTime: string; endTime: string } | undefined, routine?: string): QueueRecord['label'] {
  return {
    participant: s?.participantName ?? s?.participant?.fullName ?? 'Shift',
    serviceDate: s?.serviceDate ?? '',
    rostered: s?.startTime && s.endTime ? `${clock12(s.startTime)} \u2013 ${clock12(s.endTime)}` : '',
    ...(routine ? { routine } : {}),
  }
}
