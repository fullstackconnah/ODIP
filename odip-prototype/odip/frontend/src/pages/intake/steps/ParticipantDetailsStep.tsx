/**
 * PF-10.3 — Intake wizard, "Participant Details" step. Covers the Identity-step subset of
 * `fieldsForEntry('intake')`: core identity, structured address (INTAKE-06), and the Living
 * Arrangements block (LIVING-01..04) — every field this section renders is `entryPhase: 'intake'`
 * per `documentMapping.ts`; Profile-only Identity fields (middleName, gender,
 * genderSelfDescription, placeOfBirth, country, preferredStaffId) are simply absent.
 *
 * Per-type Living Arrangement fields are shown/hidden by a plain `livingArrangement === '...'`
 * check here; the underlying zod refine (`livingArrangementRefine`) still enforces
 * the same required-ness regardless of what's visually hidden.
 */
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form'
import { Controller, useController } from 'react-hook-form'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { AddressField } from '@/components/AddressField'
import type { AddressFieldProps } from '@/components/AddressField'
import { TextAreaField } from '@/components/TextAreaField'
import { CheckboxField } from '@/components/CheckboxField'
import { Card } from '@/components/Card'
import { LIVING_ARRANGEMENTS } from '@/api/types/enums'
import { LIVING_ARRANGEMENT_LABELS } from '@/api/types/participants'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { formGrid, span } from '@/lib/formGrid'
import { ADDRESS_STATE_ITEMS } from '../intakeOptions'

/**
 * The street box, with the address lookup. A component of its own because FormField hands its id and aria props to its direct child, and a bare
 * Controller would swallow them (the label would point at nothing). A pick sets the other address fields as a typed value would: dirty and validated.
 */
export function AddressStreet({ control, setValue, ...aria }: { control: Control<ParticipantFormData>; setValue: UseFormSetValue<ParticipantFormData> } & Omit<AddressFieldProps, 'value' | 'onChange' | 'onPick'>) {
  const { field } = useController({ control, name: 'addressStreet' })
  return (
    <AddressField
      {...aria}
      value={field.value ?? ''}
      onChange={field.onChange}
      onBlur={field.onBlur}
      placeholder="e.g. 12 Example Street"
      onPick={(a) => {
        const filled = { shouldDirty: true, shouldValidate: true }
        setValue('addressSuburb', a.suburb, filled)
        setValue('addressState', a.state, filled)
        setValue('addressPostcode', a.postcode, filled)
      }}
    />
  )
}

export function ParticipantDetailsStep({ control, register, setValue, errors, livingArrangementValue }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  setValue: UseFormSetValue<ParticipantFormData>
  errors: FieldErrors<ParticipantFormData>
  livingArrangementValue: string | undefined
}) {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Card title="Personal Information">
        <div className={formGrid}>
          <FormField label="First Name" required error={errors.firstName?.message} className={span.medium}>
            <input id="firstName" {...register('firstName')} maxLength={100} placeholder="e.g. John" />
          </FormField>

          <FormField label="Last Name" required error={errors.lastName?.message} className={span.medium}>
            <input id="lastName" {...register('lastName')} maxLength={100} placeholder="e.g. Smith" />
          </FormField>

          <FormField label="Preferred Name" className={span.medium}>
            <input id="preferredName" {...register('preferredName')} maxLength={100} placeholder="e.g. Johnny" />
          </FormField>

          <FormField label="Date of Birth" className={span.date}>
            <input id="dateOfBirth" type="date" {...register('dateOfBirth')} />
          </FormField>

          <FormField label="Phone" error={errors.phone?.message} className={span.medium}>
            <input id="phone" type="tel" {...register('phone')} maxLength={30} placeholder="e.g. 0400 000 000" />
          </FormField>

          <FormField label="Email" error={errors.email?.message} className={span.medium}>
            <input id="email" type="email" {...register('email')} maxLength={200} placeholder="e.g. name@example.com" />
          </FormField>
        </div>
      </Card>

      <Card title="Address">
        <div className={formGrid}>
          <FormField label="Street" className={span.long}>
            <AddressStreet id="addressStreet" control={control} setValue={setValue} />
          </FormField>

          <FormField label="Suburb" className={span.medium}>
            <input id="addressSuburb" {...register('addressSuburb')} maxLength={100} placeholder="e.g. Fortitude Valley" />
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
                  items={ADDRESS_STATE_ITEMS}
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
                <input id="mainSupportPersonName" {...register('mainSupportPersonName')} maxLength={200} placeholder="e.g. Jane Citizen" />
              </FormField>
              <FormField label="Relationship to Participant" className={span.medium}>
                <input id="mainSupportPersonRelationship" {...register('mainSupportPersonRelationship')} maxLength={100} placeholder="e.g. Mother" />
              </FormField>
              <TextAreaField label="Others Living in the Accommodation" id="othersLivingInAccommodation" {...register('othersLivingInAccommodation')} maxLength={2000} rows={2} placeholder="Who else lives there..." className={span.long} />
              <TextAreaField label="Residential Information" id="residentialInfo" {...register('residentialInfo')} maxLength={2000} rows={2} placeholder="Home layout, accessibility..." className={span.long} />
            </>
          )}

          {livingArrangementValue === 'Independent' && (
            <>
              <CheckboxField label="Lives With Others" id="livesWithOthers" {...register('livesWithOthers')} className={span.short} />
              <FormField label="Who They Live With" required error={errors.whoLivesWith?.message} className={span.medium}>
                <input id="whoLivesWith" {...register('whoLivesWith')} maxLength={2000} placeholder="e.g. Housemates" />
              </FormField>
            </>
          )}

          {livingArrangementValue === 'SupportedAccommodation' && (
            <>
              <FormField label="SIL Provider Name" required error={errors.silProviderName?.message} className={span.medium}>
                <input id="silProviderName" {...register('silProviderName')} maxLength={200} placeholder="e.g. Sunrise SIL Services" />
              </FormField>
              <FormField label="SIL Provider Contact (Phone)" className={span.medium}>
                <input id="silProviderContactPhone" {...register('silProviderContactPhone')} maxLength={20} placeholder="e.g. 0400 000 000" />
              </FormField>
              <FormField label="Accommodation Type" className={span.medium}>
                <input id="accommodationType" {...register('accommodationType')} maxLength={100} placeholder="e.g. Group home" />
              </FormField>
              <FormField label="On-Site Support Hours" className={span.medium}>
                <input id="onSiteSupportHours" {...register('onSiteSupportHours')} maxLength={100} placeholder="e.g. 24/7 or 9-5 weekdays" />
              </FormField>
            </>
          )}

          {!!livingArrangementValue && (
            <TextAreaField label="Living Arrangement Notes" id="livingArrangementNotes" {...register('livingArrangementNotes')} maxLength={2000} rows={2} placeholder="Any additional notes..." className={span.long} />
          )}
        </div>
      </Card>
    </div>
  )
}
