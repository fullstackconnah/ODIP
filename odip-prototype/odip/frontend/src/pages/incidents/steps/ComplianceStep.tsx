import type { FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { INCIDENT_STATUSES, INCIDENT_STATUS_LABELS, REPORTABLE_CLASSES, REPORTABLE_CLASS_LABELS } from '@/api/types/enums'
import type { StaffListDto } from '@/api/types'
import type { IncidentFormData } from '../incidentFormSchema'
import { formGrid, span } from '@/lib/formGrid'
import { defaultReportableClass } from '../reportingDue'

export type ComplianceStepProps = {
  register: UseFormRegister<IncidentFormData>
  setValue: UseFormSetValue<IncidentFormData>
  status: string | undefined
  errors: FieldErrors<IncidentFormData>
  /** Provider-zone "now" as a datetime-local value: the latest the aware time can be. */
  awareAtMax: string
  severity: string | undefined
  incidentType: string | undefined
  /** The stored flag: the default deadline depends on it. */
  isRestrictivePracticeAuthorised: boolean | null | undefined
  reportableClass: string | undefined
  commissionFinalReportRequested: boolean | undefined
  reviewedByStaffId: string | undefined
  familyNotified: boolean | undefined
  supportCoordinatorNotified: boolean | undefined
  staff: StaffListDto[]
}

/**
 * Edit-mode-only "Review & Compliance" step — see SPEC-04's "Edit-mode-only fields and the zod
 * resolver workaround" section. Entirely absent from the step list on create; present as the
 * second-to-last step (right before Review) when editing. Every field here is optional today and
 * stays optional, except the reason for moving the reporting deadline off its default. The QSC status is derived on the server, so it is not
 * edited here (N1 incident clock).
 */
export function ComplianceStep({
  register, setValue,
  status, errors, awareAtMax, severity, incidentType, isRestrictivePracticeAuthorised, reportableClass, commissionFinalReportRequested, reviewedByStaffId, familyNotified, supportCoordinatorNotified,
  staff,
}: ComplianceStepProps) {
  return (
    <Card title="Review & compliance">
      <div className={formGrid}>
        <FormField label="Status" className={span.short}>
          <Dropdown
            variant="form"
            value={status ?? 'Draft'}
            onChange={(v) => setValue('status', v, { shouldDirty: true })}
            items={INCIDENT_STATUSES.map((s) => ({ value: s, label: INCIDENT_STATUS_LABELS[s] }))}
          />
        </FormField>

        <FormField label="When you became aware" className={span.date} error={errors.awareAt?.message} hint="The NDIS Commission deadline counts from this time.">
          <input type="datetime-local" max={awareAtMax} {...register('awareAt')} />
        </FormField>

        <FormField label="Reporting deadline" className={span.short}>
          <Dropdown
            variant="form"
            value={reportableClass ?? 'None'}
            onChange={(v) => setValue('reportableClass', v, { shouldDirty: true })}
            items={REPORTABLE_CLASSES.map((c) => ({ value: c, label: REPORTABLE_CLASS_LABELS[c] }))}
          />
        </FormField>

        {reportableClass && reportableClass !== defaultReportableClass(severity, incidentType, isRestrictivePracticeAuthorised) && (
          <FormField label="Reason for the change" required className={span.long} error={errors.reportableClassReason?.message}>
            <textarea {...register('reportableClassReason')} rows={2} maxLength={500} placeholder="Why this incident has a different reporting deadline..." />
          </FormField>
        )}

        <FormField label="NDIS Commission reference number" className={span.short}>
          <input {...register('qscReferenceNumber')} placeholder="Reference number" />
        </FormField>

        <FormField label="Reported to the NDIS Commission" className={span.date}>
          <input type="datetime-local" {...register('qscReportedAt')} />
        </FormField>

        {reportableClass === 'Within24h' && (
          <FormField label="5-day report sent" className={span.date}>
            <input type="datetime-local" {...register('commissionDetailedReportedAt')} />
          </FormField>
        )}

        <div className={`${span.medium} space-y-1`}>
          <FormField label="Final report requested" layout="checkbox">
            <input type="checkbox" {...register('commissionFinalReportRequested')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
          {commissionFinalReportRequested && (
            <FormField label="Final report sent">
              <input type="datetime-local" {...register('commissionFinalReportedAt')} />
            </FormField>
          )}
        </div>

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
