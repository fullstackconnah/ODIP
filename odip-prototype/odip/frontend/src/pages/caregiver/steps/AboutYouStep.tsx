import type { FieldErrors, UseFormRegister } from 'react-hook-form'
import { FormField } from '@/components/FormField'
import type { CaregiverFormData } from '../CaregiverWizardPage'

/** Step 0 of the caregiver wizard — gates every later step (see useWizard's `validate`): no step
 * beyond this one is reachable until a name is entered. Relationship is optional. */
export function AboutYouStep({ register, errors }: {
  register: UseFormRegister<CaregiverFormData>
  errors: FieldErrors<CaregiverFormData>
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Please tell us who you are before reviewing the information. Your name is recorded against any changes you make.
      </p>
      <FormField label="Your name" required error={errors.caregiverName?.message}>
        <input type="text" autoComplete="name" {...register('caregiverName')} />
      </FormField>
      <FormField label="Relationship to the participant" hint="For example: mother, brother, guardian">
        <input type="text" {...register('caregiverRelationship')} />
      </FormField>
    </div>
  )
}
