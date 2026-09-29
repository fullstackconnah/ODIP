/**
 * PF-10.3 — Intake wizard, "Medical Summary" step. Per PF-10.1's fission table, only the shared
 * free-text `medicalSummary` and the ungated `hidpaNotes` are `entryPhase: 'intake'` — the
 * structured Diagnoses/HIDPA-categories/Allergies/health-condition-grid content is Profile-only
 * (PF-10.4).
 */
import type { UseFormRegister } from 'react-hook-form'
import { TextAreaField } from '@/components/TextAreaField'
import { Card } from '@/components/Card'
import type { ParticipantFormData } from '@/lib/participantSchema'

export function MedicalSummaryStep({ register }: { register: UseFormRegister<ParticipantFormData> }) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card title="Medical Summary" className="space-y-4 md:col-span-2">
        <TextAreaField label="Medical Summary" hint="Free-text health conditions/diagnoses — the shared coversheet line both source forms carry." id="medicalSummary" {...register('medicalSummary')} rows={4} placeholder="Medical information..." />
        <TextAreaField label="HIDPA Notes" hint="Free-text elaboration, e.g. why 'None of the above' applies, or detail alongside a ticked category." id="hidpaNotes" {...register('hidpaNotes')} rows={2} placeholder="Additional HIDPA notes..." />
      </Card>
    </div>
  )
}
