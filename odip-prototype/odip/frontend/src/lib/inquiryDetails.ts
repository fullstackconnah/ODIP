// The enquiry's participant, main contact and optional details (spec 2026-10-16 redesign, SHAPE.md sections 3-12): names, the client's mirror of the
// server's rules, Start intake's reasons, and the read-only facts. Pure and JSX-free.
import { contactRoleGateError, CONTACT_ROLE_TYPE_LABELS } from '@/api/types/contacts'
import type { ContactRoleType, PlanType } from '@/api/types/enums'
import type { InquiryDetails, ParticipantInquiryDetailDto } from '@/api/types/inquiries'
import { formatDateRange } from '@/lib/dateRange'
import { fieldErrors } from '@/lib/fieldErrors'
import { EMAIL } from '@/lib/intakeBooking'

/** "First Last", or whichever is given: the trimmed parts joined by one space, '' when both are blank (L1). Every name sentence uses it. */
export function fullName(first?: string | null, last?: string | null): string {
  return [first, last].map(s => s?.trim() ?? '').filter(Boolean).join(' ')
}

type Address = Pick<InquiryDetails, 'addressStreet' | 'addressSuburb' | 'addressState' | 'addressPostcode'>

/** Start intake's address gate (owner decision 4): all four fields. */
export const hasFullAddress = (d: Address) =>
  [d.addressStreet, d.addressSuburb, d.addressState, d.addressPostcode].every(v => !!v?.trim())

/** "12 Smith St, Parramatta NSW 2150": the street, then "suburb state postcode", blanks left out. */
export function addressLine(d: Address): string {
  const place = [d.addressSuburb, d.addressState, d.addressPostcode].map(v => v?.trim()).filter(Boolean).join(' ')
  return [d.addressStreet?.trim(), place].filter(Boolean).join(', ')
}

// Spec L3 sets these words; the intake wizard keeps its own (PLAN_TYPE_LABELS), so this deliberately does not reuse them.
export const PLAN_MANAGEMENT_OPTIONS: { value: PlanType; label: string }[] = [
  { value: 'SelfManaged', label: 'Self-managed' },
  { value: 'PlanManaged', label: 'Plan-managed' },
  { value: 'AgencyManaged', label: 'NDIA-managed' },
]
export const PLAN_MANAGEMENT_LABELS = Object.fromEntries(PLAN_MANAGEMENT_OPTIONS.map(o => [o.value, o.label])) as Record<PlanType, string>

/** The server's PhonePattern (ParticipantInquiriesController), the contacts' own. */
export const PHONE = /^\+?[\d\s\-()]{6,20}$/
export const ndisDigits = (v: string) => v.replace(/\s/g, '')

/** One sentence per rule, SHAPE section 10's words, shared by the checks and the tests. */
export const INQUIRY_MESSAGES = {
  firstName: "Add the participant's first name.",
  phone: 'Enter a phone number, like 0412 345 678.',
  email: 'Enter a full email address, like name@example.com.',
  ndisNumber: 'Enter the 9-digit NDIS number, like 430 123 456.',
  dobFuture: "The date of birth can't be in the future.",
  dobOld: "Check the year: that's more than 120 years ago.",
  postcode: 'Postcode must be exactly 4 digits.',
  planEndDate: "The plan end can't be before the plan start.",
} as const

export type InquiryField =
  | 'firstName' | 'phone' | 'email' | 'ndisNumber' | 'dateOfBirth'
  | 'addressState' | 'addressPostcode' | 'addressStreet' | 'addressSuburb'
  | 'planEndDate' | 'planType'
  | 'contactRole' | 'contactFirstName' | 'contactLastName'
export type InquiryErrors = Partial<Record<InquiryField, string>>

const FIELDS: InquiryField[] = ['firstName', 'phone', 'email', 'ndisNumber', 'dateOfBirth', 'addressState', 'addressPostcode', 'addressStreet', 'addressSuburb',
  'planEndDate', 'planType', 'contactRole', 'contactFirstName', 'contactLastName']

/** The fields inside the Participant details fold: an error on one opens it. */
export const DETAIL_FIELDS: InquiryField[] = ['addressStreet', 'addressSuburb', 'addressState', 'addressPostcode', 'dateOfBirth', 'ndisNumber', 'planType', 'planEndDate']

/** What the checks read from the form: its typed strings, '' for blank. */
export type InquiryFormValues = {
  firstName: string; phone: string; email: string; contactIsParticipant: boolean; contactRole: ContactRoleType | ''
  dateOfBirth: string; ndisNumber: string; addressPostcode: string; planType: PlanType | ''; planStartDate: string; planEndDate: string
}

/**
 * The client's mirror of the server's save rules (InquiryErrorsAsync), at Save. The phone and email are checked only when they differ from what was
 * loaded, or when "their own contact" is newly ticked (D4): a legacy value saves untouched. `today` is the provider's yyyy-MM-dd. The state is a select,
 * so only the server checks it.
 */
