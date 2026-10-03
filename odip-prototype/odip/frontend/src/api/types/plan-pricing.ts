import type { AgreementState } from './service-agreement-drafts'

// The plan builder's wire types: the pricing engine's own block (PlanBlock) and its answer (PlanQuote), as POST api/v1/plan-pricing/quote
// reads and writes them, and the provider's pricing settings. Enums travel as their names, local times as "HH:mm:ss", dates as "YYYY-MM-DD",
// and a null member is left out, so every optional member here is genuinely absent when it has no value.

export type PlanDayName = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday'
export type PlanSupportType = 'PersonalCare' | 'CommunityAccess' | 'GroupActivity' | 'StaSupport'
export type PlanSupportIntensity = 'Standard' | 'HighIntensity' | 'Icbs'
export type PlanSetting = 'Community' | 'Centre' | 'AtHome' | 'Accommodation'
export type PlanHolidayDecision = 'Review' | 'Charge' | 'Skip'
export type PlanVehicle = 'Standard' | 'Accessible'
export type PlanPriceZone = 'National' | 'Remote' | 'VeryRemote'

export interface PlanLocation {
  state: AgreementState
  zone: PlanPriceZone
  /** The Modified Monash level 1-7 when known; the builder does not ask for it. */
  mm?: number
}

export interface PlanSleepoverWindow { from: string; to: string }
export interface PlanHeadcountChange { from: string; participantsPresent: number }

export interface PlanProviderTravel {
  claim: boolean
  minutesEachWay: number
  returnToBase: boolean
  /** Left out, it is every participant present. */
  participantsSharing?: number
  kmEachWay: number
}

export interface PlanActivityTransport {
  km: number
  vehicle: PlanVehicle
  tolls: number
  parking: number
  participantsSharing?: number
}

export interface PlanAccommodation { nights: number; workerOnSite: boolean }

/** One weekly routine of one support type, exactly as the engine takes it. The client never puts a price or a catalogue code on it. */
export interface PlanBlock {
  id: string
  supportType: PlanSupportType
  intensity: PlanSupportIntensity
  days: PlanDayName[]
  start: string
  end: string
  workers: number
  participantsPresent: number
  headcountChanges: PlanHeadcountChange[]
  setting: PlanSetting
  location: PlanLocation
  workerMaySleep: boolean
  sleepoverWindow?: PlanSleepoverWindow
  sleepoverActiveHours: number
  onPublicHoliday: PlanHolidayDecision
  travel?: PlanProviderTravel
  transport?: PlanActivityTransport
  accommodation?: PlanAccommodation
}

export type PlanWorkerGender = 'NoPreference' | 'Female' | 'Male'
export type PlanSkill = 'FirstAid' | 'MedicationCompetent' | 'ManualHandling'

/** What the shifts of a block ask of a worker: chips, never names. The engine does not read it; the roster patterns an approved revision creates will. */
export interface PlanBlockRequirements {
  workerGender: PlanWorkerGender
  driver: boolean
  skills: PlanSkill[]
}

/** A block of a draft revision: the engine's block and the worker requirements beside it. */
export interface DraftBlock {
  block: PlanBlock
  requirements: PlanBlockRequirements
}

// ── The answer ────────────────────────────────────────────────────────────────

/** Why something could not be priced or was refused. Typed, so the screen can say what to do about each. */
export type PlanFailureReason =
  | 'InvalidInput' | 'RegistrationGroupNotHeld' | 'StaLegacyNotSupported' | 'NoItem' | 'CatalogueNotFound' | 'CatalogueAmbiguous'
  | 'ZoneNotEligible' | 'CatalogueNotPriced' | 'UnexpectedUnit' | 'SleepoverNotAvailable' | 'SleepoverNotQualifying' | 'TransportNotAvailable'
  | 'AccommodationNotAvailable' | 'TravelNotClaimable' | 'SleepoverClockChange' | 'NamedDateNotInCalendar' | 'BlocksOverlap' | 'SupportInSkippedHour'

export type PlannedLineKind =
  | 'Support' | 'Sleepover' | 'SleepoverActiveHours' | 'ProviderTravelTime' | 'ProviderTravelCosts' | 'ActivityTransport'
  | 'CentreCapital' | 'ParticipantAccommodation' | 'WorkerAccommodation'

