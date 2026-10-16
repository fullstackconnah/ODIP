import { FormField } from '@/components/FormField'
import { SearchableSelect } from '@/components/SearchableSelect'
import { TextAreaField } from '@/components/TextAreaField'
import { modalGrid } from '@/lib/formGrid'
import { DURATIONS, durationLabel, endsLabel, type BookingErrors, type BookingField, type BookingForm } from '@/lib/intakeBooking'
import { providerLocalToUtcInstant } from '@/pages/portal/shift/shiftTime'
import type { BookingStaff } from './useBookingStaff'

/**
 * The intake visit's fields (D2), shared by the Enquiries slide-over and the enquiry form: Date, Start time, How long, Where, Who's going and
 * Notes. `form` is what shows, with Who's going already defaulted by the host; each host keeps its own email block, refusal, result and actions.
 */
export function BookingFields({ form, errors, zone, staff, onChange, dateRef }: {
  form: BookingForm
  errors: BookingErrors
  zone: string
  staff: BookingStaff
  onChange: (field: BookingField, value: string) => void
  dateRef?: React.Ref<HTMLInputElement>
}) {
  const startIso = form.date && form.time ? providerLocalToUtcInstant(`${form.date}T${form.time}`, zone) : null
  const durations = DURATIONS.includes(Number(form.duration)) ? DURATIONS : [...DURATIONS, Number(form.duration)].sort((a, b) => a - b)
  return (
    <>
      <div className={modalGrid}>
        <div data-field="date">
          <FormField label="Date" required error={errors.date}>
            <input ref={dateRef} type="date" value={form.date} onChange={e => onChange('date', e.target.value)} />
          </FormField>
        </div>
        <div data-field="time">
          <FormField label="Start time" required error={errors.time}>
            <input type="time" value={form.time} onChange={e => onChange('time', e.target.value)} />
          </FormField>
        </div>
        <div data-field="duration">
          <FormField label="How long" hint={startIso ? endsLabel(startIso, Number(form.duration), zone) : undefined}>
            <select value={form.duration} onChange={e => onChange('duration', e.target.value)}>
              {durations.map(minutes => <option key={minutes} value={String(minutes)}>{durationLabel(minutes)}</option>)}
            </select>
          </FormField>
        </div>
      </div>

      <div data-field="location">
        <FormField label="Where" required error={errors.location} hint={errors.location ? undefined : "Their home address, or wherever you're meeting."}>
          <input type="text" maxLength={300} value={form.location} onChange={e => onChange('location', e.target.value)} />
        </FormField>
      </div>

      <div data-field="staffUserId">
        <FormField label="Who's going" required error={errors.staffUserId} hint={errors.staffUserId ? undefined : 'Only coordinators and admins can do an intake.'}>
          <SearchableSelect
            items={staff.items}
            value={form.staffUserId}
            onChange={value => onChange('staffUserId', value)}
            placeholder="Choose who's going"
            loading={staff.loading}
            // A refusal focuses the field to fix: it must show who was chosen, not an empty search over an open list.
            openOnFocus={false}
          />
        </FormField>
      </div>

      <div data-field="notes">
        <TextAreaField
          label="Notes for your team (optional)"
          rows={3}
          maxLength={1000}
          error={errors.notes}
          hint={errors.notes ? undefined : "Only your team sees these. They aren't in the invite."}
          value={form.notes}
          onChange={e => onChange('notes', e.target.value)}
        />
      </div>
    </>
  )
}
