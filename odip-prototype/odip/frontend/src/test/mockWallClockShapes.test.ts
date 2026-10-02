import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Fix B review F3: the real API never sends a provider-local WALL-CLOCK value with a zone ("2026-10-03T08:00:00.0000000": what a person typed
 * into a datetime-local input, or a calendar date held in a DateTime), while it sends every instant with a "Z". The mock sent some wall-clock
 * fields with a Z, so a mock-driven run exercised a shape production never produces and could not have caught a wall-clock helper that
 * reads the zone. This holds the mock to the real shape for the wall-clock fields it serves.
 *
 * The mock lives next to the frontend in the repository but is not copied into the frontend's Docker build context, so the guard skips there.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const MOCK = join(__dirname, '../../../mock-api/server.js')

/** Wall-clock fields the mock serves (IncidentDetailDto and StaffAvailabilityDto, see the Fix B inventory). */
const WALL_CLOCK_FIELDS = ['incidentDateTime', 'familyNotifiedAt', 'supportCoordinatorNotifiedAt', 'qscReportedAt', 'startDateTime', 'endDateTime']

function valuesOf(source: string, field: string): Array<{ line: number; value: string }> {
  const found: Array<{ line: number; value: string }> = []
  const pattern = new RegExp(`\\b${field}:\\s*'([^']*)'`, 'g')
  source.split('\n').forEach((text, index) => {
    for (const match of text.matchAll(pattern)) found.push({ line: index + 1, value: match[1] })
  })
  return found
}

describe.skipIf(!existsSync(MOCK))('the mock serves wall-clock fields in the real, zone-less shape (F3)', () => {
  it('still serves each of those fields somewhere (the scan is not silently empty)', () => {
    const source = readFileSync(MOCK, 'utf-8')
    for (const field of ['incidentDateTime', 'familyNotifiedAt', 'qscReportedAt', 'startDateTime']) {
      expect(valuesOf(source, field).length, field).toBeGreaterThan(0)
    }
  })

  it('has no wall-clock field with a trailing Z', () => {
    const source = readFileSync(MOCK, 'utf-8')
    const offenders: string[] = []
    for (const field of WALL_CLOCK_FIELDS) {
      for (const { line, value } of valuesOf(source, field)) {
        if (value.endsWith('Z')) offenders.push(`server.js:${line} ${field}: '${value}'`)
      }
    }
    expect(offenders).toEqual([])
  })
})
