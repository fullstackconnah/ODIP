import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { CONTACT_ROLE_TYPE_LABELS } from '@/api/types/contacts'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { FormField } from '@/components/FormField'
import { formGrid, span } from '@/lib/formGrid'
import { PENDING_ROLES, blankContact, enquirerContact, type ContactField, type ContactFieldErrors, type ContactRow } from '@/lib/inquiryContacts'

const MUTED = 'text-[13px] text-[var(--color-muted-foreground)]'

/**
 * The enquiry form's Contacts card (SHAPE.md section 5): family, guardians and anyone else to keep in touch with, noted before intake. Rows are
 * house fields with no native `required`, so Save reaches the form's own check ("Add their last name.") and blank rows can be dropped.
 * Presentational: the form owns the rows and their errors.
 */
export function InquiryContactsCard({ rows, errors, listError, enquirer, converted, onChange }: {
  rows: ContactRow[]
  errors: ContactFieldErrors
  /** A refusal of the list itself (more than 20, or intake has started). */
  listError?: string
  /** The enquiry's phone and email as typed above. */
  enquirer: { phone: string; email: string }
  /** Set once intake has started: the contacts are on the participant's record. */
  converted: { participantId: string; firstName: string } | null
  onChange: (rows: ContactRow[], changed?: { key: string; field: ContactField }) => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  // Where focus goes once the next render is on screen: a new row's First name, or after a remove its neighbour (SHAPE section 5).
  const focusNext = useRef<string | null>(null)
  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    bodyRef.current?.querySelector<HTMLElement>(target)?.focus()
  })

  if (converted) {
    return (
      <Card title="Contacts">
        <p className="text-sm">
          Contacts are on {converted.firstName}'s intake now.{' '}
          <Link to={`/participants/${converted.participantId}/intake`} className="font-medium text-[var(--color-primary)] underline underline-offset-2">Open the intake</Link>
        </p>
      </Card>
    )
  }

  const phone = enquirer.phone.trim(), email = enquirer.email.trim()
  // One-shot copy, offered while there is something to copy that no row holds yet (lead decision 1).
  const offerEnquirer = (!!phone || !!email) && !rows.some(r => (!!phone && r.phone.trim() === phone) || (!!email && r.email.trim() === email))

  const add = (row: ContactRow) => {
    focusNext.current = `#contact-${row.key}-firstName`
    onChange([...rows, row])
  }
  const remove = (index: number) => {
    const next = rows[index + 1] ?? rows[index - 1]
    focusNext.current = next ? `#contact-${next.key}-firstName` : '[data-add-contact]'
    onChange(rows.filter((_, i) => i !== index))
  }
  const set = (index: number, field: ContactField, value: string) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)), { key: rows[index].key, field })

  const field = (row: ContactRow, index: number, name: Exclude<ContactField, 'role'>, label: string, className: string, type = 'text', required = false) => (
    <FormField label={label} required={required} error={errors[row.key]?.[name]} className={className}>
      <input
        id={`contact-${row.key}-${name}`}
        type={type}
        autoComplete="off"
        maxLength={name === 'phone' ? 30 : name === 'email' ? 200 : 100}
        value={row[name]}
        onChange={e => set(index, name, e.target.value)}
      />
    </FormField>
  )

  return (
    <Card title="Contacts">
      <div ref={bodyRef} className="flex flex-col gap-[var(--field-gap-y)]">
        <p className={MUTED}>Family, guardians and anyone else to keep in touch with. They move to the participant's record when intake starts.</p>
        {listError && <p className="text-[13px] text-[var(--color-destructive)]">{listError}</p>}
        {rows.length === 0 && <p className={MUTED}>No contacts yet.</p>}
        {rows.map((row, index) => {
          const name = `${row.firstName} ${row.lastName}`.trim()
          return (
            <fieldset key={row.key} className="relative p-[var(--card-pad)] rounded-[var(--radius-sm)] border border-[var(--color-border)]">
              <legend className="sr-only">Contact {index + 1}</legend>
              <div className="flex items-start gap-2">
                <div className={`flex-1 min-w-0 ${formGrid}`}>
                  {/* Below md the remove control sits beside First name only, so every other field keeps the full width. */}
                  {field(row, index, 'firstName', 'First name', `${span.short} max-md:pr-11`, 'text', true)}
                  {field(row, index, 'lastName', 'Last name', span.short, 'text', true)}
                  <FormField label="Role" required error={errors[row.key]?.role} className={span.medium}>
                    <select id={`contact-${row.key}-role`} value={row.role} onChange={e => set(index, 'role', e.target.value)}>
                      {PENDING_ROLES.map(role => <option key={role} value={role}>{CONTACT_ROLE_TYPE_LABELS[role]}</option>)}
                    </select>
                  </FormField>
                  {field(row, index, 'relationship', 'Relationship', span.short)}
                  {field(row, index, 'phone', 'Phone', span.short, 'tel')}
                  {field(row, index, 'email', 'Email', span.medium, 'email')}
                </div>
                <Button variant="ghost" iconOnly className="mt-6 max-md:absolute max-md:right-[var(--card-pad)] max-md:top-[var(--card-pad)]" aria-label={`Remove ${name || `contact ${index + 1}`}`} title="Remove contact" onClick={() => remove(index)}>
                  <Trash2 className="w-4 h-4" aria-hidden />
                </Button>
              </div>
            </fieldset>
          )
        })}
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" data-add-contact onClick={() => add(blankContact())}><Plus className="w-4 h-4" aria-hidden />Add contact</Button>
            {offerEnquirer && <Button variant="ghost" onClick={() => add(enquirerContact({ phone, email }))}>Add the enquirer as a contact</Button>}
          </div>
          {offerEnquirer && <p className={MUTED}>Copies the phone and email above. Add the caller's name.</p>}
        </div>
      </div>
    </Card>
  )
}
