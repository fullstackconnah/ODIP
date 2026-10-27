/** Plain-language reasons a queued change was refused (SHAPE 4c). The server's answer was recorded on the record when it refused. */
import type { QueueRecord } from './queue'

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])\.?m\.?/i, (_, c: string) => ` ${c.toLowerCase()}m`)
}

const CLIENT_TIME_CODES = ['SHIFT_CLIENT_TIME_IN_FUTURE', 'SHIFT_CLIENT_TIME_BEFORE_START']

export function reasonFor(rec: QueueRecord, ctx: { returnCount?: number } = {}): string {
  const { httpStatus: status, code } = rec
  const at = clockTime(rec.clientTime)
  if (code && CLIENT_TIME_CODES.includes(code)) return `The time on this phone (${at}) is outside what Bunya Support accepts, for example if the phone's clock was wrong. Tell your coordinator the real time.`
  if (code === 'SHIFT_CLIENT_TIME_TOO_OLD') return `This was recorded more than 48 hours ago (${at}), which is too old for Bunya Support to accept. Tell your coordinator the real time.`
  if (code === 'SHIFT_FINISH_BLOCKED') {
    return rec.blockers?.includes('BREAK_RUNNING')
      ? "Finish wasn't sent: a break is still running. End it on the shift, then try again."
      : "Finish wasn't sent: a dose is due with no outcome recorded. Record it on the shift, then try again."
  }
  switch (code) {
    case 'SHIFT_CANCELLED': return 'This shift was cancelled.'
    case 'SHIFT_ALREADY_COMPLETED': return 'This shift was already reviewed and completed.'
    case 'SHIFT_ALREADY_FINISHED': return "This shift was already finished, so this couldn't be added."
    case 'SHIFT_HANDOVER_CHANGED': return 'The handover changed after you read it. Open the shift and read the new one.'
    case 'SHIFT_ROUTINE_NOT_FOUND': return 'This check was taken off the shift after you ticked it.'
    case 'SHIFT_START_TOO_EARLY': return 'Started more than 60 minutes before the rostered start.'
    case 'SHIFT_NOT_PUBLISHED': return "This shift isn't published, so this couldn't be added."
    case 'SHIFT_NOT_IN_PROGRESS':
      return (ctx.returnCount ?? 0) > 0 ? 'This shift was sent back for changes. Start it again, then add this.' : "This shift isn't in progress, so this couldn't be added."
  }
  if (code?.startsWith('SHIFT_BREAK_')) return `Bunya Support couldn't accept this break (code ${code}). Tell your coordinator.`
  if (status === 404) return "This shift isn't yours any more. It may have been given to someone else."
  return code ? `Bunya Support couldn't accept this (code ${code}). Tell your coordinator.` : "Bunya Support couldn't accept this. Tell your coordinator."
}
