import { ChevronRight } from 'lucide-react'
import { AU_STATES, type PlanType } from '@/api/types/enums'
import { Card } from '@/components/Card'
import { SelectField } from '@/components/SelectField'
import { TextField } from '@/components/TextField'
import { formGrid, span } from '@/lib/formGrid'
import { hasFullAddress, PLAN_MANAGEMENT_OPTIONS, type InquiryErrors } from '@/lib/inquiryDetails'

const MUTED = 'text-[13px] text-[var(--color-muted-foreground)]'
const LEGEND = 'mb-2 text-[13px] font-semibold text-[var(--color-muted-foreground)]'

export type DetailsForm = {
  addressStreet: string; addressSuburb: string; addressState: string; addressPostcode: string
  dateOfBirth: string; ndisNumber: string; planType: PlanType | ''; planStartDate: string; planEndDate: string
}
type Field = keyof DetailsForm

/**
 * The enquiry form's Participant details (SHAPE.md section 5): optional, gathered by intake later, so a fold that is closed on a new enquiry and open
 * on edit. The house fold (NotRecordedFold): a native <details> whose summary is the card's heading row, whose content fades in over 150 ms when it opens (the global `details[open]` rule in `index.css`). `open` is the
 * form's, so Save and ?focus=address can open it before focusing a field inside. Dates take the house span.date (formGrid.test's R3 F-05 guard), and
 * Plan start opens its own row at xl so the plan's two dates sit together. Presentational: the form owns the state and the errors.
 */
export function ParticipantDetailsFold({ form, errors, open, today, onToggle, onChange }: {
  form: DetailsForm
  errors: InquiryErrors
  open: boolean
  /** The provider's today (yyyy-MM-dd): a date of birth can't be after it. */
  today: string
  onToggle: (open: boolean) => void
  onChange: (field: Field, value: string) => void
}) {
  const text = (field: Field) => ({ value: form[field], autoComplete: 'off', error: errors[field as keyof InquiryErrors], onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(field, e.target.value) })
  return (
    <Card>
      <details open={open} onToggle={e => onToggle(e.currentTarget.open)} className="group">
        {/* A summary holds phrasing and heading content only, so the h3 and the status are its own children: below md the status takes the second
            row under the title, and the chevron stays on the first line. */}
        <summary className="grid min-h-[var(--control-h)] cursor-pointer select-none list-none grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5 py-1.5 md:grid-cols-[auto_auto_1fr] [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 shrink-0 self-start mt-0.5 text-[var(--color-muted-foreground)] group-open:rotate-90" aria-hidden="true" />
          <h3 className="text-sm font-semibold">Participant details</h3>
          <span className={`${MUTED} col-start-2 md:col-start-auto md:ml-1`}>{hasFullAddress(form) ? 'Optional · Address added' : 'Optional · Intake needs the address'}</span>
        </summary>
        <div className="mt-2 flex flex-col gap-[var(--field-gap-y)]">
          <p className={MUTED}>None of these are needed to save. Starting intake needs the full address: street, suburb, state and postcode.</p>
          <div className={formGrid}>
            <fieldset className={`${span.long} min-w-0`}>
              <legend className={LEGEND}>Address</legend>
              <div className={formGrid}>
                <TextField id="inquiry-address-street" className={span.long} label="Street" maxLength={200} {...text('addressStreet')} />
                <TextField id="inquiry-address-suburb" className={span.medium} label="Suburb" maxLength={100} {...text('addressSuburb')} />
                <SelectField
                  id="inquiry-address-state"
                  className={span.short}
                  label="State"
                  error={errors.addressState}
                  value={form.addressState}
                  onChange={e => onChange('addressState', e.target.value)}
                  options={[{ value: '', label: 'Not specified' }, ...AU_STATES.map(s => ({ value: s, label: s }))]}
                />
                <TextField id="inquiry-address-postcode" className={span.short} label="Postcode" inputMode="numeric" maxLength={4} {...text('addressPostcode')} />
              </div>
            </fieldset>
            <TextField id="inquiry-dob" className={span.date} label="Date of birth" type="date" max={today} {...text('dateOfBirth')} />
            <TextField id="inquiry-ndis-number" className={span.short} label="NDIS number" inputMode="numeric" maxLength={20} hint="9 digits" {...text('ndisNumber')} />
            <fieldset className={`${span.long} min-w-0`}>
              <legend className={LEGEND}>NDIS plan</legend>
              <div className={formGrid}>
                <SelectField
                  id="inquiry-plan-type"
                  className={span.short}
                  label="Plan management"
                  error={errors.planType}
                  value={form.planType}
                  onChange={e => onChange('planType', e.target.value)}
                  options={[{ value: '', label: 'Not specified' }, ...PLAN_MANAGEMENT_OPTIONS]}
                />
                <TextField id="inquiry-plan-start" className={`${span.date} xl:col-start-1`} label="Plan start" type="date" {...text('planStartDate')} />
                <TextField id="inquiry-plan-end" className={span.date} label="Plan end" type="date" {...text('planEndDate')} />
              </div>
            </fieldset>
          </div>
        </div>
      </details>
    </Card>
  )
}
