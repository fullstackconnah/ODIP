import { describe, expect, it } from 'vitest'
import { buildCaregiverWire } from './caregiverPayload'
import type { ParticipantFormData } from './participantSchema'

// Alcohol is a Holiday/STA consent (HOLIDAY_STA_CONSENT_TYPES); PhotoVideo is not.
const values = {
  consents: [{ consentType: 'PhotoVideo', granted: 'true' }, { consentType: 'Alcohol', granted: 'true' }],
} as unknown as ParticipantFormData

const typesSent = (wire: { consents?: { consentType: string }[] }) => wire.consents?.map((c) => c.consentType)

describe('buildCaregiverWire', () => {
  it('leaves the Holiday/STA consents out by default, as the form hides them', () => {
    expect(typesSent(buildCaregiverWire(values))).toEqual(['PhotoVideo'])
  })

  it('sends them when the form shows them (staVisible true)', () => {
    expect(typesSent(buildCaregiverWire(values, true))).toEqual(['PhotoVideo', 'Alcohol'])
  })
})
