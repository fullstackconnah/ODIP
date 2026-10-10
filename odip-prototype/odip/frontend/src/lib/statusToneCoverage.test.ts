import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { TONE, STATUS_TONE, statusClass, statusKey, toneForStatus, type Tone } from './tone'
import { getStatusColor } from './utils'
import {
  TRIP_STATUSES, BOOKING_STATUSES, RESERVATION_STATUSES, VEHICLE_ASSIGNMENT_STATUSES, ASSIGNMENT_STATUSES,
  SCHEDULED_ACTIVITY_STATUSES, TASK_PRIORITIES, TASK_ITEM_STATUSES, INCIDENT_SEVERITIES, INCIDENT_STATUSES,
  QSC_REPORTING_STATUSES, INSURANCE_STATUSES, PAYMENT_STATUSES, TRIP_CLAIM_STATUSES, CLAIM_LINE_ITEM_STATUSES,
  CLAIM_STATUSES, SHIFT_STATUSES, MEDICATION_STATUSES, MEDICATION_ADMINISTRATION_STATUSES, WITNESS_STATUSES,
  CONTACT_ROLE_STATUSES, PLAN_TYPES,
} from '@/api/types/enums'
import { LEAVE_STATUSES, LEAVE_STATUS_COLORS } from '@/api/types/leave'
import { NOTIFICATION_OUTBOX_STATUSES, NOTIFICATION_STATUS_COLORS } from '@/api/types/notifications'
import { CAREGIVER_SUBMISSION_STATUSES } from '@/api/types/caregiver'
import { BUDGET_STATUSES } from '@/api/types/funding'

/**
 * L3-02 guard: every status word the API can send has a deliberate tone, and a status nobody listed falls back to NEUTRAL, never to
 * the amber "awaiting a decision" pill.
 *
 * `STATUS_ENUMS` is the list of C# enums the UI prints as a status pill, with their values as the frontend's `as const` arrays. Two
 * guards hang off it:
 *  1. every value of every listed enum has a row in STATUS_TONE (always runs, also inside the Docker image build);
 *  2. every C# enum named `*Status` is either listed here or named in NOT_A_PILL with a reason, and each listed array matches the C# enum
 *     member for member, so a value or an enum added to the backend fails here until somebody has given it a tone (runs wherever the
 *     backend source sits next to the frontend: the Docker image copies the frontend alone, so there it skips).
 */
const STATUS_ENUMS: Record<string, readonly string[]> = {
  TripStatus: TRIP_STATUSES,
  BookingStatus: BOOKING_STATUSES,
  ReservationStatus: RESERVATION_STATUSES,
  VehicleAssignmentStatus: VEHICLE_ASSIGNMENT_STATUSES,
  AssignmentStatus: ASSIGNMENT_STATUSES,
  ScheduledActivityStatus: SCHEDULED_ACTIVITY_STATUSES,
  TaskPriority: TASK_PRIORITIES,
  TaskItemStatus: TASK_ITEM_STATUSES,
  IncidentSeverity: INCIDENT_SEVERITIES,
  IncidentStatus: INCIDENT_STATUSES,
  QscReportingStatus: QSC_REPORTING_STATUSES,
  InsuranceStatus: INSURANCE_STATUSES,
  PaymentStatus: PAYMENT_STATUSES,
  TripClaimStatus: TRIP_CLAIM_STATUSES,
  ClaimLineItemStatus: CLAIM_LINE_ITEM_STATUSES,
  ClaimStatus: CLAIM_STATUSES,
  ShiftStatus: SHIFT_STATUSES,
  MedicationStatus: MEDICATION_STATUSES,
  MedicationAdministrationStatus: MEDICATION_ADMINISTRATION_STATUSES,
  WitnessStatus: WITNESS_STATUSES,
  ContactRoleStatus: CONTACT_ROLE_STATUSES,
  PlanType: PLAN_TYPES,
  LeaveStatus: LEAVE_STATUSES,
  NotificationOutboxStatus: NOTIFICATION_OUTBOX_STATUSES,
  CaregiverSubmissionStatus: CAREGIVER_SUBMISSION_STATUSES,
  BudgetStatus: BUDGET_STATUSES,
}

