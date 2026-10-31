// @vitest-environment node
import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import type { RosterBoardDto, ShiftDto, ShiftStatus } from '@/api/types'
import { pageCount, textLines } from '@/test/pdfText'
import { ScheduleWeekDocument, toScheduleWeek } from './ScheduleWeekPdf'

const DAYS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']
const HEADINGS = ['Monday 7 September', 'Tuesday 8 September', 'Wednesday 9 September', 'Thursday 10 September', 'Friday 11 September', 'Saturday 12 September', 'Sunday 13 September']

let seq = 0
// Every shift carries the fields the family must never see; the mapper has to leave them behind.
function shift(serviceDate: string, startTime: string, endTime: string, status: ShiftStatus, staffName: string | null, extra: Partial<ShiftDto> = {}): ShiftDto {
  seq++
  return {
    id: `s${seq}`, participantId: 'p-0001', participantName: 'Liam Okafor', serviceDate, startTime, endTime, endsNextDay: false, status,
    staffId: staffName ? `u${seq}` : undefined, staffName, notes: 'SECRET-NOTE', overrideReason: 'SECRET-OVERRIDE', requirements: { gender: 'SECRET-REQ' },
    findings: [], ...extra,
  } as unknown as ShiftDto
}

function board(shifts: ShiftDto[], withRow = true): RosterBoardDto {
  return {
    groupBy: 'Participant', weekStart: DAYS[0], days: DAYS, exceptions: [],
    participantRows: withRow ? [{ participantId: 'p-0001', fullName: 'Liam Okafor', shifts }] : [],
  } as unknown as RosterBoardDto
}

// Wed has only a Draft and Thu nothing, so two days print "No shifts"; the Cancelled shift shares Monday with a kept one.
const SEVEN = [
  shift(DAYS[0], '08:00:00', '17:00:00', 'Published', "Jack O'Sullivan"),
  shift(DAYS[0], '05:00:00', '05:30:00', 'Cancelled', 'Cancel Person'),
  shift(DAYS[1], '09:00:00', '15:00:00', 'InProgress', 'Priya Nair'),
  shift(DAYS[2], '06:00:00', '06:30:00', 'Draft', 'Draft Person'),
  shift(DAYS[4], '10:00:00', '14:00:00', 'PendingReview', 'Mary Jane Smith'),
  shift(DAYS[5], '11:00:00', '15:00:00', 'Completed', null, { staffName: 'Ghost Worker' }),
  shift(DAYS[6], '22:00:00', '07:00:00', 'Published', 'Tomas Reyes', { endsNextDay: true }),
]

// Four shifts a day, each with a first name found nowhere else, so a heading's page also proves where its names went.
const NAMES = ['Alba', 'Bruno', 'Celia', 'Dario', 'Elena', 'Fabio', 'Greta', 'Hugo', 'Irene', 'Jonas', 'Karin', 'Lukas', 'Marta', 'Nadia', 'Oscar', 'Petra', 'Quinn', 'Rosa', 'Sven', 'Talia', 'Ulla', 'Viktor', 'Wanda', 'Xenia', 'Yusuf', 'Zelda', 'André', 'Chloé']
const HEAVY = DAYS.flatMap((d, i) => [0, 1, 2, 3].map(j => shift(d, `${String(6 + j * 3).padStart(2, '0')}:00:00`, `${String(8 + j * 3).padStart(2, '0')}:00:00`, 'Published', `${NAMES[i * 4 + j]} Surname`)))

async function render(b: RosterBoardDto) {
  const pdf = await renderToBuffer(<ScheduleWeekDocument week={toScheduleWeek(b, 'p-0001', 'Liam Okafor', 'Synthetic Support')} />)
  const runs = textLines(pdf)
  return { pdf, runs, text: runs.map(r => r.text).join('\n') }
}

