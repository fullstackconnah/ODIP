/**
 * PF-10.4 — Profile wizard, "Key Identifiers" step. Owns every entryPhase:'profile' field with no
 * other natural home (see participantSchema.ts's PROFILE_STEP_KEY_IDENTIFIERS_FIELDS doc for the
 * placement note) plus the 13 Key-Identifiers-proper fields. Shared/Intake-owned companion fields
 * (name/DOB/contact/address/NDIS plan) render read-only per PF-10.1's allocation contract.
 */
import { Controller } from 'react-hook-form'
import type { Control, UseFormRegister, FieldErrors } from 'react-hook-form'
import { Card } from '@/components/Card'
import { FormField } from '@/components/FormField'
import { SearchableSelect } from '@/components/SearchableSelect'
import type { ParticipantFormData } from '@/lib/participantSchema'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { GENDER_LABELS } from '@/api/types/participants'
import { GENDERS } from '@/api/types/enums'
import { ReadOnlyField, ReadOnlyGroupField } from '../profileHelpers'

export function KeyIdentifiersStep({ control, register, errors, participant, activeStaff }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  errors: FieldErrors<ParticipantFormData>
  participant: ParticipantDetailDto
  activeStaff: { id: string; fullName: string }[]
}) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card title="Identity (from Intake)" className="space-y-4">
        <ReadOnlyField field="firstName" label="First Name" value={participant.firstName || '—'} />
        <ReadOnlyField field="lastName" label="Last Name" value={participant.lastName || '—'} />
        <ReadOnlyField field="preferredName" label="Preferred Name" value={participant.preferredName || '—'} />
        <ReadOnlyField field="dateOfBirth" label="Date of Birth" value={participant.dateOfBirth || '—'} />
        <ReadOnlyField field="phone" label="Phone" value={participant.phone || '—'} />
        <ReadOnlyField field="email" label="Email" value={participant.email || '—'} />
        <ReadOnlyField field="addressStreet" label="Address — Street" value={participant.addressStreet || '—'} />
        <ReadOnlyField field="addressSuburb" label="Address — Suburb" value={participant.addressSuburb || '—'} />
        <ReadOnlyField field="addressState" label="Address — State" value={participant.addressState || '—'} />
        <ReadOnlyField field="addressPostcode" label="Address — Postcode" value={participant.addressPostcode || '—'} />
        <ReadOnlyField field="ndisNumber" label="NDIS Number" value={participant.ndisNumber || '—'} />
        <ReadOnlyField field="planStartDate" label="Plan Start Date" value={participant.planStartDate || '—'} />
        <ReadOnlyField field="planEndDate" label="Plan End Date" value={participant.planEndDate || '—'} />
        <ReadOnlyField field="planType" label="Plan Type" value={participant.planType || '—'} />
        <ReadOnlyField field="fundingSource" label="Funding Source" value={participant.fundingSource || '—'} />
        <ReadOnlyGroupField field="contactRoles" label="Contacts">
          Managed on the participant's Contacts tab.
        </ReadOnlyGroupField>
      </Card>

      <div className="space-y-6">
        <Card title="Additional Personal Details" className="space-y-4">
          <FormField label="Middle Name">
            <input id="middleName" {...register('middleName')} />
          </FormField>
          <FormField label="Gender">
            <select id="gender" {...register('gender')}>
              <option value="">Not specified</option>
              {GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}
            </select>
          </FormField>
          <FormField label="Gender Self-Description">
            <input id="genderSelfDescription" {...register('genderSelfDescription')} />
          </FormField>
          <FormField label="Place of Birth">
            <input id="placeOfBirth" {...register('placeOfBirth')} />
          </FormField>
          <FormField label="Country">
            <input id="country" {...register('country')} />
          </FormField>
          <FormField label="Preferred Staff Member">
            <Controller
              control={control}
              name="preferredStaffId"
              render={({ field }) => (
                <SearchableSelect
                  id="preferredStaffId"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  items={[{ value: '', label: 'None' }, ...activeStaff.map((s) => ({ value: s.id, label: s.fullName }))]}
                />
              )}
            />
          </FormField>
          <FormField label="Disability Support for Older Australians (DSOA)" layout="checkbox">
            <input type="checkbox" id="isDsoa" {...register('isDsoa')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
        </Card>

        <Card title="Identification Cards" className="space-y-4">
          <FormField label="Pension Card Number"><input id="pensionCardNumber" {...register('pensionCardNumber')} /></FormField>
          <FormField label="Pension Card Expiry"><input id="pensionCardExpiry" type="date" {...register('pensionCardExpiry')} /></FormField>
          <FormField label="Medicare Number"><input id="medicareNumber" {...register('medicareNumber')} /></FormField>
          <FormField label="Medicare Expiry"><input id="medicareExpiry" type="date" {...register('medicareExpiry')} /></FormField>
          <FormField label="Companion Card Number"><input id="companionCardNumber" {...register('companionCardNumber')} /></FormField>
          <FormField label="Companion Card Expiry"><input id="companionCardExpiry" type="date" {...register('companionCardExpiry')} /></FormField>
        </Card>

        <Card title="Private Health, Taxi Card & Physical Description" className="space-y-4">
          <FormField label="Private Health Fund"><input id="privateHealthFund" {...register('privateHealthFund')} /></FormField>
          <FormField label="Private Health Membership Number"><input id="privateHealthMembershipNumber" {...register('privateHealthMembershipNumber')} /></FormField>
          <FormField label="Taxi Card Number"><input id="taxiCardNumber" {...register('taxiCardNumber')} /></FormField>
          <FormField label="Hair Colour"><input id="hairColour" {...register('hairColour')} /></FormField>
          <FormField label="Eye Colour"><input id="eyeColour" {...register('eyeColour')} /></FormField>
          <FormField label="Weight (kg)" error={errors.weightKg?.message}>
            <input id="weightKg" type="number" min="0" max="999.99" step="0.1" {...register('weightKg')} />
          </FormField>
          <FormField label="Height (cm)" error={errors.heightCm?.message}>
            <input id="heightCm" type="number" min="0" max="999.99" step="0.1" {...register('heightCm')} />
          </FormField>
        </Card>
      </div>
    </div>
  )
}
