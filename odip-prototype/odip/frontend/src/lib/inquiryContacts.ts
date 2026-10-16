// The enquiry form's pending contacts (spec 2026-10-16, D3): rows as typed, what goes on the wire, and the refusals by row. Pure and JSX-free.
import { CONTACT_ROLE_TYPES, type ContactRoleType, type PlanType } from '@/api/types/enums'
import { availableContactRoleTypes, contactRoleGateError } from '@/api/types/contacts'
import type { InquiryContactDto } from '@/api/types/inquiries'
import { fieldErrors } from '@/lib/fieldErrors'

/** One contact row as typed. `key` is the client's own (ids, focus); `notes` has no field but survives a load and a save. */
export type ContactRow = { key: string; role: ContactRoleType; firstName: string; lastName: string; relationship: string; phone: string; email: string; notes: string }
export type ContactField = 'role' | 'firstName' | 'lastName' | 'relationship' | 'phone' | 'email'
/** The errors of each row, by its key. */
export type ContactFieldErrors = Record<string, Partial<Record<ContactField, string>>>

/** Every role but Plan Manager: an enquiry has no plan type yet (SHAPE section 5), and the server refuses it. */
export const PENDING_ROLES = availableContactRoleTypes(CONTACT_ROLE_TYPES, null, null)

// A counter, not crypto.randomUUID: plain HTTP (live ODIP) is not a secure context, so randomUUID is undefined there.
let nextKey = 0

export const blankContact = (): ContactRow =>
  ({ key: `contact-${++nextKey}`, role: 'NextOfKin', firstName: '', lastName: '', relationship: '', phone: '', email: '', notes: '' })

export const contactRowOf = (dto: InquiryContactDto): ContactRow => ({
  ...blankContact(), role: dto.role, firstName: dto.firstName, lastName: dto.lastName, relationship: dto.relationship ?? '', phone: dto.phone ?? '',
  email: dto.email ?? '', notes: dto.notes ?? '',
})

/**
 * A Role select's options, live from the enquiry's details (L4): the pending roles the participant's contact rules allow for this plan type and date of
 * birth. A role already chosen that the rules now refuse stays listed, in its place, so it is never swapped silently; Save then refuses it (SHAPE section 4).
 */
export function pendingRoleOptions(planType: PlanType | null, dateOfBirth: string | null, selected?: ContactRoleType): ContactRoleType[] {
  const allowed = availableContactRoleTypes(PENDING_ROLES, planType, dateOfBirth)
  return selected && !allowed.includes(selected) ? PENDING_ROLES.filter(r => r === selected || allowed.includes(r)) : allowed
}

/** Nothing typed in the six visible fields. The default role alone does not make a row worth sending, as the wizard's draft rule. */
export const isBlankContact = (row: ContactRow) =>
  [row.firstName, row.lastName, row.relationship, row.phone, row.email].every(v => !v.trim())

const orNull = (value: string) => value.trim() || null

/** What goes on the wire: blank rows dropped, the rest trimmed, blanks as null, in the form's order. */
export const contactsPayload = (rows: ContactRow[]): InquiryContactDto[] =>
  rows.filter(r => !isBlankContact(r)).map(r => ({
    role: r.role, firstName: r.firstName.trim(), lastName: r.lastName.trim(), relationship: orNull(r.relationship), phone: orNull(r.phone),
    email: orNull(r.email), notes: orNull(r.notes),
  }))

/**
 * The client's own check, before anything is sent: a row with anything in it needs both names (a Person has both), and a role the contact rules allow
 * for the enquiry's plan type and date of birth (`gate`), as the server checks it at save.
 */
export function contactRowErrors(rows: ContactRow[], gate?: { planType?: PlanType | null; dateOfBirth?: string | null }): ContactFieldErrors {
  const errors: ContactFieldErrors = {}
  for (const r of rows) {
    if (isBlankContact(r)) continue
    const own: Partial<Record<ContactField, string>> = {}
    const refused = gate && contactRoleGateError(r.role, gate.planType || null, gate.dateOfBirth || null)
    if (refused) own.role = refused
    if (!r.firstName.trim()) own.firstName = 'Add their first name.'
    if (!r.lastName.trim()) own.lastName = 'Add their last name.'
    if (Object.keys(own).length > 0) errors[r.key] = own
  }
  return errors
}

/** The server's contacts[i].field refusals on the rows: i counts the rows that were sent, so blank rows are skipped. */
export function serverContactErrors(error: unknown, rows: ContactRow[]): ContactFieldErrors {
  const sent = rows.filter(r => !isBlankContact(r))
  const errors: ContactFieldErrors = {}
  for (const [key, message] of Object.entries(fieldErrors(error))) {
    const match = /^contacts\[(\d+)\]\.(\w+)$/i.exec(key)
    const row = match && sent[Number(match[1])]
    if (!row || !message) continue
    const field = (match[2][0].toLowerCase() + match[2].slice(1)) as ContactField
    errors[row.key] = { ...errors[row.key], [field]: message }
  }
  return errors
}
