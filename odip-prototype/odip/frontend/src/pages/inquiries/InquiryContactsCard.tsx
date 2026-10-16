import { useEffect, useRef } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { CONTACT_ROLE_TYPE_LABELS } from '@/api/types/contacts'
import type { PlanType } from '@/api/types/enums'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { FormField } from '@/components/FormField'
import { formGrid, span } from '@/lib/formGrid'
import { blankContact, pendingRoleOptions, type ContactField, type ContactFieldErrors, type ContactRow } from '@/lib/inquiryContacts'

const MUTED = 'text-[13px] text-[var(--color-muted-foreground)]'

/**
 * The enquiry form's Other contacts card (SHAPE.md section 6, 2026-10-16 redesign): anyone besides the main contact to keep in touch with, noted
 * before intake. Rows are house fields with no native `required`, so Save reaches the form's own check ("Add their last name.") and blank rows can
 * be dropped. Each row's Role follows the enquiry's plan type and date of birth (`gate`). Presentational: the form owns the rows and their errors.
 */
export function InquiryContactsCard({ rows, errors, listError, gate, onChange }: {
  rows: ContactRow[]
  errors: ContactFieldErrors
  /** A refusal of the list itself (more than 20, or intake has started). */
  listError?: string
  /** The enquiry's details the contact rules read, as typed. */
  gate: { planType: PlanType | null; dateOfBirth: string | null }
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
    <Card title="Other contacts">
      <div ref={bodyRef} className="flex flex-col gap-[var(--field-gap-y)]">
        <p className={MUTED}>Anyone else to keep in touch with, like family or a support coordinator. They move to the participant's record when intake starts, and are deleted if the enquiry is closed.</p>
        {listError && <p className="text-[13px] text-[var(--color-destructive)]">{listError}</p>}
        {rows.length === 0 && <p className={MUTED}>No other contacts yet.</p>}
        {rows.map((row, index) => {
          const name = `${row.firstName} ${row.lastName}`.trim()
          // Below md the row drops its inset box for a divider, so the fields get the card's full width and Role shows its longest label whole.
          return (
            <fieldset key={row.key} className="relative p-[var(--card-pad)] rounded-[var(--radius-sm)] border border-[var(--color-border)] max-md:p-0 max-md:pt-[var(--field-gap-y)] max-md:rounded-none max-md:border-x-0 max-md:border-b-0">
              <legend className="sr-only">Contact {index + 1}</legend>
              <div className="flex items-start gap-2">
                <div className={`flex-1 min-w-0 ${formGrid}`}>
                  {/* Below md the remove control sits beside First name only, so every other field keeps the full width. */}
                  {field(row, index, 'firstName', 'First name', `${span.short} max-md:pr-11`, 'text', true)}
                  {field(row, index, 'lastName', 'Last name', span.short, 'text', true)}
                  <FormField label="Role" required error={errors[row.key]?.role} className={span.medium}>
                    <select id={`contact-${row.key}-role`} value={row.role} onChange={e => set(index, 'role', e.target.value)}>
                      {pendingRoleOptions(gate.planType, gate.dateOfBirth, row.role).map(role => <option key={role} value={role}>{CONTACT_ROLE_TYPE_LABELS[role]}</option>)}
                    </select>
                  </FormField>
                  {field(row, index, 'relationship', 'Relationship', span.short)}
                  {field(row, index, 'phone', 'Phone', span.short, 'tel')}
                  {field(row, index, 'email', 'Email', span.medium, 'email')}
                </div>
                <Button variant="ghost" iconOnly className="mt-6 max-md:absolute max-md:right-0 max-md:top-[var(--field-gap-y)]" aria-label={`Remove ${name || `contact ${index + 1}`}`} title="Remove contact" onClick={() => remove(index)}>
                  <Trash2 className="w-4 h-4" aria-hidden />
                </Button>
              </div>
            </fieldset>
          )
        })}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" data-add-contact onClick={() => add(blankContact())}><Plus className="w-4 h-4" aria-hidden />Add contact</Button>
        </div>
      </div>
    </Card>
  )
}
