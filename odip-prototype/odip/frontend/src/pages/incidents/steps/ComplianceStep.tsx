import type { UseFormRegister, UseFormSetValue } from 'react-hook-form'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { INCIDENT_STATUSES, INCIDENT_STATUS_LABELS, QSC_REPORTING_STATUSES, QSC_REPORTING_STATUS_LABELS } from '@/api/types/enums'
import type { StaffListDto } from '@/api/types'
import type { IncidentFormData } from '../incidentFormSchema'
import { formGrid, span } from '@/lib/formGrid'

export type ComplianceStepProps = {
  register: UseFormRegister<IncidentFormData>
  setValue: UseFormSetValue<IncidentFormData>
  status: string | undefined
  qscReportingStatus: string | undefined
  reviewedByStaffId: string | undefined
  familyNotified: boolean | undefined
  supportCoordinatorNotified: boolean | undefined
  staff: StaffListDto[]
}

/**
 * Edit-mode-only "Review & Compliance" step — see SPEC-04's "Edit-mode-only fields and the zod
 * resolver workaround" section. Entirely absent from the step list on create; present as the
 * second-to-last step (right before Review) when editing. Every field here is optional today and
 * stays optional (no error props needed — nothing here is ever a validation failure). Status/QSC
 * Reporting Status migrate off native <select> here, closing out the last 2 of GEN-1's 6
 * incident-page selects deferred to SPEC-04 (serviceType/tripInstanceId/incidentType/severity are
 * IN-3's, covered in BasicsStep).
 */
export function ComplianceStep({
  register, setValue,
  status, qscReportingStatus, reviewedByStaffId, familyNotified, supportCoordinatorNotified,
  staff,
}: ComplianceStepProps) {
  return (
    <Card title="Review & Compliance">
      <div className={formGrid}>
        <FormField label="Status" className={span.short}>
          <Dropdown
            variant="form"
            value={status ?? 'Draft'}
            onChange={(v) => setValue('status', v, { shouldDirty: true })}
            items={INCIDENT_STATUSES.map((s) => ({ value: s, label: INCIDENT_STATUS_LABELS[s] }))}
          />
        </FormField>

        <FormField label="QSC Reporting Status" className={span.short}>
          <Dropdown
            variant="form"
            value={qscReportingStatus ?? 'NotRequired'}
            onChange={(v) => setValue('qscReportingStatus', v, { shouldDirty: true })}
            items={QSC_REPORTING_STATUSES.map((s) => ({ value: s, label: QSC_REPORTING_STATUS_LABELS[s] }))}
          />
        </FormField>

        <FormField label="QSC Reference Number" className={span.short}>
          <input {...register('qscReferenceNumber')} placeholder="QSC reference #" />
        </FormField>

        <FormField label="QSC Reported At" className={span.date}>
          <input type="datetime-local" {...register('qscReportedAt')} />
        </FormField>

        <FormField label="Reviewed By" className={span.medium}>
          <SearchableSelect
            value={reviewedByStaffId ?? ''}
            onChange={(v) => setValue('reviewedByStaffId', v, { shouldDirty: true })}
            items={[
              { value: '', label: 'Not reviewed' },
              ...staff.map((s: StaffListDto) => ({ value: s.id, label: s.fullName })),
            ]}
          />
        </FormField>

        <FormField label="Review Notes" className={span.long}>
          <textarea {...register('reviewNotes')} rows={3} placeholder="Notes from the reviewer..." />
        </FormField>

        <FormField label="Corrective Actions" className={span.long}>
          <textarea {...register('correctiveActions')} rows={3} placeholder="Actions to prevent recurrence..." />
        </FormField>

        <div className={`${span.medium} space-y-1`}>
          <FormField label="Family Notified" layout="checkbox">
            <input type="checkbox" {...register('familyNotified')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
          {familyNotified && (
            <FormField label="Family Notified At">
              <input type="datetime-local" {...register('familyNotifiedAt')} />
            </FormField>
          )}
        </div>

        <div className={`${span.medium} space-y-1`}>
          <FormField label="Support Coordinator Notified" layout="checkbox">
            <input type="checkbox" {...register('supportCoordinatorNotified')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
          {supportCoordinatorNotified && (
            <FormField label="Support Coordinator Notified At">
              <input type="datetime-local" {...register('supportCoordinatorNotifiedAt')} />
            </FormField>
          )}
        </div>
      </div>
    </Card>
  )
}
