import type { TripStatus } from '@/api/types/enums'

/**
 * The tone system: what red, amber, green, slate and pink MEAN in ODIP, decided in this one file.
 *
 * A tone is one of the existing semantic colours (DESIGN.md, The Semantic Colour Rule and The Tone Rule): statuses map to
 * tones, tones map to colours that are already in the palette, and nothing here is a new colour. Never add a colour per
 * status; add a status to `STATUS_TONE`.
 *
 * Every class string below is a complete Tailwind class, written out in full so the scanner can see it (a class assembled
 * at run time never reaches the stylesheet). Kept JSX-free, so any component or helper file can import it without
 * react-refresh caring.
 *
 * Colour is never the only cue: whatever wears a tone also prints its text (a status word, a count, an "Action Needed").
 * `src/test/toneContrast.test.ts` reads src/index.css and holds every pair below to WCAG AA (4.5:1).
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accessible'

export type ToneClasses = {
  /** The container fill with its on-container text, as one pair: a badge, a chip, a glance cell, an attention tile. */
  solid: string
  /** A wash for something larger than a pill (a tile, a row, a banner). Pair it with `ink`. */
  soft: string
  /** Text only: a figure or a line on the card, or on the `soft` wash. */
  ink: string
}

export const TONE: Record<Tone, ToneClasses> = {
  // No state: a draft, "none", an archived record. Also the category tone of a self-managed plan (see STATUS_TONE).
  neutral: {
    solid: 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]',
    soft: 'bg-[var(--color-surface-container)]',
    ink: 'text-[var(--color-muted-foreground)]',
  },
  // Information and categories: submitted, low priority, NDIA-managed.
  info: {
    solid: 'bg-[var(--color-secondary-container)] text-[var(--color-info)]',
    soft: 'bg-[var(--color-secondary-container)]/60',
    ink: 'text-[var(--color-info)]',
  },
  // "Go", confirmed, paid, all clear.
  success: {
    solid: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
    soft: 'bg-[var(--color-primary-fixed)]/40',
    ink: 'text-[var(--color-primary)]',
  },
  // Pending or time-bound: awaiting a decision, a waitlist, an expiry coming up.
  warning: {
    solid: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
    soft: 'bg-[var(--color-warning-container)]',
    ink: 'text-[var(--color-on-warning-container)]',
  },
  // Action needed, overdue, rejected, cancelled.
  danger: {
    solid: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
    soft: 'bg-[var(--color-error-container)]/30',
    ink: 'text-[var(--color-destructive)]',
  },
  // Accessibility, and the plan-manager and shift-claim categories that already use its pink. Never a state: "In progress" is info.
  accessible: {
    solid: 'bg-[var(--color-accessible-container)] text-[var(--color-on-accessible-container)]',
    soft: 'bg-[var(--color-accessible-container)]/60',
    ink: 'text-[var(--color-on-accessible-container)]',
  },
}

/** Tone words the older props still use: Callout's `error`, FactChip's `positive` and `negative`. They keep working. */
const TONE_ALIAS = { error: 'danger', positive: 'success', negative: 'danger' } as const
export type ToneAlias = keyof typeof TONE_ALIAS

export function toneOf(tone: Tone | ToneAlias): Tone {
  return Object.hasOwn(TONE_ALIAS, tone) ? TONE_ALIAS[tone as ToneAlias] : (tone as Tone)
}

export function isTone(value: string): value is Tone {
  return Object.hasOwn(TONE, value)
}

/** The soft wash of a `Card`. Card paints its own `bg-card`, so the wash needs the important modifier to win; a neutral tile stays on the card. */
export const CARD_WASH: Record<Tone, string> = {
  neutral: '',
  info: '!bg-[var(--color-secondary-container)]/60',
  success: '!bg-[var(--color-primary-fixed)]/40',
  warning: '!bg-[var(--color-warning-container)]',
  danger: '!bg-[var(--color-error-container)]/30',
  accessible: '!bg-[var(--color-accessible-container)]/60',
}