/** C# enums called `*Status` that are never printed through a status pill, and why. */
const NOT_A_PILL: Record<string, string> = {
  AmbulantStatus: 'a mobility level, chosen from a list and printed as a plain label',
  MedicationCompetencyStatus: 'the result of the competency gate; the UI sees error codes and a flag, never the word',
  DemoTickStatus: 'the outcome of one demo-data top-up tick, read from logs and tests; no API sends it and no screen shows it',
  ApprovalStatus: 'what a call to approve (or preview) an agreement revision came to, between the service and its controller; the controller turns it into an HTTP status and the screen reads the reasons, never this word',
}

/** The extra enums the walk treats as statuses although their names do not end in "Status" (they are pills too). */
const STATUS_LIKE_NAMES = ['TaskPriority', 'IncidentSeverity', 'PlanType']

describe('every real status has a deliberate tone (L3-02)', () => {
  it('has a STATUS_TONE row for every value of every status enum the API sends', () => {
    const missing: string[] = []
    for (const [name, values] of Object.entries(STATUS_ENUMS)) {
      for (const value of values) if (toneForStatus(value) === undefined) missing.push(`${name}.${value}`)
    }
    expect(missing).toEqual([])
  })

  it('gives the values L3-02 listed the tone the owner and the design rules ask for', () => {
    const expected: Record<string, Tone> = {
      // Incidents: the register's colours agree with the dashboard's "Open incidents" tile (Closed and Resolved are not open).
      underreview: 'warning', escalated: 'danger', resolved: 'success', closed: 'neutral',
      // Claims: Approved is green for leave and witnesses too.
      ready: 'info', approved: 'success', declined: 'danger',
      // Not yet on the trip, or not yet confirmed: awaiting a decision, a hold running out, a queue.
      enquiry: 'warning', held: 'warning', waitlist: 'warning', requested: 'warning', booked: 'warning',
      researching: 'neutral', planned: 'neutral',
      published: 'info', pendingreview: 'warning', notstarted: 'neutral',
      notinvoiced: 'neutral', invoicesent: 'info', partial: 'warning', notclaimed: 'neutral', inclaim: 'info',
      accepted: 'success', revoked: 'danger', superseded: 'neutral',
      // Medication: a wrong-medication dose is as red as a refused or missed one.
      onhold: 'warning', ceased: 'danger', administered: 'success', refused: 'danger', withheld: 'warning', missed: 'danger', wrongmedication: 'danger',
      sent: 'success', failed: 'danger', skipped: 'neutral',
      // A participant's budget (phase 2a): on track is go, approaching and forecast over ask for attention without anything being over yet, over has gone past the limit.
      ontrack: 'success', approaching: 'warning', forecastover: 'warning', over: 'danger',
    }
    for (const [key, tone] of Object.entries(expected)) expect(toneForStatus(key), key).toBe(tone)
  })

  it('"In Progress" is INFO blue everywhere (owner decision), not the accessibility pink', () => {
    for (const word of ['InProgress', 'In Progress', 'inprogress']) expect(toneForStatus(word), word).toBe('info')
    expect(statusClass('InProgress')).toBe(TONE.info.solid)
    expect(statusClass('InProgress')).not.toBe(TONE.accessible.solid)
    expect(getStatusColor('InProgress')).toBe(TONE.info.solid)
    // The three enums that have the value: trips, tasks, shifts.
    for (const [name, values] of Object.entries(STATUS_ENUMS)) {
      if (values.includes('InProgress')) expect(toneForStatus('InProgress'), name).toBe('info')
    }
  })

  it('WrongMedication is danger, like Refused and Missed', () => {
    expect(toneForStatus('WrongMedication')).toBe('danger')
    expect(statusClass('WrongMedication')).toBe(TONE.danger.solid)
  })

  it('a status nobody listed is NEUTRAL, never the amber warning pill, in every helper that colours a status', () => {
    expect(statusClass('A Brand New Status')).toBe(TONE.neutral.solid)
    expect(getStatusColor('a brand new status')).toBe(TONE.neutral.solid)
    expect(getStatusColor('')).toBe(TONE.neutral.solid)
    expect(statusClass('constructor')).toBe(TONE.neutral.solid)
    // An explicit fallback still wins, for a caller that needs one.
    expect(statusClass('A Brand New Status', 'info')).toBe(TONE.info.solid)
  })

  it('never lets a status fall to the fallback by omission: the domain colour maps agree with the one table', () => {
    // A domain may override a word that means something else there; each override is listed, with its reason.
    const INTENTIONAL_OVERRIDES: Record<string, Tone> = { 'LEAVE_STATUS_COLORS.cancelled': 'neutral' } // a cancelled leave request is over, not a failure
    const maps: Record<string, Record<string, Tone>> = {
      LEAVE_STATUS_COLORS: LEAVE_STATUS_COLORS,
      NOTIFICATION_STATUS_COLORS: NOTIFICATION_STATUS_COLORS,
    }
    const disagreements: string[] = []
    for (const [mapName, map] of Object.entries(maps)) {
      for (const [key, tone] of Object.entries(map)) {
        const id = `${mapName}.${key}`
        if (INTENTIONAL_OVERRIDES[id] === tone) continue
        if (toneForStatus(key) !== tone) disagreements.push(`${id}: map says ${tone}, STATUS_TONE says ${toneForStatus(key)}`)
      }
    }
    expect(disagreements).toEqual([])
  })

  it('keeps STATUS_TONE keys in the shape statusKey builds (lower case, no spaces) and every value a real tone', () => {
    for (const [key, tone] of Object.entries(STATUS_TONE)) {
      expect(key).toBe(statusKey(key))
      expect(Object.keys(TONE), key).toContain(tone)
    }
  })
})

