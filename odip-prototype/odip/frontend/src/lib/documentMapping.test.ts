import { describe, it, expect } from 'vitest'
import { DOCUMENT_MAPPING, fieldsForEntry, fieldsForDocument, getFieldMapping } from './documentMapping'

/**
 * PF-10.1 — totality + consistency coverage for the entry-allocation contract
 * (`entryPhase`) this branch adds to `DOCUMENT_MAPPING`, mirroring the codebase's existing
 * completeness-test convention (e.g. `enums.test.ts`'s ADL/checklist partition tests,
 * `ParticipantDocumentFieldMapTests.cs`'s reflection coverage). A field with no entry-owner,
 * or two entry-owners, is exactly the failure mode PF-10.1's Acceptance section calls out.
 */
describe('DOCUMENT_MAPPING entryPhase allocation (PF-10.1)', () => {
  it('every entry has a non-null entryPhase of intake or profile', () => {
    for (const entry of DOCUMENT_MAPPING) {
      expect(['intake', 'profile']).toContain(entry.entryPhase)
    }
  })

  it("fieldsForEntry('intake') and fieldsForEntry('profile') partition DOCUMENT_MAPPING exactly (total, no overlap)", () => {
    const intake = fieldsForEntry('intake')
    const profile = fieldsForEntry('profile')

    // Total: every field appears in exactly one of the two phases.
    const union = new Set([...intake, ...profile].map((e) => e.field))
    expect(union.size).toBe(DOCUMENT_MAPPING.length)
    expect(intake.length + profile.length).toBe(DOCUMENT_MAPPING.length)

    // No overlap: intersection is empty.
    const intakeFields = new Set(intake.map((e) => e.field))
    const overlap = profile.filter((e) => intakeFields.has(e.field))
    expect(overlap).toEqual([])
  })

  it('no duplicate field ids in DOCUMENT_MAPPING', () => {
    const fields = DOCUMENT_MAPPING.map((e) => e.field)
    expect(new Set(fields).size).toBe(fields.length)
  })

  it("every sources: ['shared'] field is entryPhase 'intake' (captured once, at Intake, per SPEC-05's allocation principle)", () => {
    const sharedEntries = DOCUMENT_MAPPING.filter((e) => e.sources.includes('shared'))
    expect(sharedEntries.length).toBeGreaterThan(0)
    for (const entry of sharedEntries) {
      expect(entry.entryPhase).toBe('intake')
    }
  })

  it('matches the field-count split measured against SPEC-05 PF-10.1\'s allocation tables', () => {
    // 144 total fields as of this branch: 61 Intake (39 of them sources: ['shared']) / 83 Profile.
    // A future field addition is expected to move these counts — this test exists to make an
    // accidental mass-reallocation (e.g. a bad refactor of the INTAKE_FIELDS set) fail loudly,
    // not to freeze the numbers forever.
    expect(DOCUMENT_MAPPING.length).toBe(144)
    expect(fieldsForEntry('intake').length).toBe(61)
    expect(fieldsForEntry('profile').length).toBe(83)
  })

  it('fieldsForDocument and fieldsForEntry remain independent queries (sources vs entryPhase)', () => {
    // Sanity: fieldsForDocument overlaps intake/profile on every shared field (by design), while
    // fieldsForEntry partitions exactly. These are deliberately different axes (which PDF renders
    // it vs which wizard captures it) — this test guards against someone "simplifying" one to
    // reuse the other.
    const sharedCount = DOCUMENT_MAPPING.filter((e) => e.sources.includes('shared')).length
    const intakeDocCount = fieldsForDocument('intake').length
    const profileDocCount = fieldsForDocument('profile').length
    expect(intakeDocCount + profileDocCount).toBe(
      DOCUMENT_MAPPING.filter((e) => e.sources.includes('intake')).length +
        DOCUMENT_MAPPING.filter((e) => e.sources.includes('profile')).length +
        2 * sharedCount,
    )
  })

  it('getFieldMapping resolves every field name present in DOCUMENT_MAPPING', () => {
    for (const entry of DOCUMENT_MAPPING) {
      expect(getFieldMapping(entry.field)).toBe(entry)
    }
  })
})
