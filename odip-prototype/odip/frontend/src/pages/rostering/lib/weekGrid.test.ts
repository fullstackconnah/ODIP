import { describe, expect, it } from 'vitest'
import { makeShift } from '../test-fixtures'
import { DAY_PX, drawnBox, laneCap, nextDate, openingScrollTop, packDay, segmentsOf, weekSegments, type Segment } from './weekGrid'

const WEEK = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
const at = (id: string, start: string, end: string, extra = {}) => makeShift({ id, serviceDate: '2026-11-03', startTime: `${start}:00`, endTime: `${end}:00`, ...extra })
const whole = (fromMin: number, toMin: number): Segment => ({ shift: at('a', '09:00', '10:00'), date: '2026-11-03', fromMin, toMin, part: 'whole' })

describe('segmentsOf', () => {
  it('a same-day shift is one whole segment', () => {
    const segs = segmentsOf(at('a', '09:00', '17:00'))
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ fromMin: 540, toMin: 1020, part: 'whole' })
  })

  it('an overnight shift splits at midnight', () => {
    const segs = segmentsOf(at('a', '22:00', '06:00', { endsNextDay: true }))
    expect(segs.map(s => [s.date, s.fromMin, s.toMin, s.part])).toEqual([
      ['2026-11-03', 1320, 1440, 'first'],
      ['2026-11-04', 0, 360, 'second'],
    ])
  })

  it('a 24-hour shift splits into 09:00-24:00 and 00:00-09:00', () => {
    const segs = segmentsOf(at('a', '09:00', '09:00', { endsNextDay: true }))
    expect(segs.map(s => [s.fromMin, s.toMin])).toEqual([[540, 1440], [0, 540]])
  })

  it('ending at exactly midnight gives no second segment', () => {
    const segs = segmentsOf(at('a', '23:45', '00:00', { endsNextDay: true }))
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ fromMin: 1425, toMin: 1440, part: 'whole' })
  })
})

describe('weekSegments', () => {
  it("this Sunday's overnight keeps only its Sunday half in this week", () => {
    const sun = at('a', '22:00', '06:00', { serviceDate: '2026-11-08', endsNextDay: true })
    const segs = weekSegments([sun], [], WEEK)
    expect(segs.map(s => [s.date, s.part])).toEqual([['2026-11-08', 'first']])
  })

  it("the previous Sunday's overnight draws its tail on Monday", () => {
    const prevSun = at('p', '22:00', '06:00', { serviceDate: '2026-11-01', endsNextDay: true })
    const prevSat = at('q', '22:00', '06:00', { serviceDate: '2026-10-31', endsNextDay: true })
    const segs = weekSegments([], [prevSun, prevSat], WEEK)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ date: '2026-11-02', fromMin: 0, toMin: 360, part: 'second' })
  })

  it('a same-board fixture (prev equals the week) adds no tail', () => {
    const own = at('a', '22:00', '06:00', { serviceDate: '2026-11-03', endsNextDay: true })
    const segs = weekSegments([own], [own], WEEK)
    expect(segs.map(s => s.part)).toEqual(['first', 'second'])
  })
})

describe('drawnBox', () => {
  it('the minimum height and the midnight pin', () => {
    expect(drawnBox(whole(540, 555), 24).height).toBeCloseTo(24, 3)
    expect(drawnBox(whole(540, 555), 44).height).toBeCloseTo(44, 3)
    const pinned = drawnBox(whole(1425, 1440), 44)
    expect(pinned.top).toBeCloseTo(1108, 3)
    expect(pinned.top + pinned.height).toBeCloseTo(DAY_PX, 3)
  })
})

describe('packDay', () => {
  const segs = (...shifts: ReturnType<typeof at>[]) => shifts.flatMap(segmentsOf)

  it('two 15-minute shifts 15 minutes apart take two lanes (drawn extent)', () => {
    const { blocks } = packDay(segs(at('a', '09:00', '09:15'), at('b', '09:15', '09:30')), 24, 3)
    expect(blocks.map(b => [b.lane, b.lanes])).toEqual([[0, 2], [1, 2]])
  })

  it('touching shifts share a lane', () => {
    const { blocks } = packDay(segs(at('a', '09:00', '10:00'), at('b', '10:00', '11:00')), 24, 3)
    expect(blocks.map(b => [b.lane, b.lanes])).toEqual([[0, 1], [0, 1]])
  })

  it('three overlapping shifts under a cap of 2 give one block and a +2 tile', () => {
    const three = segs(at('a', '09:00', '11:00'), at('b', '09:30', '11:00'), at('c', '10:00', '11:00'))
    const capped = packDay(three, 24, 2)
    expect(capped.blocks).toHaveLength(1)
    expect(capped.more).toHaveLength(1)
    expect(capped.more[0]).toMatchObject({ lane: 1, lanes: 2 })
    expect(capped.more[0].hidden).toHaveLength(2)
    expect(capped.more[0].top).toBeCloseTo(9.5 * 48, 3)
    const wide = packDay(three, 24, 3)
    expect(wide.blocks).toHaveLength(3)
    expect(wide.more).toHaveLength(0)
  })
})

describe('laneCap', () => {
  it('follows the column width with a floor of 2', () => {
    expect([89, 94, 136, 270, 40].map(laneCap)).toEqual([2, 2, 3, 6, 2])
  })
})

describe('a DST week keeps wall-clock rows', () => {
  it('spring forward: a Saturday overnight splits onto Sunday 4 October', () => {
    const week = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
    const sat = at('a', '22:00', '06:00', { serviceDate: '2026-10-03', endsNextDay: true })
    const segs = weekSegments([sat], [], week)
    expect(segs.map(s => [s.date, s.fromMin, s.toMin])).toEqual([['2026-10-03', 1320, 1440], ['2026-10-04', 0, 360]])
    expect(drawnBox(segs[0], 24).top).toBeCloseTo(1056, 3)
  })

  it('fall back: nextDate crosses 5 April and a 01:00-03:00 shift stays at 60-180', () => {
    expect(nextDate('2026-04-04')).toBe('2026-04-05')
    const week = ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05']
    const segs = weekSegments([at('a', '01:00', '03:00', { serviceDate: '2026-04-05' })], [], week)
    expect(segs[0]).toMatchObject({ fromMin: 60, toMin: 180 })
  })
})

describe('openingScrollTop', () => {
  const px = (h: number) => h * 60 * 0.8

  it('opens an hour before the first shift', () => {
    expect(openingScrollTop([at('a', '06:00', '10:00')], WEEK)).toBeCloseTo(px(5), 3)
    expect(openingScrollTop([at('a', '06:59', '10:00')], WEEK)).toBeCloseTo(px(5), 3)
    expect(openingScrollTop([at('a', '00:30', '02:00')], WEEK)).toBe(0)
  })

  it('an empty week opens at 6am', () => {
    expect(openingScrollTop([], WEEK)).toBeCloseTo(px(6), 3)
  })

  it('a Monday tail never counts: only the week own shifts are passed', () => {
    expect(openingScrollTop([at('a', '09:00', '10:00')], WEEK)).toBeCloseTo(px(8), 3)
  })

  it('the day view uses its day and falls back to the week', () => {
    const shifts = [at('a', '09:00', '10:00', { serviceDate: '2026-11-03' }), at('b', '13:00', '14:00', { serviceDate: '2026-11-04' })]
    expect(openingScrollTop(shifts, WEEK, '2026-11-04')).toBeCloseTo(px(12), 3)
    expect(openingScrollTop(shifts, WEEK, '2026-11-05')).toBeCloseTo(px(8), 3)
  })
})
