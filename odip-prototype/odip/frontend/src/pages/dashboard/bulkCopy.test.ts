import { describe, expect, it } from 'vitest'
import type { OverlapShiftDto } from '@/api/hooks'
import { actionLabel, bannerCopy, confirmCopy, resultNotice, runningLabel, selectName, type BulkResult } from './bulkCopy'

const result = (o: Partial<BulkResult> = {}): BulkResult => ({ total: 0, decided: 0, stale: 0, failed: [], skipped: 0, overlaps: [], ...o })
const shift = (serviceDate: string, participantId = 'p-1') => ({ serviceDate, participantId }) as OverlapShiftDto

describe('bulkCopy — the bar (SHAPE §4, §5)', () => {
  it("labels Complete all with the tab's true count, drops 'all' for one, and names it in full", () => {
    expect(actionLabel('completions', 'all', 12)).toEqual({ label: 'Approve all 12 clean', name: 'Approve all 12 clean shift completions' })
    expect(actionLabel('completions', 'all', 1)).toEqual({ label: 'Approve 1 clean', name: 'Approve 1 clean shift completion' })
    expect(actionLabel('leave', 'all', 9)).toEqual({ label: 'Approve all 9', name: 'Approve all 9 leave requests' })
    expect(actionLabel('tasks', 'all', 7)).toEqual({ label: 'Mark all 7 done', name: 'Mark all 7 tasks done' })
    expect(actionLabel('tasks', 'all', 1)).toEqual({ label: 'Mark 1 done', name: 'Mark 1 task done' })
  })

  it('says the first 100 of the clean total when Completions is over the batch cap', () => {
    expect(actionLabel('completions', 'all', 134)).toEqual({ label: 'Approve 100 of 134 clean', name: 'Approve the first 100 of 134 clean shift completions' })
  })

  it('labels the selection by its count', () => {
    expect(actionLabel('leave', 'selected', 3)).toEqual({ label: 'Approve 3', name: 'Approve 3 selected leave requests' })
    expect(actionLabel('completions', 'selected', 1)).toEqual({ label: 'Approve 1', name: 'Approve 1 selected shift completion' })
    expect(actionLabel('tasks', 'selected', 2)).toEqual({ label: 'Mark 2 done', name: 'Mark 2 selected tasks done' })
  })

  it('counts a run on its button: the one in flight of the total, the batch as one request', () => {
    expect(runningLabel('leave', 3, 9)).toBe('Approving 4 of 9…')
    expect(runningLabel('tasks', 3, 7)).toBe('Marking 4 of 7 done…')
    expect(runningLabel('completions', 0, 12)).toBe('Approving 12…')
  })

  it("names a row's box from its one-tap action", () => {
    expect(selectName('Approve leave: Jack O’Sullivan, 14–18 Sep 2026')).toBe('Select leave: Jack O’Sullivan, 14–18 Sep 2026')
    expect(selectName('Done: Call the plan manager')).toBe('Select: Call the plan manager')
  })
})

describe('bulkCopy — the confirm (SHAPE §6)', () => {
  it('asks with the count the run sends, and says what stays', () => {
    expect(confirmCopy('completions', 'all', 12, 3)).toEqual({
      title: 'Approve 12 clean completions?', message: 'Each one moves to Completed, ready for billing. The 3 that need review stay here.', confirm: 'Approve 12',
    })
    expect(confirmCopy('completions', 'all', 134, 0)).toEqual({
      title: 'Approve the first 100 of 134 clean completions?', message: 'Each one moves to Completed, ready for billing.', confirm: 'Approve 100',
    })
    expect(confirmCopy('leave', 'all', 9, 1).message).toBe(
      "Each leave approval emails the staff member, and any that overlaps the roster gets its cover tasks, as one at a time would. Your own request isn't included: someone else decides it.")
    expect(confirmCopy('tasks', 'all', 7, 2)).toEqual({
      title: 'Mark 7 tasks done?', message: "Each one is checked first, and one already closed is skipped. 2 stay for you to open: they can't be marked done here.", confirm: 'Mark 7 done',
    })
  })

  it('asks for a selection with the consequence sentence alone', () => {
    expect(confirmCopy('leave', 'selected', 3, 1)).toEqual({
      title: 'Approve 3 selected leave requests?',
      message: 'Each leave approval emails the staff member, and any that overlaps the roster gets its cover tasks, as one at a time would.', confirm: 'Approve 3',
    })
    expect(confirmCopy('tasks', 'selected', 1, 0).title).toBe('Mark 1 selected task done?')
  })
})

