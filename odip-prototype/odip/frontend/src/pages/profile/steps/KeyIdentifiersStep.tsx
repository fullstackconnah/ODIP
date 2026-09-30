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
import { CheckboxField } from '@/components/CheckboxField'
import { SearchableSelect } from '@/components/SearchableSelect'
import type { ParticipantFormData } from '@/lib/participantSchema'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { GENDER_LABELS } from '@/api/types/participants'
import { GENDERS } from '@/api/types/enums'
import { ReadOnlyField, ReadOnlyGroupField } from '../profileHelpers'
import { formGrid, span } from '@/lib/formGrid'

const EMPTY: ReadonlySet<string> = new Set()

export function KeyIdentifiersStep({ control, register, errors, participant, activeStaff, hiddenFields }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  errors: FieldErrors<ParticipantFormData>
  participant: ParticipantDetailDto
  activeStaff: { id: string; fullName: string }[]
  /** Field ids to omit entirely — e.g. the caregiver wizard's CAREGIVER_INTERNAL_FIELDS. Defaults
   * to empty, so every existing Profile-wizard caller is unaffected. */
  hiddenFields?: ReadonlySet<string>
}) {
  const hidden = hiddenFields ?? EMPTY
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Card title="Identity (from Intake)">
        <div className={formGrid}>
          <ReadOnlyField field="firstName" label="First Name" value={participant.firstName || '—'} className={span.medium} />
          <ReadOnlyField field="lastName" label="Last Name" value={participant.lastName || '—'} className={span.medium} />
          <ReadOnlyField field="preferredName" label="Preferred Name" value={participant.preferredName || '—'} className={span.medium} />
          <ReadOnlyField field="dateOfBirth" label="Date of Birth" value={participant.dateOfBirth || '—'} className={span.short} />
          <ReadOnlyField field="phone" label="Phone" value={participant.phone || '—'} className={span.medium} />
          <ReadOnlyField field="email" label="Email" value={participant.email || '—'} className={span.medium} />
          <ReadOnlyField field="addressStreet" label="Address — Street" value={participant.addressStreet || '—'} className={span.long} />
          <ReadOnlyField field="addressSuburb" label="Address — Suburb" value={participant.addressSuburb || '—'} className={span.medium} />
          <ReadOnlyField field="addressState" label="Address — State" value={participant.addressState || '—'} className={span.short} />
          <ReadOnlyField field="addressPostcode" label="Address — Postcode" value={participant.addressPostcode || '—'} className={span.short} />
          <ReadOnlyField field="ndisNumber" label="NDIS Number" value={participant.ndisNumber || '—'} className={span.short} />
          <ReadOnlyField field="planStartDate" label="Plan Start Date" value={participant.planStartDate || '—'} className={span.short} />
          <ReadOnlyField field="planEndDate" label="Plan End Date" value={participant.planEndDate || '—'} className={span.short} />
          <ReadOnlyField field="planType" label="Plan Type" value={participant.planType || '—'} className={span.short} />
          <ReadOnlyField field="fundingSource" label="Funding Source" value={participant.fundingSource || '—'} className={span.medium} />
          <ReadOnlyGroupField field="contactRoles" label="Contacts" className={span.long}>
            Managed on the participant's Contacts tab.
          </ReadOnlyGroupField>
        </div>
      </Card>

      <Card title="Additional Personal Details">
        <div className={formGrid}>
          <FormField label="Middle Name" className={span.medium}>
            <input id="middleName" {...register('middleName')} />
          </FormField>
          <FormField label="Gender" className={span.short}>
            <select id="gender" {...register('gender')}>
              <option value="">Not specified</option>
              {GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}
            </select>
          </FormField>
          <FormField label="Gender Self-Description" className={span.medium}>
            <input id="genderSelfDescription" {...register('genderSelfDescription')} />
          </FormField>
          <FormField label="Place of Birth" className={span.medium}>
            <input id="placeOfBirth" {...register('placeOfBirth')} />
          </FormField>
          <FormField label="Country" className={span.medium}>
            <input id="country" {...register('country')} />
          </FormField>
          {!hidden.has('preferredStaffId') && (
            <FormField label="Preferred Staff Member" className={span.medium}>
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
          )}
          <CheckboxField label="Disability Support for Older Australians (DSOA)" id="isDsoa" {...register('isDsoa')} className={span.medium} />
        </div>
      </Card>

      <Card title="Identification Cards">
        <div className={formGrid}>
          <FormField label="Pension Card Number" className={span.medium}><input id="pensionCardNumber" {...register('pensionCardNumber')} /></FormField>
          <FormField label="Pension Card Expiry" className={span.short}><input id="pensionCardExpiry" type="date" {...register('pensionCardExpiry')} /></FormField>
          <FormField label="Medicare Number" className={span.medium}><input id="medicareNumber" {...register('medicareNumber')} /></FormField>
          <FormField label="Medicare Expiry" className={span.short}><input id="medicareExpiry" type="date" {...register('medicareExpiry')} /></FormField>
          <FormField label="Companion Card Number" className={span.medium}><input id="companionCardNumber" {...register('companionCardNumber')} /></FormField>
          <FormField label="Companion Card Expiry" className={span.short}><input id="companionCardExpiry" type="date" {...register('companionCardExpiry')} /></FormField>
        </div>
      </Card>

      <Card title="Private Health, Taxi Card & Physical Description">
        <div className={formGrid}>
          <FormField label="Private Health Fund" className={span.medium}><input id="privateHealthFund" {...register('privateHealthFund')} /></FormField>
          <FormField label="Private Health Membership Number" className={span.medium}><input id="privateHealthMembershipNumber" {...register('privateHealthMembershipNumber')} /></FormField>
          <FormField label="Taxi Card Number" className={span.medium}><input id="taxiCardNumber" {...register('taxiCardNumber')} /></FormField>
          <FormField label="Hair Colour" className={span.short}><input id="hairColour" {...register('hairColour')} /></FormField>
          <FormField label="Eye Colour" className={span.short}><input id="eyeColour" {...register('eyeColour')} /></FormField>
          <FormField label="Weight (kg)" error={errors.weightKg?.message} className={span.short}>
            <input id="weightKg" type="number" min="0" max="999.99" step="0.1" {...register('weightKg')} />
          </FormField>
          <FormField label="Height (cm)" error={errors.heightCm?.message} className={span.short}>
            <input id="heightCm" type="number" min="0" max="999.99" step="0.1" {...register('heightCm')} />
          </FormField>
        </div>
      </Card>
    </div>
  )
}
