/**
 * PF-10.3 — Intake wizard, "Risks & Hazards" step. `behaviourRiskSummary`/`notes`/`riskEntries`
 * are all `entryPhase: 'intake'` — this step is a full, unmodified port of
 * ParticipantCreatePage.tsx's create-mode Risks & Hazards content (INTAKE-09's create-mode-only
 * repeatable risk-entry register formalised as belonging to Intake).
 */
import type { Control, FieldErrors, UseFormRegister, UseFieldArrayReturn } from 'react-hook-form'
import { Plus, Trash2 } from 'lucide-react'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { Dropdown } from '@/components/Dropdown'
import { Controller } from 'react-hook-form'
import { AT_RISK_PARTIES } from '@/api/types/enums'
import { AT_RISK_PARTY_LABELS } from '@/api/types/risk-entries'
import type { ParticipantFormData } from '@/lib/participantSchema'

export function RisksHazardsStep({ control, register, errors, riskEntryFieldArray }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  errors: FieldErrors<ParticipantFormData>
  riskEntryFieldArray: UseFieldArrayReturn<ParticipantFormData, 'riskEntries'>
}) {
  const { fields: riskEntryFields, append: appendRiskEntry, remove: removeRiskEntry } = riskEntryFieldArray
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card title="Risks & Hazards" className="space-y-4">
        <FormField label="Behaviour Risk Summary">
          <textarea id="behaviourRiskSummary" {...register('behaviourRiskSummary')} rows={3} placeholder="Behaviour risk notes..." />
        </FormField>

        <FormField label="General Notes">
          <textarea id="notes" {...register('notes')} rows={3} placeholder="Any additional notes..." />
        </FormField>
      </Card>

      <Card title="Risk Entries" className="space-y-3">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Capture potential risks in supporting this participant, categorised by who is at
          risk. Optional — add a row for each risk identified at intake.
        </p>
        {riskEntryFields.length > 0 && (
          <div className="space-y-3">
            {riskEntryFields.map((field, index) => (
              <div key={field.id} className="p-3 rounded-lg border border-[var(--color-border)] space-y-3">
                <div className="flex items-start gap-2">
                  <FormField label="At Risk" className="flex-1 mb-0">
                    <Controller
                      control={control}
                      name={`riskEntries.${index}.atRiskParty`}
                      render={({ field: partyField }) => (
                        <Dropdown
                          id={`riskEntries.${index}.atRiskParty`}
                          variant="form"
                          value={partyField.value ?? ''}
                          onChange={partyField.onChange}
                          onBlur={partyField.onBlur}
                          items={AT_RISK_PARTIES.map((party) => ({ value: party, label: AT_RISK_PARTY_LABELS[party] }))}
                        />
                      )}
                    />
                  </FormField>
                  <button
                    type="button"
                    onClick={() => removeRiskEntry(index)}
                    aria-label={`Remove risk entry ${index + 1}`}
                    title="Remove risk entry"
                    className="mt-6 p-1.5 min-w-[44px] min-h-[44px] rounded-lg text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <FormField label="Description" required error={errors.riskEntries?.[index]?.description?.message} className="mb-0">
                  <textarea
                    id={`riskEntries.${index}.description`}
                    {...register(`riskEntries.${index}.description`)}
                    rows={2}
                    placeholder="Describe the risk..."
                  />
                </FormField>
                <FormField label="Mitigation Notes" className="mb-0">
                  <textarea
                    id={`riskEntries.${index}.mitigationNotes`}
                    {...register(`riskEntries.${index}.mitigationNotes`)}
                    rows={2}
                    placeholder="How this risk is mitigated (optional)..."
                  />
                </FormField>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => appendRiskEntry({ atRiskParty: 'Participant', description: '', mitigationNotes: '' })}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 text-sm font-medium text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-lg"
        >
          <Plus className="w-4 h-4" /> Add risk entry
        </button>
      </Card>
    </div>
  )
}
