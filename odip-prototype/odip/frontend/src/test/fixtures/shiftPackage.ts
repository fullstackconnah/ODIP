import type {
  PortalAtAGlanceDto,
  PortalShiftDetailDto,
  ShiftCompletionDto,
} from '@/api/types'

/**
 * Fixtures for the shift-package fields added to PortalShiftDetailDto / ShiftCompletionDto (PR 1). Spread the "empty" helpers
 * into an existing fixture so a test that does not care about the package still type-checks against the extended DTOs, and use
 * the richer builders below when a test does.
 */

/** Every at-a-glance field "Not recorded" (null), every HIDPA flag off. */
export function emptyAtAGlance(): PortalAtAGlanceDto {
  return {
    allergies: { detail: null, isAnaphylaxisRisk: null, managementNotes: null },
    diet: { chokingRiskDetail: null, pegRegimeDetail: null, modifiedDietDetail: null, mealAssistanceDetail: null, medicationTricks: null },
    communication: { expressiveSkills: null, receptiveSkills: null, readingAbility: null, aids: null },
    behaviour: { triggers: null, earlyWarningSigns: null, deEscalationStrategies: null, whatNotToDo: null, whatHelpsMeCalmDown: null },
    hidpa: { epilepsy: false, enteralFeeding: false, dysphagia: false },
    address: { street: null, suburb: null, state: null, postcode: null },
  }
}

type PackageFields = Pick<
  PortalShiftDetailDto,
  | 'breaks' | 'handover' | 'handoverTrail' | 'finishBlockers' | 'timeZoneId' | 'atAGlance' | 'emergencyContacts'
  | 'medicationsDue' | 'prn' | 'shiftRoutines' | 'canRecordDoses' | 'canRecordDosesReason' | 'canRecordDosesReasonCode'
  | 'sensitiveInfoWithheldReason'
>

/** The shift-package fields of a shift detail, all empty: no breaks, no handover, no doses, nothing recorded, a competent worker. */
export function emptyShiftPackage(overrides: Partial<PackageFields> = {}): PackageFields {
  return {
    breaks: [],
    handover: null,
    handoverTrail: [],
    finishBlockers: [],
    timeZoneId: 'Australia/Brisbane',
    atAGlance: emptyAtAGlance(),
    emergencyContacts: [],
    medicationsDue: [],
    prn: [],
    shiftRoutines: [],
    canRecordDoses: true,
    canRecordDosesReason: null,
    canRecordDosesReasonCode: null,
    sensitiveInfoWithheldReason: null,
    ...overrides,
  }
}

type CompletionPackageFields = Pick<
  ShiftCompletionDto,
  'breaks' | 'breakMinutes' | 'netWorkedMinutes' | 'handoverText' | 'nothingToHandOver' | 'nothingToNoteConfirmed'
>

/** The shift-package fields of a completion, empty: no breaks, nothing handed over or confirmed. */
export function emptyCompletionPackage(overrides: Partial<CompletionPackageFields> = {}): CompletionPackageFields {
  return {
    breaks: [],
    breakMinutes: 0,
    netWorkedMinutes: 0,
    handoverText: null,
    nothingToHandOver: false,
    nothingToNoteConfirmed: false,
    ...overrides,
  }
}
