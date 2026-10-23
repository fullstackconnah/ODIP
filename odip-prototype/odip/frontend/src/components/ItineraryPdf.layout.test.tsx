// @vitest-environment node
import { inflateSync } from 'node:zlib'
import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import type { ItineraryDto } from '@/api/types'
import { ItineraryDocument } from './ItineraryPdf'

interface TextRun { text: string; x: number; y: number; width: number; size: number }

/**
 * Text runs of a react-pdf document with their top-left origin (points). react-pdf writes each Text as q-nested
 * `1 0 0 1 dx dy cm` moves in a y-down page space and a `[<hex> kern ...] TJ` run, then moves right by the run's width.
 */
function textRuns(pdf: Buffer): TextRun[] {
  const raw = pdf.toString('latin1')
  const runs: TextRun[] = []
  for (let at = raw.indexOf('stream'); at >= 0; at = raw.indexOf('stream', at + 9)) {
    const start = raw[at + 6] === '\r' ? at + 8 : at + 7
    const end = raw.indexOf('endstream', start)
    let content = ''
    try { content = inflateSync(pdf.subarray(start, end)).toString('latin1') } catch { continue }
    if (!content.includes(' TJ')) continue
    const stack: { x: number; y: number }[] = []
    let pos = { x: 0, y: 0 }, size = 0, last: TextRun | undefined
    for (const line of content.split('\n')) {
      const move = /^1 0 0 1 (\S+) (\S+) cm$/.exec(line)
      if (line === 'q') stack.push({ ...pos })
      else if (line === 'Q') pos = stack.pop() ?? pos
      else if (move) {
        const dx = Number(move[1]), dy = Number(move[2])
        if (last) { last.width = dx; last = undefined } // the move right that follows a run is its width
        pos = { x: pos.x + dx, y: pos.y + dy }
      } else if (/ Tf$/.test(line)) size = Number(line.split(' ')[1])
      else if (line.endsWith(' TJ')) {
        const text = [...line.matchAll(/<([0-9a-f]+)>/g)].map(m => Buffer.from(m[1], 'hex').toString('latin1')).join('')
        last = { text, x: pos.x, y: pos.y, width: 0, size }
        runs.push(last)
      }
    }
  }
  return runs
}

const ORG = 'Northern Rivers Community Disability Support Services Incorporated trading as the Far North Coast Inclusion Network for People with Disability and Their Families'
const TRIP = 'Annual Northern Rivers Community Inclusion Weekend Away with Extended Family Visits'
const data = {
  tripId: 't', tripName: TRIP, organisationName: ORG, tripCode: 'TRP-0042', destination: 'Byron Bay', region: 'Northern Rivers', startDate: '2026-11-06', endDate: '2026-11-08',
  durationDays: 3, status: 'Confirmed', leadCoordinatorName: 'Priya Sharma', notes: null, participantCount: 4, staffCount: 3, totalEstimatedCost: 1200,
  participants: [], accommodation: [], vehicles: [], staff: [], days: [],
} as unknown as ItineraryDto

// Pins the wrap path of the header's left column (fix round 1 code, so this passed on first writing: no red step).
describe('the itinerary PDF header with a long organisation and trip name', () => {
  it.each([['staff', 'STAFF VERSION'], ['participant', 'PARTICIPANT VERSION']] as const)('wraps the %s version beside the badge instead of running under it', async (version, badgeText) => {
    const runs = textRuns(await renderToBuffer(<ItineraryDocument data={data} version={version} />))
    const org = runs.filter(r => r.size === 12 && r.text.trim() && ORG.includes(r.text.trim()))
    const title = runs.filter(r => r.size === 22)
    const badge = runs.find(r => r.text === badgeText)!

    expect(org.map(r => r.text).join(' ').replace(/\s+/g, ' ')).toBe(ORG)
    expect(new Set(org.map(r => r.y)).size).toBeGreaterThanOrEqual(2)
    expect(new Set(title.map(r => r.y)).size).toBeGreaterThanOrEqual(2)
    for (const r of [...org, ...title]) expect(r.x + r.width).toBeLessThan(badge.x)
  })
})
