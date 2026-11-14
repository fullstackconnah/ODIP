import { describe, expect, it } from 'vitest'
import { generatedLine } from './ItineraryPdf'

describe('the itinerary PDF footer', () => {
  it("dates the footer with the provider's day when it is given one, in any device zone", () => {
    // "2/03/2026" or "02/03/2026" depending on the ICU build, like every default en-AU date.
    expect(generatedLine('Jo Care', '2026-03-02')).toMatch(/^Generated 0?2\/03\/2026 · Jo Care$/)
  })

  it('names the organisation, not the platform', () => {
    const line = generatedLine('Jo Care')
    expect(line).toMatch(/^Generated \d{1,2}\/\d{1,2}\/\d{4} · Jo Care$/)
    expect(line).not.toContain('Odip')
  })

  it('names nobody when the itinerary has no organisation', () => {
    expect(generatedLine(null)).toMatch(/^Generated \d{1,2}\/\d{1,2}\/\d{4}$/)
  })
})
