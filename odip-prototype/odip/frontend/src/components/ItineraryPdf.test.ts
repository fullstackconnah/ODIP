import { describe, expect, it } from 'vitest'
import { generatedLine } from './ItineraryPdf'

describe('the itinerary PDF footer', () => {
  it('names the organisation, not the platform', () => {
    const line = generatedLine('Jo Care')
    expect(line).toMatch(/^Generated \d{1,2}\/\d{1,2}\/\d{4} · Jo Care$/)
    expect(line).not.toContain('Odip')
  })

  it('names nobody when the itinerary has no organisation', () => {
    expect(generatedLine(null)).toMatch(/^Generated \d{1,2}\/\d{1,2}\/\d{4}$/)
  })
})