/** A pill that sits on a tinted (warning or danger) surface: the tone's own text colour on the card fill, so it does not vanish into the tint. */
export const ON_TINT: Partial<Record<Tone, string>> = {
  warning: 'bg-[var(--color-card)] text-[var(--color-on-warning-container)]',
  danger: 'bg-[var(--color-card)] text-[var(--color-on-error-container)]',
}

/**
 * Which tones ask for attention, and the container they fill with (The Attention Tint Rule): a warning tone fills with the
 * warning container, a danger tone with the error container. Every other tone is quiet: an all-clear is a chip, never a fill.
 */
export type Attention = 'warning' | 'error'

export function attentionOf(tone: Tone): Attention | undefined {
  if (tone === 'warning') return 'warning'
  if (tone === 'danger') return 'error'
  return undefined
}

/**
 * A status word to its tone, keyed the way StatusBadge keys it (`statusKey`: lower case, no spaces). Every status the API can send
 * has a row here (`src/lib/statusToneCoverage.test.ts` walks the C# enums and fails for a value or an enum with no tone), so a
 * status is never coloured by omission. A status that has no row anyway is NEUTRAL (see `statusClass`): an unknown word must never
 * claim "awaiting a decision". A `colorMap` on a StatusBadge overrides this for one domain whose word means something else there.
 *
 * How to read the tones, for a new status: neutral is "no state yet or no longer" (a draft, nothing started, closed, none); info is
 * "in the pipeline, nothing wrong" (submitted, ready, in progress, validated); success is done or good; warning is awaiting somebody
 * (a decision, a reply, a confirmation, a hold running out, a waitlist); danger is a failure, a refusal or something that needs action.
 */
