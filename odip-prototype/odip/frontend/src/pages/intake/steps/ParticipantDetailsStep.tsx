/**
 * PF-10.3 — Intake wizard, "Participant Details" step. Covers the Identity-step subset of
 * `fieldsForEntry('intake')`: core identity, structured address (INTAKE-06), and the Living
 * Arrangements block (LIVING-01..04) — every field this section renders is `entryPhase: 'intake'`
 * per `documentMapping.ts`; Profile-only Identity fields (middleName, gender,
 * genderSelfDescription, placeOfBirth, country, preferredStaffId) are simply absent.
 *
 * Per-type Living Arrangement fields are shown/hidden by a plain `livingArrangement === '...'`
 * check here rather than the full `src/lib/conditionalFields.ts` INTAKE-07 engine
 * `the retired single-step wizard` uses — a deliberate scope simplification for this smaller field set
 * (see this branch's report); the underlying zod refine (`livingArrangementRefine`) still enforces
 * the same required-ness regardless of what's visually hidden.
 */
import type { Control, FieldErrors, UseFormRegister } from 'react-hook-form'
import { Controller } from 'react-hook-form'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { TextAreaField } from '@/components/TextAreaField'
import { CheckboxField } from '@/components/CheckboxField'
import { Card } from '@/components/Card'
import { AU_STATES, LIVING_ARRANGEMENTS } from '@/api/types/enums'
import { LIVING_ARRANGEMENT_LABELS } from '@/api/types/participants'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { formGrid, span } from '@/lib/formGrid'

export function ParticipantDetailsStep({ control, register, errors, livingArrangementValue }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  errors: FieldErrors<ParticipantFormData>
  livingArrangementValue: string | undefined
}) {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Card title="Personal Information">
        <div className={formGrid}>
          <FormField label="First Name" required error={errors.firstName?.message} className={span.medium}>
            <input id="firstName" {...register('firstName')} placeholder="e.g. John" />
          </FormField>

          <FormField label="Last Name" required error={errors.lastName?.message} className={span.medium}>
            <input id="lastName" {...register('lastName')} placeholder="e.g. Smith" />
          </FormField>

          <FormField label="Preferred Name" className={span.medium}>
            <input id="preferredName" {...register('preferredName')} placeholder="e.g. Johnny" />
          </FormField>

          <FormField label="Date of Birth" className={span.date}>
            <input id="dateOfBirth" type="date" {...register('dateOfBirth')} />
          </FormField>

          <FormField label="Phone" error={errors.phone?.message} className={span.medium}>
            <input id="phone" type="tel" {...register('phone')} placeholder="e.g. 0400 000 000" />
          </FormField>

          <FormField label="Email" error={errors.email?.message} className={span.medium}>
            <input id="email" type="email" {...register('email')} placeholder="e.g. name@example.com" />
          </FormField>
        </div>
      </Card>

      <Card title="Address">
        <div className={formGrid}>
          <FormField label="Street" className={span.long}>
            <input id="addressStreet" {...register('addressStreet')} placeholder="e.g. 12 Example Street" />
          </FormField>

          <FormField label="Suburb" className={span.medium}>
            <input id="addressSuburb" {...register('addressSuburb')} placeholder="e.g. Fortitude Valley" />
          </FormField>

          <FormField label="State" className={span.short}>
            <Controller
              control={control}
              name="addressState"
              render={({ field }) => (
                <Dropdown
                  id="addressState"
                  variant="form"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  items={[
                    { value: '', label: 'Not specified' },
                    ...AU_STATES.map((s) => ({ value: s, label: s })),
                  ]}
                />
              )}
            />
          </FormField>

          <FormField label="Postcode" error={errors.addressPostcode?.message} hint="4 digits, e.g. 4000" className={span.short}>
            <input id="addressPostcode" {...register('addressPostcode')} inputMode="numeric" maxLength={4} placeholder="e.g. 4000" />
          </FormField>
        </div>
      </Card>

      <Card title="Living Arrangements">
        <div className={formGrid}>
          <FormField label="Living Arrangement" className={span.medium}>
            <Controller
              control={control}
              name="livingArrangement"
              render={({ field }) => (
                <Dropdown
                  id="livingArrangement"
                  variant="form"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  items={[
                    { value: '', label: 'Not specified' },
                    ...LIVING_ARRANGEMENTS.map((a) => ({ value: a, label: LIVING_ARRANGEMENT_LABELS[a] })),
                  ]}
                />
              )}
            />
          </FormField>

          {livingArrangementValue === 'Family' && (
            <>
              <FormField label="Main Support Person" required error={errors.mainSupportPersonName?.message} className={span.medium}>
                <input id="mainSupportPersonName" {...register('mainSupportPersonName')} placeholder="e.g. Jane Citizen" />
              </FormField>
              <FormField label="Relationship to Participant" className={span.medium}>
                <input id="mainSupportPersonRelationship" {...register('mainSupportPersonRelationship')} placeholder="e.g. Mother" />
              </FormField>
              <TextAreaField label="Others Living in the Accommodation" id="othersLivingInAccommodation" {...register('othersLivingInAccommodation')} rows={2} placeholder="Who else lives there..." className={span.long} />
              <TextAreaField label="Residential Information" id="residentialInfo" {...register('residentialInfo')} rows={2} placeholder="Home layout, accessibility..." className={span.long} />
            </>
          )}

          {livingArrangementValue === 'Independent' && (
            <>
              <CheckboxField label="Lives With Others" id="livesWithOthers" {...register('livesWithOthers')} className={span.short} />
              <FormField label="Who They Live With" required error={errors.whoLivesWith?.message} className={span.medium}>
                <input id="whoLivesWith" {...register('whoLivesWith')} placeholder="e.g. Housemates" />
              </FormField>
            </>
          )}

          {livingArrangementValue === 'SupportedAccommodation' && (
            <>
              <FormField label="SIL Provider Name" required error={errors.silProviderName?.message} className={span.medium}>
                <input id="silProviderName" {...register('silProviderName')} placeholder="e.g. Sunrise SIL Services" />
              </FormField>
              <FormField label="SIL Provider Contact (Phone)" className={span.medium}>
                <input id="silProviderContactPhone" {...register('silProviderContactPhone')} placeholder="e.g. 0400 000 000" />
              </FormField>
              <FormField label="Accommodation Type" className={span.medium}>
                <input id="accommodationType" {...register('accommodationType')} placeholder="e.g. Group home" />
              </FormField>
              <FormField label="On-Site Support Hours" className={span.medium}>
                <input id="onSiteSupportHours" {...register('onSiteSupportHours')} placeholder="e.g. 24/7 or 9-5 weekdays" />
              </FormField>
            </>
          )}

          {!!livingArrangementValue && (
            <TextAreaField label="Living Arrangement Notes" id="livingArrangementNotes" {...register('livingArrangementNotes')} rows={2} placeholder="Any additional notes..." className={span.long} />
          )}
        </div>
      </Card>
    </div>
  )
}
