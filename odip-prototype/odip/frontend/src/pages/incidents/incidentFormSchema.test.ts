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