export function inquiryErrors(form: InquiryFormValues, stored: { phone: string; email: string; contactIsParticipant: boolean } | null, today: string): InquiryErrors {
  const errors: InquiryErrors = {}
  if (!form.firstName.trim()) errors.firstName = INQUIRY_MESSAGES.firstName
  const recheck = !stored || (form.contactIsParticipant && !stored.contactIsParticipant)
  const phone = form.phone.trim()
  if (phone && (recheck || phone !== stored!.phone.trim()) && !PHONE.test(phone)) errors.phone = INQUIRY_MESSAGES.phone
  const email = form.email.trim()
  if (email && (recheck || email !== stored!.email.trim()) && !EMAIL.test(email)) errors.email = INQUIRY_MESSAGES.email
  if (form.ndisNumber.trim() && !/^\d{9}$/.test(ndisDigits(form.ndisNumber))) errors.ndisNumber = INQUIRY_MESSAGES.ndisNumber
  if (form.dateOfBirth) {
    const oldest = `${Number(today.slice(0, 4)) - 120}${today.slice(4)}`
    if (form.dateOfBirth > today) errors.dateOfBirth = INQUIRY_MESSAGES.dobFuture
    else if (form.dateOfBirth < oldest) errors.dateOfBirth = INQUIRY_MESSAGES.dobOld
  }
  if (form.addressPostcode.trim() && !/^\d{4}$/.test(form.addressPostcode.trim())) errors.addressPostcode = INQUIRY_MESSAGES.postcode
  if (form.planStartDate && form.planEndDate && form.planEndDate < form.planStartDate) errors.planEndDate = INQUIRY_MESSAGES.planEndDate
  if (!form.contactIsParticipant && form.contactRole) {
    const refused = contactRoleGateError(form.contactRole, form.planType || null, form.dateOfBirth || null)
    if (refused) errors.contactRole = refused
  }
  return errors
}

/** A save's or a Start intake's field refusals, on the form's own fields. */
export function serverInquiryErrors(err: unknown): InquiryErrors {
  const errors: InquiryErrors = {}
  for (const [key, message] of Object.entries(fieldErrors(err))) if (message && (FIELDS as string[]).includes(key)) errors[key as InquiryField] = message
  return errors
}

/** Why Start intake is blocked, with where to fix it (G2); null when nothing blocks. A missing flag counts as blocked for the address. */
export function startIntakeReason(row: { id: string; hasAddress?: boolean; contactNeedsName?: boolean }): { text: string; to: string; address: boolean; name: boolean } | null {
  const address = !row.hasAddress
  const name = !!row.contactNeedsName
  if (!address && !name) return null
  const text = address && name ? "Add an address and the main contact's name to start intake"
    : address ? 'Add an address to start intake' : "Add the main contact's name to start intake"
  return { text, to: `/participants/new-inquiry?id=${encodeURIComponent(row.id)}&focus=${address ? 'address' : 'contact'}`, address, name }
}

/** A Start intake 400 in words: the address, the contact's name, or both; null for any other refusal. */
export function convertRefusal(err: unknown, participantName: string): string | null {
  const keys = Object.keys(fieldErrors(err))
  const sentences = [
    keys.some(k => k.startsWith('address')) ? `Add ${participantName}'s full address before starting intake: street, suburb, state and postcode.` : '',
    keys.some(k => k === 'contactFirstName' || k === 'contactLastName') ? "Add the main contact's name before starting intake." : '',
  ].filter(Boolean)
  return sentences.length > 0 ? sentences.join(' ') : null
}

type ContactFacts = Pick<ParticipantInquiryDetailDto, 'contactIsParticipant' | 'contactFirstName' | 'contactLastName' | 'contactRelationship' | 'contactRole' | 'phone' | 'email'>

/** The main contact as read-only facts (SHAPE section 11, E5 and E6). */
export function mainContactFacts(d: ContactFacts): { label: string; value: string | null | undefined }[] {
  if (d.contactIsParticipant) return [{ label: 'Contact', value: 'Their own contact' }, { label: 'Phone', value: d.phone }, { label: 'Email', value: d.email }]
  return [
    { label: 'Name', value: fullName(d.contactFirstName, d.contactLastName) },
    { label: 'Relationship', value: d.contactRelationship },
    { label: 'Role', value: d.contactRole ? CONTACT_ROLE_TYPE_LABELS[d.contactRole] : null },
    { label: 'Phone', value: d.phone },
    { label: 'Email', value: d.email },
  ]
}

/** The participant details as read-only facts (E6). */
export function detailFacts(d: InquiryDetails): { label: string; value: string | null | undefined }[] {
  return [
    { label: 'Address', value: addressLine(d) },
    { label: 'Date of birth', value: formatDateRange(d.dateOfBirth, d.dateOfBirth) },
    { label: 'NDIS number', value: d.ndisNumber },
    { label: 'Plan management', value: d.planType ? PLAN_MANAGEMENT_LABELS[d.planType] : null },
    { label: 'Plan dates', value: formatDateRange(d.planStartDate, d.planEndDate) },
  ]
}

// AccommodationDetailPage's fix for the same case: FactList's bare 1fr value track lets an unbreakable email push past the card at 390.
export const FACT_LIST_WRAP = 'grid-cols-[10rem_minmax(0,1fr)]! [&_dd]:break-words'

/** Whether the closed view shows the details card at all. */
export const hasStoredDetails = (d: InquiryDetails) => detailFacts(d).some(f => !!f.value)