describe('ScheduleWeekPdf layout', () => {
  it('fits seven kept days on one page', async () => {
    const { pdf } = await render(board(SEVEN))
    expect(pageCount(pdf)).toBe(1)
  })

  it('prints the header, 7 day headings, first names, To be confirmed and (next day)', async () => {
    const { text } = await render(board(SEVEN))
    for (const s of ['Synthetic Support', 'Weekly schedule', 'Liam Okafor', 'Mon 7 Sep 2026 – Sun 13 Sep 2026', ...HEADINGS, 'Jack', 'Priya', 'Mary', 'Tomas', 'To be confirmed', '8am–5pm', '10pm–7am (next day)']) {
      expect(text, s).toContain(s)
    }
    expect(text.match(/No shifts$/gm)).toHaveLength(2)
  })

  it('prints no note, override, requirement, surname, stale name or product name', async () => {
    const { text } = await render(board(SEVEN))
    expect(text).toContain('Jack') // the positive control: the same string holds the real content
    for (const s of ['SECRET-NOTE', 'SECRET-OVERRIDE', 'SECRET-REQ', 'Sullivan', 'Smith', 'Ghost']) expect(text, s).not.toContain(s)
    expect(text).not.toMatch(/ODIP/i)
    expect(text).not.toMatch(/Bunya Support/)
  })

  it('leaves out Draft and Cancelled shifts', async () => {
    const { text } = await render(board(SEVEN))
    expect(text).toContain('8am–5pm')
    expect(text).not.toContain('6am–6:30am')
    expect(text).not.toContain('5am–5:30am')
    expect(text).not.toContain('Cancel Person')
    expect(text).not.toContain('Draft Person')
  })

  it('prints the header and No shifts this week. with no row', async () => {
    const { pdf, text } = await render(board(SEVEN, false))
    expect(text).toContain('Weekly schedule')
    expect(text).toContain('Liam Okafor')
    expect(text).toContain('No shifts this week.')
    expect(HEADINGS.filter(h => text.includes(h))).toHaveLength(0)
    expect(pageCount(pdf)).toBe(1)
  })

  it('carries the footer', async () => {
    const { text } = await render(board(SEVEN))
    expect(text).toContain('Page 1 of 1')
    expect(text).toContain('Generated')
  })

  it('never splits a day across pages, and repeats the name on page 2 only', async () => {
    const { pdf, runs } = await render(board(HEAVY))
    expect(pageCount(pdf)).toBe(2)
    HEADINGS.forEach((heading, i) => {
      const at = runs.find(r => r.text === heading)
      expect(at, heading).toBeDefined()
      const names = runs.filter(r => r.stream === at!.stream && NAMES.slice(i * 4, i * 4 + 4).includes(r.text))
      expect(names, heading).toHaveLength(4)
    })
    expect(runs.some(r => r.stream === 1 && r.text === 'Liam Okafor · 7–13 Sep')).toBe(true)
    expect(runs.some(r => r.stream === 0 && r.text.includes(' · 7–13 Sep'))).toBe(false)
  })
})

describe('toScheduleWeek', () => {
  it('takes the first word of the full name', () => {
    const week = toScheduleWeek(board(SEVEN), 'p-0001', 'Liam Okafor', null)
    expect(week.days[4].shifts[0].workerFirstName).toBe('Mary')
  })

  it('leaves the worker empty for an unfilled shift, whatever name it still carries', () => {
    const week = toScheduleWeek(board(SEVEN), 'p-0001', 'Liam Okafor', null)
    expect(week.days[5].shifts[0].workerFirstName).toBeNull()
  })

  it('sorts a day by start time and keeps nothing but times and the first name', () => {
    const late = shift(DAYS[0], '13:00:00', '14:00:00', 'Published', 'Late Person')
    const early = shift(DAYS[0], '07:00:00', '08:00:00', 'Published', 'Early Person')
    const week = toScheduleWeek(board([late, early]), 'p-0001', 'Liam Okafor', null)
    expect(week.days[0].shifts.map(s => s.workerFirstName)).toEqual(['Early', 'Late'])
    expect(Object.keys(week.days[0].shifts[0]).sort()).toEqual(['endTime', 'endsNextDay', 'startTime', 'workerFirstName'])
  })

  it('gives seven empty days for a staff-grouped board', () => {
    const staffBoard = { groupBy: 'Staff', weekStart: DAYS[0], days: DAYS, staffRows: [], unfilled: [], exceptions: [] } as unknown as RosterBoardDto
    const week = toScheduleWeek(staffBoard, 'p-0001', 'Liam Okafor', null)
    expect(week.days).toHaveLength(7)
    expect(week.days.every(d => d.shifts.length === 0)).toBe(true)
  })
})
