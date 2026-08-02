import { useNavigate, useParams, Link } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateIncident, useUpdateIncident, useIncident, useTrips, useStaff, useParticipants } from '@/api/hooks'
import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import type { TripListDto, StaffListDto, ParticipantListDto, CreateIncidentDto, UpdateIncidentDto } from '@/api/types'
import type { IncidentType, IncidentSeverity, IncidentStatus, QscReportingStatus } from '@/api/types/enums'

const incidentSchema = z.object({
  tripInstanceId: z.string().min(1, 'Trip is required'),
  incidentType: z.string().min(1, 'Incident type is required'),
  severity: z.string().min(1, 'Severity is required'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  reportedByStaffId: z.string().min(1, 'Reporter is required'),
  incidentDateTime: z.string().min(1, 'Date/time is required'),
  location: z.string().optional(),
  participantBookingId: z.string().optional(),
  involvedParticipantId: z.string().optional(),
  involvedStaffId: z.string().optional(),
  immediateActionsTaken: z.string().optional(),
  wereEmergencyServicesCalled: z.boolean().optional(),
  emergencyServicesDetails: z.string().optional(),
  witnessNames: z.string().optional(),
  witnessStatements: z.string().optional(),
  // Edit-only fields
  status: z.string().optional(),
  qscReportingStatus: z.string().optional(),
  qscReferenceNumber: z.string().optional(),
  qscReportedAt: z.string().optional(),
  reviewedByStaffId: z.string().optional(),
  reviewNotes: z.string().optional(),
  correctiveActions: z.string().optional(),
  familyNotified: z.boolean().optional(),
  familyNotifiedAt: z.string().optional(),
  supportCoordinatorNotified: z.boolean().optional(),
  supportCoordinatorNotifiedAt: z.string().optional(),
})

type IncidentFormData = z.infer<typeof incidentSchema>

export default function IncidentCreatePage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const createIncident = useCreateIncident()
  const updateIncident = useUpdateIncident()
  const mutation = isEdit ? updateIncident : createIncident
  const { data: trips = [] } = useTrips()
  const { data: staff = [] } = useStaff()
  const { data: participants = [] } = useParticipants()
  const { data: existingIncident } = useIncident(id)

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<IncidentFormData>({
    resolver: zodResolver(incidentSchema),
    defaultValues: {
      severity: 'Medium',
      incidentType: 'Other',
      status: 'Draft',
      qscReportingStatus: 'NotRequired',
      wereEmergencyServicesCalled: false,
      familyNotified: false,
      supportCoordinatorNotified: false,
    },
  })

  const wereEmergencyCalled = useWatch({ control, name: 'wereEmergencyServicesCalled' })
  const familyNotified = useWatch({ control, name: 'familyNotified' })
  const supportCoordinatorNotified = useWatch({ control, name: 'supportCoordinatorNotified' })

  useEffect(() => {
    if (isEdit && existingIncident) {
      const i = existingIncident
      reset({
        tripInstanceId: i.tripInstanceId ?? '',
        incidentType: i.incidentType ?? 'Other',
        severity: i.severity ?? 'Medium',
        title: i.title ?? '',
        description: i.description ?? '',
        reportedByStaffId: i.reportedByStaffId ?? '',
        incidentDateTime: i.incidentDateTime ? i.incidentDateTime.slice(0, 16) : '',
        location: i.location ?? '',
        participantBookingId: i.participantBookingId ?? '',
        involvedParticipantId: i.involvedParticipantId ?? '',
        involvedStaffId: i.involvedStaffId ?? '',
        immediateActionsTaken: i.immediateActionsTaken ?? '',
        wereEmergencyServicesCalled: i.wereEmergencyServicesCalled ?? false,
        emergencyServicesDetails: i.emergencyServicesDetails ?? '',
        witnessNames: i.witnessNames ?? '',
        witnessStatements: i.witnessStatements ?? '',
        status: i.status ?? 'Draft',
        qscReportingStatus: i.qscReportingStatus ?? 'NotRequired',
        qscReferenceNumber: i.qscReferenceNumber ?? '',
        qscReportedAt: i.qscReportedAt ? i.qscReportedAt.slice(0, 16) : '',
        reviewedByStaffId: i.reviewedByStaffId ?? '',
        reviewNotes: i.reviewNotes ?? '',
        correctiveActions: i.correctiveActions ?? '',
        familyNotified: i.familyNotified ?? false,
        familyNotifiedAt: i.familyNotifiedAt ? i.familyNotifiedAt.slice(0, 16) : '',
        supportCoordinatorNotified: i.supportCoordinatorNotified ?? false,
        supportCoordinatorNotifiedAt: i.supportCoordinatorNotifiedAt ? i.supportCoordinatorNotifiedAt.slice(0, 16) : '',
      })
    }
  }, [id, isEdit, existingIncident, reset])

  const onSubmit = async (data: IncidentFormData) => {
    const base: CreateIncidentDto = {
      tripInstanceId: data.tripInstanceId,
      reportedByStaffId: data.reportedByStaffId,
      incidentType: data.incidentType as IncidentType,
      severity: data.severity as IncidentSeverity,
      title: data.title,
      description: data.description,
      incidentDateTime: data.incidentDateTime,
      participantBookingId: data.participantBookingId || undefined,
      involvedParticipantId: data.involvedParticipantId || undefined,
      involvedStaffId: data.involvedStaffId || undefined,
      location: data.location || undefined,
      immediateActionsTaken: data.immediateActionsTaken || undefined,
      wereEmergencyServicesCalled: data.wereEmergencyServicesCalled ?? false,
      emergencyServicesDetails: data.emergencyServicesDetails || undefined,
      witnessNames: data.witnessNames || undefined,
      witnessStatements: data.witnessStatements || undefined,
    }

    try {
      if (isEdit) {
        const updateData: UpdateIncidentDto = {
          ...base,
          status: (data.status || 'Draft') as IncidentStatus,
          qscReportingStatus: (data.qscReportingStatus || 'NotRequired') as QscReportingStatus,
          qscReportedAt: data.qscReportedAt || undefined,
          qscReferenceNumber: data.qscReferenceNumber || undefined,
          reviewedByStaffId: data.reviewedByStaffId || undefined,
          reviewNotes: data.reviewNotes || undefined,
          correctiveActions: data.correctiveActions || undefined,
          familyNotified: data.familyNotified ?? false,
          familyNotifiedAt: data.familyNotifiedAt || undefined,
          supportCoordinatorNotified: data.supportCoordinatorNotified ?? false,
          supportCoordinatorNotifiedAt: data.supportCoordinatorNotifiedAt || undefined,
        }
        const res = await updateIncident.mutateAsync({ id, data: updateData })
        if (res.success) navigate('/incidents')
      } else {
        const res = await createIncident.mutateAsync(base)
        if (res.success) navigate('/incidents')
      }
    } catch {
      // error handled by mutation state
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Link to="/incidents" className="p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl md:text-2xl font-bold">{isEdit ? 'Edit Incident Report' : 'Report New Incident'}</h1>
      </div>

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          Failed to {isEdit ? 'update' : 'create'} incident report. Please check your input and try again.
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="grid md:grid-cols-2 gap-6">
        {/* Incident Details */}
        <Card title="Incident Details" className="space-y-4">
          <FormField label="Title" required error={errors.title?.message}>
            <input {...register('title')} placeholder="Brief incident summary" autoFocus />
          </FormField>

          <FormField label="Trip" required error={errors.tripInstanceId?.message}>
            <select {...register('tripInstanceId')}>
              <option value="">Select a trip...</option>
              {trips.map((t: TripListDto) => (
                <option key={t.id} value={t.id}>{t.tripName}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Incident Type" required>
            <select {...register('incidentType')}>
              <option value="Injury">Injury</option>
              <option value="Illness">Illness</option>
              <option value="MedicationError">Medication Error</option>
              <option value="BehaviourOfConcern">Behaviour of Concern</option>
              <option value="RestrictivePracticeUse">Restrictive Practice Use</option>
              <option value="PropertyDamage">Property Damage</option>
              <option value="MissingPerson">Missing Person</option>
              <option value="Abuse">Abuse</option>
              <option value="Neglect">Neglect</option>
              <option value="Death">Death</option>
              <option value="Other">Other</option>
            </select>
          </FormField>

          <FormField label="Severity" required>
            <select {...register('severity')}>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
            </select>
          </FormField>

          <FormField label="Date & Time" required error={errors.incidentDateTime?.message}>
            <input type="datetime-local" {...register('incidentDateTime')} />
          </FormField>

          <FormField label="Location">
            <input {...register('location')} placeholder="Where the incident occurred" />
          </FormField>
        </Card>

        {/* People Involved */}
        <Card title="People Involved" className="space-y-4">
          <FormField label="Reported By" required error={errors.reportedByStaffId?.message}>
            <select {...register('reportedByStaffId')}>
              <option value="">Select staff member...</option>
              {staff.map((s: StaffListDto) => (
                <option key={s.id} value={s.id}>{s.fullName}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Involved Participant">
            <select {...register('involvedParticipantId')}>
              <option value="">None</option>
              {participants.map((p: ParticipantListDto) => (
                <option key={p.id} value={p.id}>{p.fullName || `${p.firstName} ${p.lastName}`}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Involved Staff Member">
            <select {...register('involvedStaffId')}>
              <option value="">None</option>
              {staff.map((s: StaffListDto) => (
                <option key={s.id} value={s.id}>{s.fullName}</option>
              ))}
            </select>
          </FormField>
        </Card>

        {/* What Happened */}
        <Card title="What Happened" className="md:col-span-2 space-y-4">
          <FormField label="Description" required error={errors.description?.message}>
            <textarea {...register('description')} rows={5} placeholder="Detailed description of the incident..." />
          </FormField>

          <FormField label="Immediate Actions Taken">
            <textarea {...register('immediateActionsTaken')} rows={3} placeholder="What was done immediately in response..." />
          </FormField>

          <FormField label="Were Emergency Services Called?" layout="checkbox">
            <input type="checkbox" {...register('wereEmergencyServicesCalled')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          {wereEmergencyCalled && (
            <FormField label="Emergency Services Details">
              <textarea {...register('emergencyServicesDetails')} rows={2} placeholder="Which services, response details..." />
            </FormField>
          )}
        </Card>

        {/* Witnesses */}
        <Card title="Witnesses" className="md:col-span-2 space-y-4">
          <FormField label="Witness Names">
            <input {...register('witnessNames')} placeholder="Names of witnesses (comma-separated)" />
          </FormField>

          <FormField label="Witness Statements">
            <textarea {...register('witnessStatements')} rows={3} placeholder="Summary of witness accounts..." />
          </FormField>
        </Card>

        {/* Review & Compliance (edit only) */}
        {isEdit && (
          <Card title="Review & Compliance" className="md:col-span-2 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <FormField label="Status">
                <select {...register('status')}>
                  <option value="Draft">Draft</option>
                  <option value="Submitted">Submitted</option>
                  <option value="UnderReview">Under Review</option>
                  <option value="Escalated">Escalated</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Closed">Closed</option>
                </select>
              </FormField>

              <FormField label="QSC Reporting Status">
                <select {...register('qscReportingStatus')}>
                  <option value="NotRequired">Not Required</option>
                  <option value="Required">Required</option>
                  <option value="ReportedWithin24h">Reported Within 24h</option>
                  <option value="ReportedLate">Reported Late</option>
                  <option value="Pending">Pending</option>
                </select>
              </FormField>

              <FormField label="QSC Reference Number">
                <input {...register('qscReferenceNumber')} placeholder="QSC reference #" />
              </FormField>

              <FormField label="QSC Reported At">
                <input type="datetime-local" {...register('qscReportedAt')} />
              </FormField>

              <FormField label="Reviewed By">
                <select {...register('reviewedByStaffId')}>
                  <option value="">Not reviewed</option>
                  {staff.map((s: StaffListDto) => (
                    <option key={s.id} value={s.id}>{s.fullName}</option>
                  ))}
                </select>
              </FormField>
            </div>

            <FormField label="Review Notes">
              <textarea {...register('reviewNotes')} rows={3} placeholder="Notes from the reviewer..." />
            </FormField>

            <FormField label="Corrective Actions">
              <textarea {...register('correctiveActions')} rows={3} placeholder="Actions to prevent recurrence..." />
            </FormField>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <FormField label="Family Notified" layout="checkbox">
                  <input type="checkbox" {...register('familyNotified')} className="w-4 h-4 rounded border-[var(--color-border)]" />
                </FormField>
                {familyNotified && (
                  <FormField label="Family Notified At">
                    <input type="datetime-local" {...register('familyNotifiedAt')} />
                  </FormField>
                )}
              </div>

              <div className="space-y-3">
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
        )}

        {/* Submit */}
        <div className="md:col-span-2 flex justify-end gap-3">
          <Link to="/incidents" className="px-6 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">
            Cancel
          </Link>
          <button type="submit" disabled={mutation.isPending}
            className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-blue-500/20">
            {mutation.isPending ? (isEdit ? 'Saving...' : 'Submitting...') : (isEdit ? 'Save Changes' : 'Submit Incident Report')}
          </button>
        </div>
      </form>
    </div>
  )
}