// ── The C# walk ──────────────────────────────────────────────────────────────

const BACKEND = resolve(__dirname, '../../../backend')
const HAS_BACKEND = existsSync(join(BACKEND, 'Odip.sln'))

function csFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['bin', 'obj', 'Migrations', 'node_modules', 'Odip.Tests'].includes(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) csFiles(full, out)
    else if (entry.name.endsWith('.cs')) out.push(full)
  }
  return out
}

function csharpEnums(): Map<string, string[]> {
  const enums = new Map<string, string[]>()
  const pattern = /(?:public|internal)\s+enum\s+(\w+)\s*(?::\s*\w+)?\s*\{([^}]*)\}/g
  for (const file of csFiles(BACKEND)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      const members = match[2]
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(',')
        .map(part => part.split('=')[0].trim())
        .filter(Boolean)
      enums.set(match[1], members)
    }
  }
  return enums
}

describe.skipIf(!HAS_BACKEND)('the C# enums and the frontend agree on every status (L3-02 guard)', () => {
  const enums = HAS_BACKEND ? csharpEnums() : new Map<string, string[]>()

  it('finds the backend enums (the walk is not silently empty)', () => {
    expect(enums.size).toBeGreaterThan(50)
    expect(enums.get('IncidentStatus')).toContain('Closed')
  })

  it('has every C# status enum either listed in STATUS_ENUMS or named in NOT_A_PILL', () => {
    const unclassified = [...enums.keys()]
      .filter(name => /Status$/.test(name) || STATUS_LIKE_NAMES.includes(name))
      .filter(name => !(name in STATUS_ENUMS) && !(name in NOT_A_PILL))
    expect(unclassified).toEqual([])
  })

  it('has every listed enum present in C# and its frontend array equal to the C# members', () => {
    const problems: string[] = []
    for (const [name, values] of Object.entries(STATUS_ENUMS)) {
      const members = enums.get(name)
      if (!members) { problems.push(`${name}: no such C# enum`); continue }
      const ts = [...values].sort().join(',')
      const cs = [...members].sort().join(',')
      if (ts !== cs) problems.push(`${name}: frontend [${ts}] vs C# [${cs}]`)
    }
    expect(problems).toEqual([])
  })

  it('names only enums that exist in the NOT_A_PILL list', () => {
    for (const name of Object.keys(NOT_A_PILL)) expect(enums.has(name), name).toBe(true)
  })
})
