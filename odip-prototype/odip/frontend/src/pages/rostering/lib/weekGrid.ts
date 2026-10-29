import { addDays, format, parseISO } from 'date-fns'
import type { ShiftDto } from '@/api/types'
import { toMinutes } from '@/lib/planBlocks'

/** The time grid's geometry (spec 2026-10-29): 48 px an hour, every pointer. */
export const PX_PER_MIN = 0.8
export const DAY_PX = 1440 * PX_PER_MIN

export type Segment = { shift: ShiftDto; date: string; fromMin: number; toMin: number; part: 'whole' | 'first' | 'second' }
export type PlacedBlock = { seg: Segment; top: number; height: number; lane: number; lanes: number }
export type MoreTile = { top: number; height: number; lane: number; lanes: number; hidden: Segment[] }

/** A date-only string moved by whole days (parseISO, never `new Date('YYYY-MM-DD')`, so a DST week cannot shift it). */
export function nextDate(iso: string, delta = 1): string {
  return format(addDays(parseISO(iso), delta), 'yyyy-MM-dd')
}

/** The day columns a shift draws in: one, or two when it runs past midnight. An end of exactly 00:00 draws no second column. */
export function segmentsOf(shift: ShiftDto): Segment[] {
  const from = toMinutes(shift.startTime)
  const to = toMinutes(shift.endTime)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return []
  if (!shift.endsNextDay) return [{ shift, date: shift.serviceDate, fromMin: from, toMin: to, part: 'whole' }]
  if (to === 0) return [{ shift, date: shift.serviceDate, fromMin: from, toMin: 1440, part: 'whole' }]
  return [
    { shift, date: shift.serviceDate, fromMin: from, toMin: 1440, part: 'first' },
    { shift, date: nextDate(shift.serviceDate), fromMin: 0, toMin: to, part: 'second' },
  ]
}

/** This week's segments, plus the Monday tail of the previous Sunday's overnight shift. */
export function weekSegments(shifts: ShiftDto[], prevWeekShifts: ShiftDto[], days: string[]): Segment[] {
  const sunday = nextDate(days[0], -1)
  const tails = prevWeekShifts.filter(s => s.endsNextDay && s.serviceDate === sunday).flatMap(segmentsOf).filter(g => g.part === 'second')
  return [...shifts.flatMap(segmentsOf).filter(g => days.includes(g.date)), ...tails]
}

/** The box a segment is drawn in: never shorter than the tap floor, pinned to the day's bottom edge near midnight. */
export function drawnBox(seg: Segment, floorPx: number): { top: number; height: number } {
  const top = seg.fromMin * PX_PER_MIN
  const height = Math.max((seg.toMin - seg.fromMin) * PX_PER_MIN, floorPx)
  return top + height > DAY_PX ? { top: DAY_PX - height, height } : { top, height }
}

/** How many side-by-side lanes a day column of this width keeps (a lane stays at least 40 px). */
export function laneCap(colWidthPx: number): number {
  return Math.max(2, Math.floor((colWidthPx - 6 + 2) / 42))
}

/** Standard calendar packing on the DRAWN boxes. A cluster wider than `cap` lanes keeps cap - 1 and puts the rest behind one "+n" tile. */
export function packDay(segs: Segment[], floorPx: number, cap: number): { blocks: PlacedBlock[]; more: MoreTile[] } {
  const boxes = segs.map(seg => ({ seg, ...drawnBox(seg, floorPx) })).sort((a, b) => a.top - b.top || b.height - a.height)
  const blocks: PlacedBlock[] = []
  const more: MoreTile[] = []
  let cluster: ((typeof boxes)[number] & { lane: number })[] = []
  let laneEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    const lanes = laneEnds.length
    if (lanes <= cap) {
      cluster.forEach(b => blocks.push({ ...b, lanes }))
      return
    }
    cluster.filter(b => b.lane < cap - 1).forEach(b => blocks.push({ ...b, lanes: cap }))
    const hidden = cluster.filter(b => b.lane >= cap - 1)
    more.push({ top: Math.min(hidden[0].top, DAY_PX - floorPx), height: floorPx, lane: cap - 1, lanes: cap, hidden: hidden.map(b => b.seg) })
  }
  for (const b of boxes) {
    if (b.top >= clusterEnd) {
      if (cluster.length) flush()
      cluster = []
      laneEnds = []
      clusterEnd = -Infinity
    }
    let lane = laneEnds.findIndex(end => end <= b.top)
    if (lane < 0) lane = laneEnds.push(0) - 1
    laneEnds[lane] = b.top + b.height
    cluster.push({ ...b, lane })
    clusterEnd = Math.max(clusterEnd, b.top + b.height)
  }
  if (cluster.length) flush()
  return { blocks, more }
}

/** Where the scroller opens: an hour above the earliest shift that starts in the week (or the selected day), 6am when there is none. */
export function openingScrollTop(shifts: ShiftDto[], days: string[], day?: string): number {
  const inWeek = shifts.filter(s => days.includes(s.serviceDate))
  const onDay = day ? inWeek.filter(s => s.serviceDate === day) : []
  const starts = (onDay.length ? onDay : inWeek).map(s => toMinutes(s.startTime)).filter(Number.isFinite)
  const first = starts.length ? Math.min(...starts) : 7 * 60
  return Math.max(0, Math.floor((first - 60) / 60) * 60) * PX_PER_MIN
}
