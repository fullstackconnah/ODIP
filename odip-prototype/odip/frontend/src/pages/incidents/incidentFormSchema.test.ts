import { describe, it, expect } from 'vitest'
import { incidentSchema, restrictivePracticeSchema } from './incidentFormSchema'
import { buildRpIncidentDescriptionSkeleton } from '@/lib/incidentPrefill'

const skeleton = buildRpIncidentDescriptionSkeleton({ description: 'Two-person hold during transfers.', reviewDate: null })

/** A Restrictive practice incident that passes everything else, so only the description rule decides. */
const rpIncident = {
  title: 'Held at the kerb', reportedByStaffId: 'staff-1', incidentType: 'RestrictivePracticeUse', severity: 'Medium',
  incidentDateTime: '2026-10-13T10:00', injuries: [], witnesses: [],
  involvedParticipantId: 'participant-1', restrictivePracticeType: 'PhysicalRestraint',
}

function descriptionErrors(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return result.success ? [] : result.error!.issues.filter((i) => i.path[0] === 'description').map((i) => i.message)
}

// Compliance (owner decision 2026-10-14): when the use was not authorised, the description must be the reporter's own words. An untouched
// prefilled skeleton counts as missing, whichever way the description got there.
describe('incident description on the unauthorised-use path', () => {
  it('blocks a ticked "This use was not authorised" whose description is still exactly the skeleton', () => {
    const values = { ...rpIncident, restrictivePracticeId: 'rp-a', usedWithoutAuthorisation: true, description: `  ${skeleton}\n`, rpDescriptionSkeleton: skeleton }
    expect(descriptionErrors(restrictivePracticeSchema.safeParse(values))).toEqual(['Describe what was actually done.'])
    expect(descriptionErrors(incidentSchema.safeParse(values))).toContain('Describe what was actually done.')
  })

  it('accepts the skeleton once the reporter has added their own words to it', () => {
    const values = { ...rpIncident, restrictivePracticeId: 'rp-a', usedWithoutAuthorisation: true, description: `${skeleton}\nHeld his arms at the kerb.`, rpDescriptionSkeleton: skeleton }
    expect(descriptionErrors(restrictivePracticeSchema.safeParse(values))).toEqual([])
  })

  it('blocks "None of these" when the description is still exactly the skeleton left from a practice picked earlier', () => {
    const values = { ...rpIncident, unapprovedRestrictivePracticeDetails: 'Held both arms.', description: skeleton, rpDescriptionSkeleton: skeleton }
    expect(descriptionErrors(incidentSchema.safeParse(values))).toEqual(['Description is required'])
  })

  it('leaves an Authorised use alone: the skeleton is a fine starting description there', () => {
    const values = { ...rpIncident, restrictivePracticeId: 'rp-a', usedWithoutAuthorisation: false, description: skeleton, rpDescriptionSkeleton: skeleton }
    expect(incidentSchema.safeParse(values).success).toBe(true)
  })
})

// N1 incident clock (S2): the class, its reason and the aware time are optional on create (no awareAt submitted), and the reason is
// required only when an edit moves the class off the default for the form's own severity and type.
describe('reporting deadline reason', () => {
  const edit = { ...rpIncident, incidentType: 'Injury', severity: 'Medium', injuries: [{ region: 'Head', injuryType: 'Bruise', description: 'x' }], description: 'Fell.' }
  const reasonErrors = (values: object) => {
    const r = incidentSchema.safeParse(values)
    return r.success ? [] : r.error.issues.filter((i) => i.path[0] === 'reportableClassReason').map((i) => i.message)
  }

  it('create submits with no awareAt and no class', () => {
    expect(reasonErrors(edit)).toEqual([])
  })
  it('an edit that keeps the default needs no reason', () => {
    expect(reasonErrors({ ...edit, reportableClass: 'None' })).toEqual([])
  })
  it('an edit that overrides the default needs a reason', () => {
    expect(reasonErrors({ ...edit, reportableClass: 'Within24h' })).toEqual(['Give a reason for changing the reporting deadline.'])
    expect(reasonErrors({ ...edit, reportableClass: 'Within24h', reportableClassReason: '   ' })).toHaveLength(1)
    expect(reasonErrors({ ...edit, reportableClass: 'Within24h', reportableClassReason: 'Family asked us to.' })).toEqual([])
  })
  it('judges the default against the edited severity', () => {
    expect(reasonErrors({ ...edit, severity: 'Critical', reportableClass: 'Within24h' })).toEqual([])
  })
})

// N1 incident clock: the server defaults the class from the stored authorisation flag too, so the reason rule must see it.
describe('reportable class reason (edit)', () => {
  const injury = {
    title: 'Fell at the kerb', reportedByStaffId: 'staff-1', incidentType: 'Injury', severity: 'Medium', description: 'Tripped.',
    incidentDateTime: '2026-10-13T10:00', injuries: [{ region: 'Head', injuryType: 'Bruise', description: 'Bump' }], witnesses: [],
    involvedParticipantId: 'participant-1',
  }
  const reasonIssues = (values: object) => {
    const result = incidentSchema.safeParse(values)
    return result.success ? [] : result.error.issues.filter((i) => i.path[0] === 'reportableClassReason')
  }

  it('needs no reason for Within24h when the stored flag is unauthorised', () => {
    expect(reasonIssues({ ...injury, isRestrictivePracticeAuthorised: false, reportableClass: 'Within24h' })).toEqual([])
  })

  it('still asks for a reason once the flag leaves the default at None', () => {
    expect(reasonIssues({ ...injury, isRestrictivePracticeAuthorised: true, reportableClass: 'Within24h' })).toHaveLength(1)
  })
})