/** The engine's flags as the API writes them: "None", or the names joined by ", " ("Review, HolidayExposure"). */
export type PlannedLineFlags = string

export interface PlannedLineTrace {
  rules: string[]
  why: string
  catalogueVersion?: string
  priceBasisFrom?: string
  sourceDocument?: string
  zone: PlanPriceZone
  maximumUnitPrice?: number
  workers: number
  participantsPresent: number
  policy?: string
  holidayName?: string
  openQuestions: number[]
}

export interface PlannedLine {
  blockId: string
  kind: PlannedLineKind
  itemCode?: string
  /** H hour, E each (a dollar line is quantity x $1.00), D day or night. */
  unit: string
  qty: number
  unitPrice: number
  /** Authoritative: add up and claim totals, never quantity x unit price. */
  total: number
  serviceDate: string
  startTime?: string
  endDate?: string
  endTime?: string
  band: string
  dayType?: string
  paceCategory?: number
  flags: PlannedLineFlags
  unpriced?: PlanFailureReason
  shortNoticeCancellationAllowed: boolean
  trace: PlannedLineTrace
  isPriced?: boolean
  review?: boolean
  holidayExposure?: boolean
  provisional?: boolean
}

export interface PlanIssue {
  blockId: string
  reason: PlanFailureReason
  message: string
  count: number
  firstDate?: string
}

export interface PlanNotice { code: string; message: string; openQuestion?: number }

export interface PlanHolidayOccurrence {
  blockId: string
  date: string
  holidayName: string
  state?: string
  decision: PlanHolidayDecision
  skipped: boolean
  atHolidayRates?: number
  atOrdinaryRates?: number
  uplift?: number
}

export interface PlanOwnerQuestion { number: number; text: string }
export interface PlanCategoryTotal { paceCategory: number; name: string; amount: number; hours: number }
export interface PlanBlockTotal { blockId: string; amount: number; supportHours: number; occurrences: number; skippedOccurrences: number }

export interface PlanTotals {
  amount: number
  supportHours: number
  lineCount: number
  unpricedLines: number
  reviewLines: number
  provisionalLines: number
  holidayOccurrences: number
  holidayUplift: number
  byCategory: PlanCategoryTotal[]
  byBlock: PlanBlockTotal[]
}

export interface PlanQuote {
  periodFrom: string
  periodTo: string
  lines: PlannedLine[]
  issues: PlanIssue[]
  notices: PlanNotice[]
  holidayOccurrences: PlanHolidayOccurrence[]
  openQuestions: PlanOwnerQuestion[]
  totals: PlanTotals
  /** "tz-database" or "fixed+10:00" (the host had no tz database: a night the clocks change is then an ordinary night). */
  timeBasis: string
  needsReview: boolean
}

export interface PlanQuoteRequest {
  blocks: PlanBlock[]
  periodFrom: string
  periodTo: string
  /** False leaves the per-occurrence lines out: a running budget only needs the totals, issues, notices and holiday exposure. */
  includeLines: boolean
}

// ── The provider's pricing settings ───────────────────────────────────────────

export type PlanCrossingPolicy = 'Split' | 'HigherOf'
export type PlanGroupOutingFamily = 'GroupActivities' | 'CommunityAccess'

export interface PlanPricingSettingsDto {
  registrationGroupsHeld: string[]
  registrationGroupsConfirmed: boolean
  crossingPolicy: PlanCrossingPolicy
  claimProviderTravel: boolean
  travelKmRateStandard: number
  travelKmRateAccessible: number
  travelRatesProvisional: boolean
  groupOutings: PlanGroupOutingFamily
  staUsesHourlyAndAccommodation: boolean
  approverRoles: string[]
  /** True when nothing is stored yet and these are the owner-approved defaults. */
  isDefault: boolean
}

/** Each field changes only when it is sent, so a stale form can never undo a setting it does not know about. */
export type UpdatePlanPricingSettingsDto = Partial<Omit<PlanPricingSettingsDto, 'isDefault' | 'staUsesHourlyAndAccommodation'>>
