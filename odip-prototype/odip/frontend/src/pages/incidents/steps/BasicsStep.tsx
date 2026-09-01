import type { FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { ParticipantPicker } from '@/components/ParticipantPicker'
import { INCIDENT_TYPE_LABELS, INCIDENT_SEVERITY_LABELS, INCIDENT_TYPES, INCIDENT_SEVERITIES } from '@/api/types/enums'
import { SERVICE_STREAM_LABELS } from '@/api/types/participants'
import type { TripListDto, StaffListDto } from '@/api/types'
import type { IncidentFormData } from '../incidentFormSchema'

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
  serviceType, incidentType, severity, tripInstanceId, involvedParticipantId, reportedByStaffId, involvedStaffId,
  trips, staff, incidentServiceTypes,
}: BasicsStepProps) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card title="Details" className="md:col-span-2 space-y-4">
        <FormField label="Involved Participant">
          <ParticipantPicker
            allowNone
            noneLabel="None"
            value={involvedParticipantId ?? ''}
            onChange={(v) => setValue('involvedParticipantId', v, { shouldDirty: true })}
          />
        </FormField>

        <FormField label="Title" required error={errors.title?.message}>
          <input {...register('title')} placeholder="Brief incident summary" autoFocus />
        </FormField>

        <FormField label="Reported By" required error={errors.reportedByStaffId?.message}>
          <SearchableSelect
            value={reportedByStaffId ?? ''}
            onChange={(v) => setValue('reportedByStaffId', v, { shouldDirty: true, shouldValidate: true })}
            placeholder="Select staff member..."
            items={staff.map((s: StaffListDto) => ({ value: s.id, label: s.fullName }))}
          />
        </FormField>

        <FormField label="Involved Staff Member">
          <SearchableSelect
            value={involvedStaffId ?? ''}
            onChange={(v) => setValue('involvedStaffId', v, { shouldDirty: true })}
            items={[
              { value: '', label: 'None' },
              ...staff.map((s: StaffListDto) => ({ value: s.id, label: s.fullName })),
            ]}
          />
        </FormField>

        <FormField label="Service Type" required>
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
          <FormField label="Trip" required error={errors.tripInstanceId?.message}>
            <SearchableSelect
              value={tripInstanceId ?? ''}
              onChange={(v) => setValue('tripInstanceId', v, { shouldDirty: true, shouldValidate: true })}
              placeholder="Select a trip..."
              items={trips.map((t: TripListDto) => ({ value: t.id, label: t.tripName }))}
            />
          </FormField>
        )}

        <FormField label="Incident Type" required>
          <Dropdown
            variant="form"
            value={incidentType ?? ''}
            onChange={(v) => setValue('incidentType', v as IncidentFormData['incidentType'], { shouldDirty: true, shouldValidate: true })}
            items={INCIDENT_TYPES.map((t) => ({ value: t, label: INCIDENT_TYPE_LABELS[t] }))}
          />
        </FormField>

        {incidentType === 'Other' && (
          <FormField label="Specify Incident Type" required error={errors.otherTypeSpecify?.message}>
            <input {...register('otherTypeSpecify')} placeholder="Describe the incident type" />
          </FormField>
        )}

        <FormField label="Severity" required>
          <Dropdown
            variant="form"
            value={severity ?? ''}
            onChange={(v) => setValue('severity', v as IncidentFormData['severity'], { shouldDirty: true })}
            items={INCIDENT_SEVERITIES.map((s) => ({ value: s, label: INCIDENT_SEVERITY_LABELS[s] }))}
          />
        </FormField>
      </Card>
    </div>
  )
}
