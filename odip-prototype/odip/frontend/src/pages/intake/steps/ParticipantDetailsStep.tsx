/**
 * PF-10.3 — Intake wizard, "Participant Details" step. Covers the Identity-step subset of
 * `fieldsForEntry('intake')`: core identity, structured address (INTAKE-06), and the Living
 * Arrangements block (LIVING-01..04) — every field this section renders is `entryPhase: 'intake'`
 * per `documentMapping.ts`; Profile-only Identity fields (middleName, gender,
 * genderSelfDescription, placeOfBirth, country, preferredStaffId) are simply absent.
 *
 * Per-type Living Arrangement fields are shown/hidden by a plain `livingArrangement === '...'`
 * check here rather than the full `src/lib/conditionalFields.ts` INTAKE-07 engine
 * `ParticipantCreatePage.tsx` uses — a deliberate scope simplification for this smaller field set
 * (see this branch's report); the underlying zod refine (`livingArrangementRefine`) still enforces
 * the same required-ness regardless of what's visually hidden.
 */
import type { Control, FieldErrors, UseFormRegister } from 'react-hook-form'
import { Controller } from 'react-hook-form'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { AU_STATES, LIVING_ARRANGEMENTS } from '@/api/types/enums'
import { LIVING_ARRANGEMENT_LABELS } from '@/api/types/participants'
import type { ParticipantFormData } from '@/lib/participantSchema'

export function ParticipantDetailsStep({ control, register, errors, livingArrangementValue }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  errors: FieldErrors<ParticipantFormData>
  livingArrangementValue: string | undefined
}) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card title="Personal Information" className="space-y-4">
        <FormField label="First Name" required error={errors.firstName?.message}>
          <input id="firstName" {...register('firstName')} placeholder="e.g. John" />
        </FormField>

        <FormField label="Last Name" required error={errors.lastName?.message}>
          <input id="lastName" {...register('lastName')} placeholder="e.g. Smith" />
        </FormField>

        <FormField label="Preferred Name">
          <input id="preferredName" {...register('preferredName')} placeholder="e.g. Johnny" />
        </FormField>

        <FormField label="Date of Birth">
          <input id="dateOfBirth" type="date" {...register('dateOfBirth')} />
        </FormField>

        <FormField label="Phone" error={errors.phone?.message}>
          <input id="phone" type="tel" {...register('phone')} placeholder="e.g. 0400 000 000" />
        </FormField>

        <FormField label="Email" error={errors.email?.message}>
          <input id="email" type="email" {...register('email')} placeholder="e.g. name@example.com" />
        </FormField>
      </Card>

      <Card title="Address" className="space-y-4">
        <FormField label="Street">
          <input id="addressStreet" {...register('addressStreet')} placeholder="e.g. 12 Example Street" />
        </FormField>

        <FormField label="Suburb">
          <input id="addressSuburb" {...register('addressSuburb')} placeholder="e.g. Fortitude Valley" />
        </FormField>

        <FormField label="State">
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

        <FormField label="Postcode" error={errors.addressPostcode?.message} hint="4 digits, e.g. 4000">
          <input id="addressPostcode" {...register('addressPostcode')} inputMode="numeric" maxLength={4} placeholder="e.g. 4000" />
        </FormField>
      </Card>

      <Card title="Living Arrangements" className="space-y-4 md:col-span-2">
        <FormField label="Living Arrangement">
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
            <FormField label="Main Support Person" required error={errors.mainSupportPersonName?.message}>
              <input id="mainSupportPersonName" {...register('mainSupportPersonName')} placeholder="e.g. Jane Citizen" />
            </FormField>
            <FormField label="Relationship to Participant">
              <input id="mainSupportPersonRelationship" {...register('mainSupportPersonRelationship')} placeholder="e.g. Mother" />
            </FormField>
            <FormField label="Others Living in the Accommodation">
              <textarea id="othersLivingInAccommodation" {...register('othersLivingInAccommodation')} rows={2} placeholder="Who else lives there..." />
            </FormField>
            <FormField label="Residential Information">
              <textarea id="residentialInfo" {...register('residentialInfo')} rows={2} placeholder="Home layout, accessibility..." />
            </FormField>
          </>
        )}

        {livingArrangementValue === 'Independent' && (
          <>
            <FormField label="Lives With Others" layout="checkbox">
              <input id="livesWithOthers" type="checkbox" {...register('livesWithOthers')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>
            <FormField label="Who They Live With" required error={errors.whoLivesWith?.message}>
              <input id="whoLivesWith" {...register('whoLivesWith')} placeholder="e.g. Housemates" />
            </FormField>
          </>
        )}

        {livingArrangementValue === 'SupportedAccommodation' && (
          <>
            <FormField label="SIL Provider Name" required error={errors.silProviderName?.message}>
              <input id="silProviderName" {...register('silProviderName')} placeholder="e.g. Sunrise SIL Services" />
            </FormField>
            <FormField label="SIL Provider Contact (Phone)">
              <input id="silProviderContactPhone" {...register('silProviderContactPhone')} placeholder="e.g. 0400 000 000" />
            </FormField>
            <FormField label="Accommodation Type">
              <input id="accommodationType" {...register('accommodationType')} placeholder="e.g. Group home" />
            </FormField>
            <FormField label="On-Site Support Hours">
              <input id="onSiteSupportHours" {...register('onSiteSupportHours')} placeholder="e.g. 24/7 or 9-5 weekdays" />
            </FormField>
          </>
        )}

        {!!livingArrangementValue && (
          <FormField label="Living Arrangement Notes">
            <textarea id="livingArrangementNotes" {...register('livingArrangementNotes')} rows={2} placeholder="Any additional notes..." />
          </FormField>
        )}
      </Card>
    </div>
  )
}
