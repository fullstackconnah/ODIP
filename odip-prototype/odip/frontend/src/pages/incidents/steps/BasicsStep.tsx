import type { FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { Dropdown } from '@/components/Dropdown'
import { ToggleGroup } from '@/components/ToggleGroup'
import { SearchableSelect } from '@/components/SearchableSelect'
import { ParticipantPicker } from '@/components/ParticipantPicker'
import { ReadOnlyField } from '@/pages/profile/profileHelpers'
import { INCIDENT_TYPE_LABELS, INCIDENT_SEVERITY_LABELS, INCIDENT_TYPES, INCIDENT_SEVERITIES } from '@/api/types/enums'
import { SERVICE_STREAM_LABELS } from '@/api/types/participants'
import type { TripListDto, StaffListDto } from '@/api/types'
import type { IncidentFormData } from '../incidentFormSchema'
import { formGrid, span } from '@/lib/formGrid'

export type BasicsStepProps = {
  register: UseFormRegister<IncidentFormData>
  errors: FieldErrors<IncidentFormData>
  setValue: UseFormSetValue<IncidentFormData>
  serviceType: string | undefined
  incidentType: string | undefined
  severity: string | undefined
  tripInstanceId: string | undefined
  involvedParticipantId: string | undefined
  reportedByStaffId: string | undefined
  /** Set when the reporter is fixed (a support worker): shown as read-only text instead of the picker. */
  reporterName?: string
  involvedStaffId: string | undefined
  trips: TripListDto[]
  staff: StaffListDto[]
  incidentServiceTypes: readonly string[]
}

/**
 * IN-3 — wizard step 0 ("Basics"). Participant is deliberately the first field (backlog: "ask for
 * the person involved first"), via ParticipantPicker (IN-2). reportedByStaffId's default-to-
 * current-user seeding happens in the parent page's defaultValues (create mode only) — this
 * component just renders the (already-seeded-or-not) field.
 *
 * Dropdown/SearchableSelect fields here are wired the same direct value/setValue way the page's
 * pre-wizard restrictivePracticeType/status pickers already used (not RHF's <Controller>) —
 * FormField's labelling clone only forwards aria-labelledby/id onto a direct child element;
 * Controller's render prop doesn't receive those, which would silently break every
 * getByLabelText-based test and the real accessible name alike.
 */
export function BasicsStep({
  register, errors, setValue,
  serviceType, incidentType, severity, tripInstanceId, involvedParticipantId, reportedByStaffId, reporterName, involvedStaffId,
  trips, staff, incidentServiceTypes,
}: BasicsStepProps) {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Card title="Who">
        <div className={formGrid}>
          <FormField label="Severity" required className={span.long}>
            <ToggleGroup
              ariaLabel="Severity"
              options={INCIDENT_SEVERITIES.map((s) => ({ key: s, label: INCIDENT_SEVERITY_LABELS[s] }))}
              value={severity ?? ''}
              onChange={(v) => setValue('severity', v as IncidentFormData['severity'], { shouldDirty: true })}
              className="max-md:w-full max-md:[&>button]:flex-1"
            />
          </FormField>

          <FormField label="Involved Participant" className={span.medium}>
            <ParticipantPicker
              allowNone
              noneLabel="None"
              value={involvedParticipantId ?? ''}
              onChange={(v) => {
                setValue('involvedParticipantId', v, { shouldDirty: true })
                // A register entry belongs to one participant: a link kept across a change would only be refused on submit.
                setValue('restrictivePracticeId', '', { shouldDirty: true })
                setValue('usedWithoutAuthorisation', false, { shouldDirty: true })
              }}
            />
          </FormField>

          <FormField label="Title" required error={errors.title?.message} className={span.medium}>
            <input {...register('title')} placeholder="Brief incident summary" autoFocus />
          </FormField>

          {reporterName !== undefined ? (
            <ReadOnlyField field="reportedByStaffId" label="Reported By" value={reporterName} hint="Reports you file are saved under your name." className={span.medium} />
          ) : (
          <FormField label="Reported By" required error={errors.reportedByStaffId?.message} className={span.medium}>
            <SearchableSelect
              value={reportedByStaffId ?? ''}
              onChange={(v) => setValue('reportedByStaffId', v, { shouldDirty: true, shouldValidate: true })}
              placeholder="Select staff member..."
              items={staff.map((s: StaffListDto) => ({ value: s.id, label: s.fullName }))}
            />
          </FormField>
          )}

          <FormField label="Involved Staff Member" className={span.medium}>
            <SearchableSelect
              value={involvedStaffId ?? ''}
              onChange={(v) => setValue('involvedStaffId', v, { shouldDirty: true })}
              items={[
                { value: '', label: 'None' },
                ...staff.map((s: StaffListDto) => ({ value: s.id, label: s.fullName })),
              ]}
            />
          </FormField>
        </div>
      </Card>

      <Card title="What">
        <div className={formGrid}>
          <FormField label="Service Type" required className={span.medium}>
            <Dropdown
              variant="form"
              value={serviceType ?? 'None'}
              onChange={(v) => setValue('serviceType', v as IncidentFormData['serviceType'], { shouldDirty: true })}
              items={incidentServiceTypes.map((s) => ({
                value: s,
                label: s === 'None' ? 'None / not applicable' : (SERVICE_STREAM_LABELS[s as keyof typeof SERVICE_STREAM_LABELS] ?? s),
              }))}
            />
          </FormField>

          {serviceType === 'Trip' && (
            <FormField label="Trip" required error={errors.tripInstanceId?.message} className={span.medium}>
              <SearchableSelect
                value={tripInstanceId ?? ''}
                onChange={(v) => setValue('tripInstanceId', v, { shouldDirty: true, shouldValidate: true })}
                placeholder="Select a trip..."
                items={trips.map((t: TripListDto) => ({ value: t.id, label: t.tripName }))}
              />
            </FormField>
          )}

          <FormField label="Incident Type" required className={span.medium}>
            <Dropdown
              variant="form"
              value={incidentType ?? ''}
              onChange={(v) => setValue('incidentType', v as IncidentFormData['incidentType'], { shouldDirty: true, shouldValidate: true })}
              items={INCIDENT_TYPES.map((t) => ({ value: t, label: INCIDENT_TYPE_LABELS[t] }))}
            />
          </FormField>

          {incidentType === 'Other' && (
            <FormField label="Specify Incident Type" required error={errors.otherTypeSpecify?.message} className={span.medium}>
              <input {...register('otherTypeSpecify')} placeholder="Describe the incident type" />
            </FormField>
          )}
        </div>
      </Card>
    </div>
  )
}
