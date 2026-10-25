import { buildProfileStepPatch } from './participantPatchGroups'
import type { ParticipantFormData } from './participantSchema'
import type { PatchParticipantDto } from '@/api/types/participant-patch'

/** The wizard steps whose groups the caregiver form sends. One list for the draft body, the base and the review diff. */
export const PROFILE_STEP_GROUP_KEYS = ['keyIdentifiers', 'culturalDepth', 'medical', 'mobility', 'behaviourCognition', 'dailyLiving'] as const

/** The four collection groups and the column that identifies a row in each. */
export const COLLECTION_KEYS: Record<string, string> = {
  consents: 'consentType',
  healthConditions: 'conditionType',
  adlAssessments: 'adlType',
  checklistItems: 'itemType',
}

// Groups the Key Identifiers step builds but the caregiver cannot see or edit; the server drops them too. Left out, an untouched form equals its base.
const INTERNAL_GROUPS = ['preferredStaff', 'ndisPlan'] as const

/** One PatchParticipantDto for the whole form: every caregiver step's group patch merged. */
export function buildCaregiverWire(values: ParticipantFormData): PatchParticipantDto {
  const wire = PROFILE_STEP_GROUP_KEYS
    .map((k) => buildProfileStepPatch(k, values, false) ?? {})
    .reduce((acc, part) => ({ ...acc, ...part }), {} as Record<string, unknown>)
  for (const g of INTERNAL_GROUPS) delete wire[g]
  return wire as PatchParticipantDto
}

/** The one "same value" test, matching the server: null, undefined and '' are equal; objects and lists compare by content. */
export function norm(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