describe('bulkCopy — the result notice (SHAPE §6)', () => {
  it('heads with what was done, then what stayed, what was stale and what failed, by name', () => {
    const notice = resultNotice('completions', result({
      total: 4, decided: 2, skipped: 3, stale: 1, failed: [{ ref: 'Mei Zhang with Ava Chen, 10 Sep', message: 'Shift not found.' }],
    }))
    expect(notice).toEqual({
      tone: 'success', title: 'Approved 2 completions',
      message: "3 need review and stay here. 1 was already reviewed. 1 couldn't be approved: Mei Zhang with Ava Chen, 10 Sep: Shift not found.",
    })
  })

  it("ends a failure at the row's name when the server gave no words: never a second colon or a Try again", () => {
    expect(resultNotice('completions', result({ total: 2, decided: 1, failed: [{ ref: 'Priya Nadarajah with Liam Okafor, 13 Oct', message: '' }] })).message)
      .toBe("1 couldn't be approved: Priya Nadarajah with Liam Okafor, 13 Oct.")
  })

  it('names at most three failures, then how many more', () => {
    const failed = ['A', 'B', 'C', 'D', 'E'].map((ref) => ({ ref, message: 'No.' }))
    expect(resultNotice('tasks', result({ total: 6, decided: 1, failed })).message).toBe("5 couldn't be marked done: A: No; B: No; C: No; and 2 more.")
  })

  it('says so in its title, in the danger tone, when nothing was decided', () => {
    expect(resultNotice('leave', result({ total: 3, stale: 1, failed: [{ ref: 'A', message: 'No' }, { ref: 'B', message: 'No' }] })))
      .toMatchObject({ tone: 'danger', title: "Couldn't approve 3 leave requests" })
    expect(resultNotice('completions', result({ total: 12, wholeFailed: true })))
      .toEqual({ tone: 'danger', title: "Couldn't approve 12 completions", message: 'Nothing was approved.' })
  })

  it('rolls the overlaps of a leave run into one sentence, with the roster link', () => {
    const notice = resultNotice('leave', result({
      total: 9, decided: 9, skipped: 1,
      overlaps: [
        { kind: 'leave', shifts: [shift('2026-10-22'), shift('2026-10-21')], trips: 1 },
        { kind: 'leave', shifts: [shift('2026-10-23')], trips: 0 },
      ],
    }))
    expect(notice).toEqual({
      tone: 'success', title: 'Approved 9 leave requests',
      message: 'Your own request stays for someone else. 2 overlap the roster: 3 shifts now have cover tasks and 1 trip overlaps.',
      link: { label: 'Open roster', to: '/rostering?date=2026-10-19&participant=p-1' },
    })
  })

  it('says the cap: approved the first 100 of the clean total, run it again for the rest', () => {
    expect(resultNotice('completions', result({ total: 100, decided: 100, of: 134 })))
      .toEqual({ tone: 'success', title: 'Approved 100 of 134', message: 'Run it again for the rest.' })
  })
})

describe('bulkCopy — a run with no answer (review #266 F1)', () => {
  it('never says approved for rows that left, and says what a waiting row can do', () => {
    expect(resultNotice('tasks', result({ total: 3, left: 1, waiting: 2 })).message).toBe("1 has left the list: done here, or changed by someone else. 2 weren't marked done: they're still here to try again.")
    expect(resultNotice('leave', result({ total: 1, waiting: 1 })).message).toBe("1 wasn't approved: it's still here to try again.")
    expect(resultNotice('leave', result({ total: 2, unchecked: 2 })).message).toBe("2 couldn't be checked, so they're held here until the list can be read again. Refresh the page to check now.")
  })
})

describe('bulkCopy — the banner (dtable SHAPE §5)', () => {
  it('offers every safe row in the tab once the page is ticked, then says all are selected', () => {
    expect(bannerCopy('leave', 10, 23)).toEqual({ b1: 'All 10 on this page are selected.', b1Action: 'Select all 23 leave requests', b2: 'All 23 leave requests are selected.' })
    expect(bannerCopy('tasks', 9, 19).b1Action).toBe('Select all 19 tasks')
    expect(bannerCopy('completions', 9, 19)).toEqual({ b1: 'All 9 on this page are selected.', b1Action: 'Select all 19 clean completions', b2: 'All 19 clean completions are selected.' })
  })

  it('says a run approves the first 100 when the tab holds more clean completions', () => {
    expect(bannerCopy('completions', 10, 134).b2).toBe('All 134 clean completions are selected. A run approves the first 100.')
    expect(bannerCopy('completions', 10, 100).b2).toBe('All 100 clean completions are selected.')
  })
})
