import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Pill, CalendarClock, FileText } from 'lucide-react'
import { Card } from '@/components/Card'
import { FactList } from '@/components/FactList'
import { Button } from '@/components/Button'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateAu, formatWithTimeZone } from '@/lib/utils'
import { formatWallClock } from '@/lib/wallClock'
import { ADMIN_STATUS_LABELS, WITNESS_STATUS_LABELS } from '@/api/types/medications'
import { SHIFT_NOTE_FLAG_LABELS, type ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'
import { RESTRICTIVE_PRACTICE_TYPE_LABELS } from '@/api/types/restrictive-practices'
import { SERVICE_STREAM_LABELS } from '@/api/types/participants'
import {
  INCIDENT_TYPE_LABELS, INCIDENT_SEVERITY_LABELS, INCIDENT_STATUS_LABELS, REPORTABLE_CLASS_LABELS, BODY_REGION_LABELS, INJURY_TYPE_LABELS,
} from '@/api/types/enums'
import type { IncidentDetailDto } from '@/api/types/incidents'
import { RpAuthorisationBadge } from './RpAuthorisationBadge'
import { reportingDueLines } from './reportingDue'
import { emergencyServiceEntries, parseEmergencyServices } from './emergencyServices'
import { WITNESS_TYPE_COLOR_MAP } from './witnessColors'
import type { GroupKey } from './incidentEditForm'

/** What every view card needs to offer its Edit button: who may, whether one is already saving, and what opening does. */
export type CardEdit = { canEdit: boolean; busy: boolean; onEdit: (group: GroupKey, card: string) => void }

type CardProps = { incident: IncidentDetailDto; edit: CardEdit }

const MUTED = 'text-[var(--color-muted-foreground)]'
const dateTime: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
const at = (iso: string | null | undefined, zone: string | null | undefined) => (iso ? formatWithTimeZone(iso, zone, dateTime) : null)
const wall = (v: string | null | undefined) => (v ? formatWallClock(v, dateTime) : null)

function ViewCard({ title, group, edit, children }: { title: string; group: GroupKey; edit: CardEdit; children: ReactNode }) {
  return (
    <Card
      title={title}
      action={edit.canEdit && (
        <Button variant="secondary" size="sm" disabled={edit.busy} aria-label={`Edit ${title.toLowerCase()}`} data-edit-card={title} onClick={() => edit.onEdit(group, title)}>
          Edit
        </Button>
      )}
    >
      {children}
    </Card>
  )
}

/** Free text sits under the card's facts at full width: a small label, then the text. */
function LongText({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={`text-[13px] ${MUTED}`}>{label}</p>
      <div className="text-sm whitespace-pre-wrap break-words">{children}</div>
    </div>
  )
}

/** One line per service that attended ("Police · Sgt Jane Doe · Ref 2611-0042"), then the other details; an older report with no services shows its text, or "Called". */
function EmergencyServicesValue({ incident }: { incident: IncidentDetailDto }) {
  const lines = emergencyServiceEntries(parseEmergencyServices(incident.emergencyServices), incident)
  const details = incident.emergencyServicesDetails?.trim()
  if (!lines.length && !details) return <>Called</>
  return (
    <div className="flex flex-col gap-1">
      {lines.map((e) => <span key={e.service}>{[e.service, e.name].filter(Boolean).join(' · ')}{e.ref && <>{' · '}<span className="whitespace-nowrap">Ref {e.ref}</span></>}</span>)}
      {details && <span className="whitespace-pre-wrap break-words">{details}</span>}
    </div>
  )
}

/** The due lines, worked out at render from the stored instants (no timers); overdue is words plus the danger colour, never colour alone. */
function ReportingDue({ incident }: { incident: IncidentDetailDto }) {
  const lines = reportingDueLines(incident, new Date())
  if (lines.length === 0) return <span role="img" aria-label="No reporting deadline">{'—'}</span>
  return (
    <div className="space-y-0.5">
      {lines.map((l) => (
        <p key={l.text} className={l.tone === 'overdue' ? 'text-[var(--color-destructive)] font-medium' : l.tone === 'muted' ? 'text-xs text-[var(--color-muted-foreground)]' : undefined}>{l.text}</p>
      ))}
    </div>
  )
}

export function DetailsCards({ incident, edit }: CardProps) {
  return (
    <>
      <ViewCard title="Incident details" group="details" edit={edit}>
        <FactList
          items={[
            { label: 'Date & time', value: <span className="tabular-nums">{formatWallClock(incident.incidentDateTime, dateTime)}</span> },
            { label: 'Location', value: incident.location },
            { label: 'Emergency services', value: incident.wereEmergencyServicesCalled ? <EmergencyServicesValue incident={incident} /> : 'Not called' },
          ]}
        />
        <div className="mt-3 flex flex-col gap-3">
          <LongText label="Description">{incident.description}</LongText>
          <LongText label="Immediate actions taken">{incident.immediateActionsTaken?.trim() ? incident.immediateActionsTaken : <span className={MUTED}>None recorded.</span>}</LongText>
        </div>
      </ViewCard>
      {incident.incidentType === 'Injury' && (
        <ViewCard title="Injuries" group="details" edit={edit}>
          {incident.injuries.length === 0 ? (
            <p className={`text-sm ${MUTED}`}>No injuries recorded.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {incident.injuries.map((inj, i) => (
                <li key={i} className="min-w-0 text-sm">
                  <p className="font-medium">{BODY_REGION_LABELS[inj.region] ?? inj.region} · {INJURY_TYPE_LABELS[inj.injuryType] ?? inj.injuryType}</p>
                  {inj.description && <p className="whitespace-pre-wrap break-words">{inj.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </ViewCard>
      )}
    </>
  )
}

export function BasicsCards({ incident, edit }: CardProps) {
  const service = incident.serviceType === 'None' || !incident.serviceType ? 'None' : SERVICE_STREAM_LABELS[incident.serviceType] ?? incident.serviceType
  const type = INCIDENT_TYPE_LABELS[incident.incidentType] ?? incident.incidentType
  return (
    <>
      <ViewCard title="Who" group="basics" edit={edit}>
        <FactList
          items={[
            { label: 'Involved participant', value: incident.involvedParticipantName || 'No participant recorded' },
            { label: 'Title', value: <span className="break-words">{incident.title}</span> },
            { label: 'Reported by', value: incident.reportedByName },
            { label: 'Involved staff', value: incident.involvedStaffName },
          ]}
        />
      </ViewCard>
      <ViewCard title="What" group="basics" edit={edit}>
        <FactList
          items={[
            { label: 'Service type', value: service },
            ...(incident.serviceType === 'Trip' && incident.tripInstanceId && incident.tripName
              ? [{ label: 'Trip', value: <Link to={`/trips/${incident.tripInstanceId}`} className="underline">{incident.tripName}</Link> }]
              : []),
            { label: 'Incident type', value: incident.incidentType === 'Other' && incident.otherTypeSpecify ? `${type} · ${incident.otherTypeSpecify}` : type },
            { label: 'Severity', value: <StatusBadge status={incident.severity} label={INCIDENT_SEVERITY_LABELS[incident.severity]} /> },
          ]}
        />
      </ViewCard>
    </>
  )
}

export function RpCard({ incident, edit }: CardProps) {
  const unapproved = incident.unapprovedRestrictivePracticeDetails?.trim()
  return (
    <ViewCard title="Restrictive practice details" group="rp" edit={edit}>
      <FactList
        items={[
          { label: 'Type', value: incident.restrictivePracticeType ? RESTRICTIVE_PRACTICE_TYPE_LABELS[incident.restrictivePracticeType] : 'Not recorded' },
          { label: 'Linked practice', value: incident.restrictivePracticeId ? incident.restrictivePracticeDescription || '—' : unapproved ? 'Not on the register' : 'No practice linked' },
          { label: 'Practice review date', value: incident.restrictivePracticeReviewDate ? formatDateAu(incident.restrictivePracticeReviewDate) : null },
          { label: 'Authorisation', value: incident.isRestrictivePracticeAuthorised == null ? 'Not determined' : <RpAuthorisationBadge authorised={incident.isRestrictivePracticeAuthorised} /> },
          ...(incident.restrictivePracticeUseVaried == null ? [] : [{ label: 'Behaviour support plan', value: incident.restrictivePracticeUseVaried ? 'Varied from the behaviour support plan' : 'Used as set out in the behaviour support plan' }]),
        ]}
      />
      {unapproved && <div className="mt-3"><LongText label="Practice not on the register">{unapproved}</LongText></div>}
    </ViewCard>
  )
}

export function WitnessesCard({ incident, edit }: CardProps) {
  const zone = incident.timeZoneId
  const earlier = incident.witnessNames?.trim() || incident.witnessStatements?.trim()
  return (
    <ViewCard title="Witnesses" group="witnesses" edit={edit}>
      {incident.witnesses.length === 0 ? (
        <p className={`text-sm ${MUTED}`}>No witnesses recorded.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {incident.witnesses.map((w) => {
            const answered = w.witnessStatus === 'Approved' || w.witnessStatus === 'Declined'
            return (
              <li key={w.id} data-testid="witness-row" className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 break-words text-sm font-medium">{w.witnessName}</span>
                  <StatusBadge status={w.isStaffWitness ? 'Staff' : 'External'} colorMap={WITNESS_TYPE_COLOR_MAP} />
                  {w.isStaffWitness && <StatusBadge status={w.witnessStatus} label={WITNESS_STATUS_LABELS[w.witnessStatus]} />}
                </div>
                <p className={`text-xs tabular-nums ${MUTED}`}>
                  {w.isStaffWitness
                    ? `${w.witnessRequestedAt ? `Asked ${at(w.witnessRequestedAt, zone)}` : 'Not yet asked'}${w.witnessRespondedAt ? ` · Responded ${at(w.witnessRespondedAt, zone)}` : ''}`
                    : 'External witness, no response needed'}
                </p>
                {w.isStaffWitness && answered && (
                  w.statementText?.trim() ? (
                    <div className="min-w-0">
                      <p className={`text-[13px] ${MUTED}`}>Statement</p>
                      <blockquote className="border-l-2 border-[var(--color-border)] pl-3 text-sm whitespace-pre-wrap break-words">{w.statementText}</blockquote>
                    </div>
                  ) : <p className={`text-sm ${MUTED}`}>No statement given.</p>
                )}
                {w.isStaffWitness && w.witnessStatus === 'Pending' && <p className={`text-sm ${MUTED}`}>Waiting for their response.</p>}
              </li>
            )
          })}
        </ul>
      )}
      {earlier && (
        <section aria-labelledby="earlier-witness-notes" className="mt-4 border-t border-[var(--color-border)] pt-3">
          <h4 id="earlier-witness-notes" className={`mb-2 text-[13px] font-medium ${MUTED}`}>Earlier witness notes</h4>
          <FactList items={[
            { label: 'Names', value: <span className="whitespace-pre-wrap break-words">{incident.witnessNames}</span> },
            { label: 'Statements', value: <span className="whitespace-pre-wrap break-words">{incident.witnessStatements}</span> },
          ]} />
          <p className={`mt-2 text-xs ${MUTED}`}>Recorded before witnesses were listed one by one. Read only.</p>
        </section>
      )}
    </ViewCard>
  )
}

export function ComplianceCard({ incident, edit }: CardProps) {
  const zone = incident.timeZoneId
  const notified = (yes: boolean, when: string | null | undefined) => (yes ? `Yes${when ? ` · ${wall(when)}` : ''}` : 'No')
  return (
    <ViewCard title="Compliance" group="compliance" edit={edit}>
      <FactList
        items={[
          { label: 'Status', value: <StatusBadge status={incident.status} label={INCIDENT_STATUS_LABELS[incident.status]} /> },
          {
            label: 'Reporting deadline',
            value: (
              <>
                {REPORTABLE_CLASS_LABELS[incident.reportableClass] ?? incident.reportableClass}
                {incident.reportableClassReason?.trim() && <span className="block whitespace-pre-wrap break-words text-xs text-[var(--color-muted-foreground)]">{incident.reportableClassReason}</span>}
              </>
            ),
          },
          { label: 'When you became aware', value: at(incident.awareAt, zone) && <span className="tabular-nums">{at(incident.awareAt, zone)}</span> },
          { label: 'NDIS Commission', value: <ReportingDue incident={incident} /> },
          { label: 'NDIS Commission reference', value: incident.qscReferenceNumber },
          { label: 'Reported to the NDIS Commission', value: wall(incident.qscReportedAt) ?? 'Not yet' },
          { label: '5-day report sent', value: wall(incident.commissionDetailedReportedAt) ?? 'Not yet' },
          { label: 'Final report', value: incident.commissionFinalReportRequested ? `Requested${incident.commissionFinalReportedAt ? ` · sent ${wall(incident.commissionFinalReportedAt)}` : ''}` : 'Not requested' },
          { label: 'Family notified', value: notified(incident.familyNotified, incident.familyNotifiedAt) },
          { label: 'Support coordinator notified', value: notified(incident.supportCoordinatorNotified, incident.supportCoordinatorNotifiedAt) },
          { label: 'Resolved', value: at(incident.resolvedAt, zone) ?? 'Not resolved' },
        ]}
      />
    </ViewCard>
  )
}

/**
 * Connection map: what the incident was filed from. Read only for everyone; a bare incident (the common case) says so,
 * so the full view never hides a card.
 */
export function LinkedRecordsCard({ incident }: { incident: IncidentDetailDto }) {
  const flags = incident.shiftNoteContext ? incident.shiftNoteContext.flaggedCategories : []
  const none = !(incident.medicationContext || incident.shiftContext || incident.shiftNoteContext)
  return (
    <Card title="Linked records" className="space-y-3">
      {none && <p className={`text-sm ${MUTED}`}>Not linked to a medication, shift or shift note.</p>}

      {incident.medicationContext && (
        <div className="flex items-start gap-3">
          <Pill className="w-5 h-5 text-[var(--color-muted-foreground)] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-0.5 text-sm">
            <p className="font-medium text-[var(--color-foreground)]">
              {incident.medicationContext.medicationName} · {ADMIN_STATUS_LABELS[incident.medicationContext.status]}
            </p>
            <p className="text-[var(--color-muted-foreground)]">
              {incident.medicationContext.administeredAt
                ? formatWithTimeZone(incident.medicationContext.administeredAt, null, dateTime)
                : 'Not administered'}
              {incident.medicationContext.recordedByName ? ` · ${incident.medicationContext.recordedByName}` : ''}
            </p>
            {incident.involvedParticipantId && (
              <Link
                to={`/participants/${incident.involvedParticipantId}?tab=medications`}
                className="inline-block text-sm font-medium text-[var(--color-primary)] hover:underline"
              >
                Open medications
              </Link>
            )}
          </div>
        </div>
      )}

      {incident.shiftContext && (
        <div className="flex items-start gap-3">
          <CalendarClock className="w-5 h-5 text-[var(--color-muted-foreground)] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-0.5 text-sm">
            <p className="font-medium text-[var(--color-foreground)]">
              <span className="tabular-nums">{formatDateAu(incident.shiftContext.date)} · {incident.shiftContext.startTime}–{incident.shiftContext.endTime}</span>
            </p>
            <p className="text-[var(--color-muted-foreground)]">
              {incident.shiftContext.participantName}
              {incident.shiftContext.staffName ? ` · ${incident.shiftContext.staffName}` : ''}
            </p>
          </div>
        </div>
      )}

      {incident.shiftNoteContext && (
        <div className="flex items-start gap-3">
          <FileText className="w-5 h-5 text-[var(--color-muted-foreground)] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1.5 text-sm">
            <p className="text-[var(--color-foreground)]">"{incident.shiftNoteContext.excerpt}"</p>
            {flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {flags.map((c) => <FlagChip key={c} category={c} />)}
              </div>
            )}
            <p className="tabular-nums text-[var(--color-muted-foreground)]">{formatDateAu(incident.shiftNoteContext.createdAt)}</p>
          </div>
        </div>
      )}
    </Card>
  )
}

/**
 * Connection map: a small local chip for a shift note's flagged categories — the portal's own
 * ShiftNotesSection/ShiftSlideOver only ever render this as a joined text sentence
 * (formatFlaggedCategoryList), not as a reusable exported chip component, so this is a
 * purpose-built one rather than an import from the portal.
 */
function FlagChip({ category }: { category: ShiftNoteFlagCategory }) {
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-error-container)] text-[var(--color-on-error-container)] capitalize">
      {SHIFT_NOTE_FLAG_LABELS[category]}
    </span>
  )
}

export function PageFoot({ incident }: { incident: IncidentDetailDto }) {
  const zone = incident.timeZoneId
  const parts = [at(incident.createdAt, zone) && `Reported ${at(incident.createdAt, zone)}`, at(incident.updatedAt, zone) && `Last changed ${at(incident.updatedAt, zone)}`].filter(Boolean)
  if (parts.length === 0) return null
  return <p className={`text-xs tabular-nums ${MUTED}`}>{parts.join(' · ')}</p>
}
