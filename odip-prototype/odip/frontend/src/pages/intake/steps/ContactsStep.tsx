/**
 * PF-10.3 — Intake wizard, "Contacts" step. `contactRoles` is the one Contacts-step field
 * (`entryPhase: 'intake'`, `sources: ['shared']`) — captured once, here, per PF-10.1's
 * "any common fields should be removed for the time being" allocation. Reused verbatim (JSX,
 * validation, payload shape) from `the retired single-step wizard`'s create-mode Contacts step — this
 * wizard is create-only, so the edit-mode branch (nested-CRUD read-only summary) isn't ported.
 */
import type { Control, FieldErrors, UseFormRegister, UseFieldArrayReturn, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import { Controller } from 'react-hook-form'
import { Plus, Trash2 } from 'lucide-react'
import { FormField } from '@/components/FormField'
import { CheckboxField } from '@/components/CheckboxField'
import { Card } from '@/components/Card'
import { SearchableSelect } from '@/components/SearchableSelect'
import { ToggleGroup } from '@/components/ToggleGroup'
import { CONTACT_ROLE_TYPES } from '@/api/types/enums'
import type { ContactRoleType, PlanType } from '@/api/types/enums'
import { CONTACT_ROLE_TYPE_LABELS, availableContactRoleTypes, selectableContactRoleTypes, contactRoleGateError, unionRelevantFields } from '@/api/types/contacts'
import type { PersonDto } from '@/api/types/contacts'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { PlanTypeComplianceBanner } from '../intakeHelpers'

export function ContactsStep({
  control, register, errors, setValue, watch, people,
  contactRoleFieldArray, planTypeComplianceWarningValue,
}: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  errors: FieldErrors<ParticipantFormData>
  setValue: UseFormSetValue<ParticipantFormData>
  watch: UseFormWatch<ParticipantFormData>
  people: PersonDto[]
  contactRoleFieldArray: UseFieldArrayReturn<ParticipantFormData, 'contactRoles'>
  planTypeComplianceWarningValue: string | null
}) {
  const { fields: contactRoleFields, append: appendContactRole, remove: removeContactRole } = contactRoleFieldArray
  const planType = watch('planType') as PlanType | undefined
  const dateOfBirth = watch('dateOfBirth')

  return (
    <div className="grid md:grid-cols-1 gap-6">
      <Card title="Contacts" className="space-y-3">
        <PlanTypeComplianceBanner message={planTypeComplianceWarningValue} />
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Add next of kin, guardians, support coordinators, plan managers, and other key
          contacts. Optional here — richer per-role details (e.g. a guardian's tribunal
          order, a nominee's scope) can be filled in from the Contacts tab after saving.
        </p>
        {contactRoleFields.length > 0 && (
          <div className="space-y-3">
            {contactRoleFields.map((field, index) => {
              const row = watch(`contactRoles.${index}`)
              const rowRoleTypes = ((row?.roleTypes as ContactRoleType[] | undefined) ?? ['NextOfKin'])
              const available = selectableContactRoleTypes(CONTACT_ROLE_TYPES, planType, dateOfBirth)
              const gateErrors = rowRoleTypes
                .map(rt => ({ rt, msg: contactRoleGateError(rt, planType, dateOfBirth, row?.registeredProviderFlag) }))
                .filter((e): e is { rt: ContactRoleType; msg: string } => !!e.msg)
              const rowVisibleFields = unionRelevantFields(rowRoleTypes)
              return (
                <div key={field.id} className="p-3 rounded-lg border border-[var(--color-border)] space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-3">
                      <FormField label="Person" className="mb-0">
                        <ToggleGroup
                          options={[
                            { key: 'existing', label: 'Existing person' },
                            { key: 'new', label: 'New person' },
                          ]}
                          value={row?.personMode ?? 'existing'}
                          onChange={mode => setValue(`contactRoles.${index}.personMode`, mode as 'existing' | 'new', { shouldDirty: true })}
                          ariaLabel="Person"
                        />
                      </FormField>

                      {(row?.personMode ?? 'existing') === 'existing' ? (
                        <FormField
                          label="Select person"
                          required
                          error={errors.contactRoles?.[index]?.personId?.message}
                          className="mb-0"
                        >
                          <Controller
                            control={control}
                            name={`contactRoles.${index}.personId`}
                            render={({ field: personField }) => (
                              <SearchableSelect
                                value={personField.value ?? ''}
                                onChange={personField.onChange}
                                onBlur={personField.onBlur}
                                items={people.map(p => ({ value: p.id, label: p.fullName, description: p.organisation ?? undefined }))}
                                placeholder="Search people…"
                                emptyMessage="No people yet — add a new person instead"
                              />
                            )}
                          />
                        </FormField>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <FormField
                            label="First name"
                            required
                            error={errors.contactRoles?.[index]?.newPersonFirstName?.message}
                            className="mb-0"
                          >
                            <input {...register(`contactRoles.${index}.newPersonFirstName`)} />
                          </FormField>
                          <FormField label="Last name" className="mb-0">
                            <input {...register(`contactRoles.${index}.newPersonLastName`)} />
                          </FormField>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeContactRole(index)}
                      aria-label={`Remove contact ${index + 1}`}
                      title="Remove contact"
                      className="mt-6 p-1.5 min-w-[44px] min-h-[44px] rounded-lg text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <FormField label="Role types" className="mb-0" error={errors.contactRoles?.[index]?.roleTypes?.message}>
                    <div className="flex flex-wrap gap-2">
                      {CONTACT_ROLE_TYPES.map(rt => {
                        const checked = rowRoleTypes.includes(rt)
                        const disabled = !available.includes(rt) && !checked
                        return (
                          <label
                            key={rt}
                            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border cursor-pointer min-h-[36px] transition-colors ${
                              checked ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-[var(--color-border)]'
                            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={e => {
                                const next = e.target.checked
                                  ? [...rowRoleTypes, rt]
                                  : rowRoleTypes.filter(r => r !== rt)
                                setValue(`contactRoles.${index}.roleTypes`, next, { shouldDirty: true })
                              }}
                              className="w-3.5 h-3.5 rounded border-[var(--color-border)]"
                            />
                            {CONTACT_ROLE_TYPE_LABELS[rt]}
                          </label>
                        )
                      })}
                    </div>
                  </FormField>
                  <FormField label="Relationship to participant" className="mb-0">
                    <input {...register(`contactRoles.${index}.relationshipToParticipant`)} placeholder="e.g. Mother" />
                  </FormField>
                  {gateErrors.map(({ rt, msg }) => (
                    <p key={rt} role="alert" className="text-xs text-[var(--color-destructive)]">
                      {rowRoleTypes.length > 1 ? `${CONTACT_ROLE_TYPE_LABELS[rt]}: ${msg}` : msg}
                    </p>
                  ))}
                  {rowVisibleFields.includes('registeredProviderFlag') && (
                    <CheckboxField
                      label="Registered NDIS provider"
                      className="mb-0"
                      hint={planType === 'AgencyManaged' ? 'Required for agency-managed participants' : undefined}
                      {...register(`contactRoles.${index}.registeredProviderFlag`)}
                    />
                  )}
                  <CheckboxField label="Primary" className="mb-0" {...register(`contactRoles.${index}.isPrimary`)} />
                </div>
              )
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => appendContactRole({ personMode: 'existing', personId: '', newPersonFirstName: '', newPersonLastName: '', roleTypes: [availableContactRoleTypes(CONTACT_ROLE_TYPES, planType, dateOfBirth)[0] ?? 'NextOfKin'], relationshipToParticipant: '', isPrimary: false, registeredProviderFlag: false })}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 text-sm font-medium text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-lg"
        >
          <Plus className="w-4 h-4" /> Add contact
        </button>
      </Card>
    </div>
  )
}
