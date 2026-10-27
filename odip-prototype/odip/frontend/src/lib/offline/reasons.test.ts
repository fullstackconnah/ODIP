import { describe, expect, it } from 'vitest'
import type { QueueRecord } from './queue'
import { clockTime, reasonFor } from './reasons'

const base: QueueRecord = {
  id: 'r1', userId: 'u1', viewAsTenant: null, viewAsUser: null, shiftId: 's1', kind: 'note', path: '/p', method: 'POST', body: {},
  clientTime: '2026-10-28T04:14:00Z', createdAt: 1, status: 'notSent', label: { participant: 'J', serviceDate: '2026-10-28', rostered: '9:00 am - 1:00 pm' },
}
const rec = (extra: Partial<QueueRecord>): QueueRecord => ({ ...base, ...extra })
const time = clockTime(base.clientTime)

describe('reasonFor', () => {
  it('formats the tap time as a lower-case 12 hour clock', () => {
    expect(time).toMatch(/^\d{1,2}:\d{2} (am|pm)$/)
  })

  it.each([
    [{ httpStatus: 404 }, "This shift isn't yours any more. It may have been given to someone else."],
    [{ httpStatus: 409, code: 'SHIFT_CANCELLED' }, 'This shift was cancelled.'],
    [{ httpStatus: 409, code: 'SHIFT_ALREADY_COMPLETED' }, 'This shift was already reviewed and completed.'],
    [{ httpStatus: 409, code: 'SHIFT_ALREADY_FINISHED' }, "This shift was already finished, so this couldn't be added."],
    [{ kind: 'finish', httpStatus: 422, code: 'SHIFT_FINISH_BLOCKED', blockers: ['DOSE_OUTCOME_MISSING'] }, "Finish wasn't sent: a dose is due with no outcome recorded. Record it on the shift, then try again."],
    [{ kind: 'finish', httpStatus: 422, code: 'SHIFT_FINISH_BLOCKED', blockers: ['BREAK_RUNNING'] }, "Finish wasn't sent: a break is still running. End it on the shift, then try again."],
    [{ kind: 'ack', httpStatus: 409, code: 'SHIFT_HANDOVER_CHANGED' }, 'The handover changed after you read it. Open the shift and read the new one.'],
    [{ kind: 'tick', httpStatus: 404, code: 'SHIFT_ROUTINE_NOT_FOUND' }, 'This check was taken off the shift after you ticked it.'],
    [{ httpStatus: 409, code: 'SHIFT_START_TOO_EARLY' }, 'Started more than 60 minutes before the rostered start.'],
    [{ httpStatus: 400, code: 'SHIFT_CLIENT_TIME_IN_FUTURE' }, `The time on this phone (${time}) is outside what Bunya Support accepts, for example if the phone's clock was wrong. Tell your coordinator the real time.`],
    [{ httpStatus: 400, code: 'SHIFT_CLIENT_TIME_BEFORE_START' }, `The time on this phone (${time}) is outside what Bunya Support accepts, for example if the phone's clock was wrong. Tell your coordinator the real time.`],
    [{ httpStatus: 400, code: 'SHIFT_CLIENT_TIME_TOO_OLD' }, `This was recorded more than 48 hours ago (${time}), which is too old for Bunya Support to accept. Tell your coordinator the real time.`],
    [{ httpStatus: 409, code: 'SHIFT_NOT_PUBLISHED' }, "This shift isn't published, so this couldn't be added."],
    [{ httpStatus: 409, code: 'SHIFT_BREAK_ID_CONFLICT' }, "Bunya Support couldn't accept this break (code SHIFT_BREAK_ID_CONFLICT). Tell your coordinator."],
    [{ httpStatus: 409, code: 'SHIFT_X' }, 'Bunya Support couldn\'t accept this (code SHIFT_X). Tell your coordinator.'],
    [{ httpStatus: 400 }, "Bunya Support couldn't accept this. Tell your coordinator."],
  ] as [Partial<QueueRecord>, string][])('%j', (extra, text) => {
    expect(reasonFor(rec(extra))).toBe(text)
  })

  it('a shift that is not in progress reads differently once it has been returned', () => {
    const r = rec({ httpStatus: 409, code: 'SHIFT_NOT_IN_PROGRESS' })
    expect(reasonFor(r)).toBe("This shift isn't in progress, so this couldn't be added.")
    expect(reasonFor(r, { returnCount: 1 })).toBe('This shift was sent back for changes. Start it again, then add this.')
  })
})