export const STATUS_TONE: Record<string, Tone> = {
  // Booking / General
  confirmed: 'success',
  completed: 'success',
  available: 'success',
  active: 'success',
  draft: 'neutral',
  proposed: 'neutral',
  none: 'neutral',
  archived: 'neutral',
  cancelled: 'danger',
  unavailable: 'danger',
  nolongerattending: 'danger',
  expired: 'danger',
  inactive: 'danger',
  overdue: 'danger',
  conflict: 'danger',

  // Decisions: a request, claim, witness or submission that somebody has answered. Leave's cancelled is its own (neutral) override.
  approved: 'success',
  accepted: 'success',
  declined: 'danger',
  revoked: 'danger',

  // Severity, and task priority (Urgent had no entry: it fell to the amber fallback on the Tasks page and to Medium on the dashboard)
  low: 'info',
  medium: 'warning',
  high: 'danger',
  urgent: 'danger',
  critical: 'danger',

  // Claims, billable events and payments. The billable-event words match billing/constants.ts, so the claim batch page agrees with Billing.
  submitted: 'info',
  ready: 'info',
  paid: 'success',
  rejected: 'danger',
  partiallypaid: 'warning',
  validated: 'info',
  routed: 'info',
  claimed: 'success',
  invoiced: 'success',
  notclaimed: 'neutral',
  inclaim: 'info',
  notinvoiced: 'neutral',
  invoicesent: 'info',
  partial: 'warning',

  // QSC
  reportedwithin24h: 'success',
  reportedlate: 'warning',
  required: 'danger',
  pending: 'warning',
  notrequired: 'neutral',

  // Plan types are categories, never a state: info, accessible and neutral keep the three apart, and none is warning or danger.
  // (Self managed was the warning amber, which read as "needs attention" on every self-managed plan.) AgencyManaged is the
  // enum's name for NDIA-managed, so it takes the same tone.
  ndiamanaged: 'info',
  agencymanaged: 'info',
  planmanaged: 'accessible',
  selfmanaged: 'neutral',

  // Lifecycle worklists (Inquiries/Onboarding). `new` is in QUIET_STATUS.
  new: 'neutral',
  draftintake: 'success',
  complete: 'success',
  needsattention: 'warning',
  blocked: 'danger',
  // Stalled: in progress but not moving (no progress, still open). Muted warning, not an error.
  stalled: 'warning',

  // Trip statuses with no entry above (draft, confirmed, completed, cancelled and archived are already covered). Amber was the wrong
  // signal for these: The Semantic Colour Rule reserves it for time-bound compliance.
  planning: 'info',
  openforbookings: 'success',
  waitlistonly: 'warning',
  // In progress is information (owner decision, 2026-10-02): blue for a trip, a task and a shift alike, never the accessibility pink.
  inprogress: 'info',

  // Bookings, reservations, vehicle requests and activities that are not yet on the trip or not yet confirmed: awaiting a decision, a
  // reply or a confirmation, a hold running out, a queue. "Researching" and "Planned" have asked nobody anything yet, so they are quiet.
  enquiry: 'warning',
  held: 'warning',
  waitlist: 'warning',
  requested: 'warning',
  booked: 'warning',
  researching: 'neutral',
  planned: 'neutral',

  // Tasks and shifts (in progress is above). A shift is Published to staff, then waits for a manager once the worker finishes it.
  notstarted: 'neutral',
  published: 'info',
  pendingreview: 'warning',

  // Incidents. Draft and Submitted are above; the register's colours agree with the dashboard's "Open incidents" tile (Closed and
  // Resolved are not open).
  underreview: 'warning',
  escalated: 'danger',
  resolved: 'success',
  closed: 'neutral',

  // Medication. A wrong-medication dose is as red as a refused or missed one (it was amber on the participant's Medications tab).
  administered: 'success',
  refused: 'danger',
  withheld: 'warning',
  missed: 'danger',
  wrongmedication: 'danger',
  onhold: 'warning',
  ceased: 'danger',

  // Contact roles, and the outbox of notifications.
  superseded: 'neutral',
  sent: 'success',
  failed: 'danger',
  skipped: 'neutral',

  // Service agreement drafts
  unapproveddraft: 'warning',
  approvedforelectronicsigning: 'success',
}

/** Statuses that read as a quiet pill (the tone's soft wash and ink) instead of its solid pair: `new` is not a state yet, so it sits a step lighter than `draft`. */
export const QUIET_STATUS: ReadonlySet<string> = new Set(['new'])

/** The key StatusBadge looks a status up by: case and whitespace do not matter ("Open For Bookings", "openforbookings"). */
export function statusKey(status: string): string {
  return status.toLowerCase().replace(/\s+/g, '')
}

export function toneForStatus(status: string): Tone | undefined {
  const key = statusKey(status)
  return Object.hasOwn(STATUS_TONE, key) ? STATUS_TONE[key] : undefined
}

/** The pill classes of a status: its tone's solid pair (`soft` and `ink` for a QUIET_STATUS), or `fallback` (neutral) for a status with no tone. */
export function statusClass(status: string, fallback: Tone = 'neutral'): string {
  const tone = toneForStatus(status) ?? fallback
  return QUIET_STATUS.has(statusKey(status)) ? `${TONE[tone].soft} ${TONE[tone].ink}` : TONE[tone].solid
}

/**
 * Sentence-case labels for every trip status, for a StatusBadge's `label`. A `Record<TripStatus, string>`, so a status added to
 * TRIP_STATUSES fails the type check until it has one. The badge shows the raw enum text ("OpenForBookings") when given none.
 * Passed at the call site rather than mapped inside StatusBadge, so its other users (a portal shift's "InProgress") keep their text.
 */
export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  Draft: 'Draft',
  Planning: 'Planning',
  OpenForBookings: 'Open for bookings',
  WaitlistOnly: 'Waitlist only',
  Confirmed: 'Confirmed',
  InProgress: 'In progress',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  Archived: 'Archived',
}
