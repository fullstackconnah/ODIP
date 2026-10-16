import { CONTACT_ROLE_TYPE_LABELS } from '@/api/types/contacts'
import type { ContactRoleType } from '@/api/types/enums'
import { Card } from '@/components/Card'
import { CheckboxField } from '@/components/CheckboxField'
import { SelectField } from '@/components/SelectField'
import { TextField } from '@/components/TextField'
import { formGrid, span } from '@/lib/formGrid'
import type { InquiryErrors } from '@/lib/inquiryDetails'

const MUTED = 'text-[13px] text-[var(--color-muted-foreground)]'

export type MainContactForm = {
  contactIsParticipant: boolean
  contactFirstName: string
  contactLastName: string
  contactRelationship: string
  contactRole: ContactRoleType | ''
  phone: string
  email: string
}
type Field = keyof MainContactForm

/**
 * The enquiry form's Main contact card (SHAPE.md section 4): who the coordinator is talking to, laid out like an Other contacts row. Nothing is required.
 * Ticked "their own contact", the name, relationship and role leave the DOM (their typed values stay in the form's state) and the phone and email are
 * the participant's. Presentational: the form owns the state, the errors and the Role options.
 */
export function MainContactCard({ form, errors, roleOptions, needsName, onChange }: {
  form: MainContactForm
  errors: InquiryErrors
  roleOptions: ContactRoleType[]
  /** A phone or an email but no name, and not their own contact: Start intake waits for a name (D1). */
  needsName: boolean
  onChange: <F extends Field>(field: F, value: MainContactForm[F]) => void
}) {
  const text = (field: Exclude<Field, 'contactIsParticipant' | 'contactRole'>) => ({
    value: form[field], autoComplete: 'off', onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(field, e.target.value),
  })
  return (
    <Card title="Main contact">
      <div className="flex flex-col gap-[var(--field-gap-y)]">
        <p className={MUTED}>Who you're talking to. The intake visit invite goes to their email.</p>
        <CheckboxField
          id="inquiry-contact-is-participant"
          label="The participant is their own contact"
          hint="Tick when you're dealing with the participant directly. The phone and email below are then theirs."
          checked={form.contactIsParticipant}
          onChange={e => onChange('contactIsParticipant', e.target.checked)}
        />
        <div className={formGrid}>
          {!form.contactIsParticipant && (
            <>
              <TextField id="inquiry-contact-first-name" className={span.short} label="First name" maxLength={100} error={errors.contactFirstName} {...text('contactFirstName')} />
              <TextField id="inquiry-contact-last-name" className={span.short} label="Last name" maxLength={100} error={errors.contactLastName} {...text('contactLastName')} />
              <SelectField
                id="inquiry-contact-role"
                className={span.medium}
                label="Role"
                error={errors.contactRole}
                value={form.contactRole}
                onChange={e => onChange('contactRole', e.target.value as ContactRoleType | '')}
                options={[{ value: '', label: 'Not specified' }, ...roleOptions.map(role => ({ value: role, label: CONTACT_ROLE_TYPE_LABELS[role] }))]}
              />
              {needsName && <p className={`${MUTED} ${span.long}`}>No name yet. Add one to start intake, or tick the box above if these are the participant's own details.</p>}
              <TextField id="inquiry-contact-relationship" className={span.short} label="Relationship" maxLength={100} {...text('contactRelationship')} />
            </>
          )}
          <TextField id="inquiry-phone" className={span.short} label="Phone" type="tel" maxLength={30} error={errors.phone} {...text('phone')} />
          <TextField id="inquiry-email" className={span.medium} label="Email" type="email" maxLength={200} error={errors.email} {...text('email')} />
        </div>
      </div>
    </Card>
  )
}
