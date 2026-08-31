import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useParticipant, useParticipantBookings, useSupportProfile, useParticipantAlerts } from '@/api/hooks'
import { formatDateAu, maskNdisNumber } from '@/lib/utils'
import { DataTable } from '@/components/DataTable'
import { TabNav } from '@/components/TabNav'
import { StatusBadge } from '@/components/StatusBadge'
import { ServiceStreamBadges } from '@/components/ServiceStreamBadges'
import { ParticipantAlertsBanner } from '@/components/ParticipantAlertsBanner'
import { Card } from '@/components/Card'
import { ArrowLeft, Users, Shield, ClipboardList, Pencil, Pill, StickyNote, ListChecks, ShieldAlert, FileEdit, Contact2 } from 'lucide-react'
import { useState } from 'react'
import AuditHistoryTab from '@/components/AuditHistoryTab'
import { usePermissions } from '@/lib/permissions'
import { OVERNIGHT_SUPPORT_LABELS, OVERNIGHT_RATIO_LABELS, GENDER_LABELS, FUNDING_SOURCE_LABELS, LIVING_ARRANGEMENT_LABELS, HIDPA_CATEGORY_LABELS, parseHidpaCategories } from '@/api/types/participants'
import type { Gender, FundingSource, LivingArrangement, HidpaSupportCategory } from '@/api/types/enums'
import { MedicationsTab, NotesTab, RoutinesTab, RestrictivePracticesTab, RiskEntriesSection, ParticipantConsentsSection, ContactsTab } from './participant-detail'

/** INTAKE sub-wave B — tri-state (boolean | null) display helper, same "—" empty-state idiom as every other unset field on this page. */
function yesNoUnset(value: boolean | null): string {
  return value === true ? 'Yes' : value === false ? 'No' : '—'
}

function Tag({ label }: { label: string }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
      {label}
    </span>
  )
}

export default function ParticipantDetailPage() {
  const { canWrite, canViewAlerts } = usePermissions()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  type Tab = 'details' | 'contacts' | 'bookings' | 'support' | 'medications' | 'notes' | 'routines' | 'restrictive-practices' | 'history'
  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(
    initialTab === 'contacts' || initialTab === 'bookings' || initialTab === 'support' || initialTab === 'medications' || initialTab === 'notes' || initialTab === 'routines' || initialTab === 'restrictive-practices' || initialTab === 'history' ? initialTab : 'details'
  )
  const currentUser = JSON.parse(localStorage.getItem('odip_user') || '{}')
  const isAdmin = currentUser.role === 'Admin'
  const { data: p, isLoading } = useParticipant(id)
  const { data: bookings = [] } = useParticipantBookings(id)
  const { data: supportProfile } = useSupportProfile(id)
  const { data: alertsData } = useParticipantAlerts(id, canViewAlerts)

  if (isLoading) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>
  if (!p) return <div className="text-center py-12">Participant not found</div>

  const mobilityAidBadges = [
    p.mobilityAidWheelchair && 'Wheelchair',
    p.mobilityAidWalker && 'Walker',
  ].filter((v): v is string => !!v)

  const equipmentBadges = [
    p.requiresHiLoBed && 'Hi-Lo Bed',
    p.requiresHoist && 'Hoist',
    p.requiresShowerChair && 'Shower Chair',
    p.requiresCommode && 'Commode',
    p.requiresStandingMachine && 'Standing Machine',
  ].filter((v): v is string => !!v)

  // DIAG-02.
  const hidpaCategories = parseHidpaCategories(p.hidpaSupportCategories)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start gap-4">
        <Link to="/participants" className="mt-1 p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">{p.fullName}</h1>
            <StatusBadge status={p.isActive ? 'Active' : 'Inactive'} />
            {p.isDraft && (
              <StatusBadge status="Draft" colorMap={{ draft: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]' }} />
            )}
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{p.region || 'No region'} · {p.planType} · Support Ratio: {p.supportRatio}</p>
          <div className="mt-2">
            <ServiceStreamBadges value={p.serviceStreams} />
          </div>
          {p.isDraft && (
            <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)] text-sm border border-[var(--color-on-warning-container)]/20">
              <span className="flex items-center gap-2">
                <FileEdit className="w-4 h-4 shrink-0" aria-hidden="true" />
                This participant is a draft — intake hasn't been completed yet. Excluded from rosters, claims, and other operational lists until finalised.
              </span>
              {canWrite && (
                <Link
                  to={`/participants/${id}/edit`}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-[var(--color-on-warning-container)] text-white text-sm font-medium hover:bg-[var(--color-on-warning-container)]/90 transition-colors shrink-0"
                >
                  <Pencil className="w-4 h-4" /> Resume intake
                </Link>
              )}
            </div>
          )}
          {canViewAlerts && alertsData && (
            <ParticipantAlertsBanner alerts={alertsData.alerts} onSelectTab={(t) => setTab(t as typeof tab)} />
          )}
        </div>
        {canWrite && (
          <Link to={`/participants/${id}/edit`} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20">
            <Pencil className="w-4 h-4" /> Edit
          </Link>
        )}
      </div>

      <TabNav
        tabs={[
          { key: 'details', label: 'Details', icon: Users },
          { key: 'contacts', label: 'Contacts', icon: Contact2 },
          { key: 'bookings', label: 'Bookings', icon: ClipboardList },
          { key: 'support', label: 'Support Profile', icon: Shield },
          { key: 'medications', label: 'Medications', icon: Pill },
          { key: 'notes', label: 'Notes', icon: StickyNote },
          { key: 'routines', label: 'Routines', icon: ListChecks },
          { key: 'restrictive-practices', label: 'Restrictive Practices', icon: ShieldAlert },
          ...(isAdmin ? [{ key: 'history' as const, label: 'History' }] : []),
        ]}
        active={tab}
        onChange={(key) => setTab(key as typeof tab)}
      />

      {tab === 'details' && (
        <div className="grid md:grid-cols-2 gap-6">
          <Card title="Personal Information">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
              {/* INTAKE sub-wave A, PID-004 — same always-visible empty-state pattern as Place
                  of Birth/Phone/Email below, not a hide-when-unset row. */}
              <span className="text-[var(--color-muted-foreground)]">Middle Name</span><span>{p.middleName || '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Date of Birth</span><span>{formatDateAu(p.dateOfBirth)}</span>
              <span className="text-[var(--color-muted-foreground)]">Gender</span>
              <span>
                {p.gender
                  ? GENDER_LABELS[p.gender as Gender] + (p.gender === 'Other' && p.genderSelfDescription ? ` (${p.genderSelfDescription})` : '')
                  : '—'}
              </span>
              {/* INTAKE sub-wave A, PID-010/CON-007/CON-008. */}
              <span className="text-[var(--color-muted-foreground)]">Place of Birth</span><span>{p.placeOfBirth || '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Phone</span><span>{p.phone || '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Email</span><span>{p.email || '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Funding Source</span>
              <span>{FUNDING_SOURCE_LABELS[(p.fundingSource as FundingSource) ?? 'Ndis']}</span>
              {/* FUND-02: subsequent content changes per funding source — NDIS shows the plan
                  fields (current behaviour); Other shows the reused specify field instead. */}
              {p.fundingSource !== 'Other' && (
                <>
                  <span className="text-[var(--color-muted-foreground)]">NDIS Number</span><span className="font-mono">{p.ndisNumber ? maskNdisNumber(p.maskedNdisNumber || p.ndisNumber) : '—'}</span>
                  <span className="text-[var(--color-muted-foreground)]">Plan Start Date</span><span>{formatDateAu(p.planStartDate)}</span>
                  <span className="text-[var(--color-muted-foreground)]">Plan End Date</span><span>{formatDateAu(p.planEndDate)}</span>
                </>
              )}
              {p.fundingSource === 'Other' && (
                <>
                  <span className="text-[var(--color-muted-foreground)]">Funding Organisation</span><span>{p.fundingOrganisation || '—'}</span>
                </>
              )}
              {/* INTAKE sub-wave A, NDIS-006. */}
              <span className="text-[var(--color-muted-foreground)]">DSOA</span><span>{p.isDsoa ? 'Yes' : 'No'}</span>
              <span className="text-[var(--color-muted-foreground)]">Repeat Client</span><span>{p.isRepeatClient ? 'Yes' : 'No'}</span>
              <span className="text-[var(--color-muted-foreground)]">Preferred Staff</span><span>{p.preferredStaffName ?? '—'}</span>
            </div>
          </Card>
          <Card title="Address & Living Arrangements">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
              <span className="text-[var(--color-muted-foreground)]">Address</span>
              <span>{[p.addressStreet, p.addressSuburb, p.addressState, p.addressPostcode, p.country].filter(Boolean).join(', ') || '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Living Arrangement</span>
              <span>{p.livingArrangement ? LIVING_ARRANGEMENT_LABELS[p.livingArrangement as LivingArrangement] : '—'}</span>
              {/* LIVING-02/03/04: subsequent content changes per arrangement type — same
                  "only show what's relevant" pattern as the FUND-02 funding-source fields above. */}
              {p.livingArrangement === 'Family' && (
                <>
                  <span className="text-[var(--color-muted-foreground)]">Main Support Person</span>
                  <span>{p.mainSupportPersonName || '—'}{p.mainSupportPersonRelationship ? ` (${p.mainSupportPersonRelationship})` : ''}</span>
                  <span className="text-[var(--color-muted-foreground)]">Others Living in the Accommodation</span>
                  <span>{p.othersLivingInAccommodation || '—'}</span>
                  <span className="text-[var(--color-muted-foreground)]">Residential Information</span>
                  <span>{p.residentialInfo || '—'}</span>
                </>
              )}
              {p.livingArrangement === 'Independent' && (
                <>
                  <span className="text-[var(--color-muted-foreground)]">Lives With Others</span>
                  <span>{p.livesWithOthers ? 'Yes' : 'No'}</span>
                  {p.livesWithOthers && (
                    <>
                      <span className="text-[var(--color-muted-foreground)]">Who They Live With</span>
                      <span>{p.whoLivesWith || '—'}</span>
                    </>
                  )}
                </>
              )}
              {p.livingArrangement === 'SupportedAccommodation' && (
                <>
                  <span className="text-[var(--color-muted-foreground)]">SIL Provider</span>
                  <span>{p.silProviderName || '—'}{p.silProviderContactPhone ? ` (${p.silProviderContactPhone})` : ''}</span>
                  <span className="text-[var(--color-muted-foreground)]">Accommodation Type</span>
                  <span>{p.accommodationType || '—'}</span>
                  <span className="text-[var(--color-muted-foreground)]">On-Site Support Hours</span>
                  <span>{p.onSiteSupportHours || '—'}</span>
                </>
              )}
              {p.livingArrangement && p.livingArrangementNotes && (
                <>
                  <span className="text-[var(--color-muted-foreground)]">Living Arrangement Notes</span>
                  <span>{p.livingArrangementNotes}</span>
                </>
              )}
            </div>
          </Card>
          <Card title="Support Needs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
              <span className="text-[var(--color-muted-foreground)]">Mobility Aids</span>
              <span className="flex flex-wrap gap-1">
                {mobilityAidBadges.length ? mobilityAidBadges.map(b => <Tag key={b} label={b} />) : '—'}
              </span>
              <span className="text-[var(--color-muted-foreground)]">Mobility Support</span>
              <span className="flex flex-wrap gap-1">
                {p.mobilitySupportOptions?.length ? p.mobilitySupportOptions.map(o => <Tag key={o} label={o} />) : '—'}
              </span>
              <span className="text-[var(--color-muted-foreground)]">High Support</span><span>{p.isHighSupport ? <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none text-[var(--color-primary)]">check_circle</span> Yes</span> : 'No'}</span>
              <span className="text-[var(--color-muted-foreground)]">Overnight Support</span>
              <span>{p.overnightSupport && p.overnightSupport !== 'None' ? `${OVERNIGHT_SUPPORT_LABELS[p.overnightSupport]} (${OVERNIGHT_RATIO_LABELS[p.overnightRatio]})` : 'None'}</span>
              <span className="text-[var(--color-muted-foreground)]">Equipment</span>
              <span className="flex flex-wrap gap-1">
                {equipmentBadges.length ? equipmentBadges.map(b => <Tag key={b} label={b} />) : '—'}
              </span>
              <span className="text-[var(--color-muted-foreground)]">Restrictive Practice</span><span>{p.hasRestrictivePracticeFlag ? <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none text-amber-500">warning</span> Yes</span> : 'No'}</span>
            </div>
          </Card>
          {/* INTAKE sub-wave A — Key Identifiers step (research spec §4.4/§5). Same
              whole-card-conditional empty-state pattern as Medical below: nothing here is
              required, so the card only renders once at least one field has a value, rather than
              showing a wall of "—" placeholders. */}
          {(p.pensionCardNumber || p.medicareNumber || p.companionCardNumber || p.privateHealthFund
            || p.taxiCardNumber || p.hairColour || p.eyeColour || p.weightKg || p.heightCm) && (
            <Card title="Key Identifiers">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
                {p.pensionCardNumber && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Pension Card</span>
                    <span>{p.pensionCardNumber}{p.pensionCardExpiry ? ` (expires ${formatDateAu(p.pensionCardExpiry)})` : ''}</span>
                  </>
                )}
                {p.medicareNumber && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Medicare</span>
                    <span>{p.medicareNumber}{p.medicareExpiry ? ` (expires ${formatDateAu(p.medicareExpiry)})` : ''}</span>
                  </>
                )}
                {p.companionCardNumber && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Companion Card</span>
                    <span>{p.companionCardNumber}{p.companionCardExpiry ? ` (expires ${formatDateAu(p.companionCardExpiry)})` : ''}</span>
                  </>
                )}
                {p.privateHealthFund && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Private Health Fund</span>
                    <span>{p.privateHealthFund}{p.privateHealthMembershipNumber ? ` (${p.privateHealthMembershipNumber})` : ''}</span>
                  </>
                )}
                {p.taxiCardNumber && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Taxi Card</span>
                    <span>{p.taxiCardNumber}</span>
                  </>
                )}
                {(p.hairColour || p.eyeColour) && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Hair / Eye Colour</span>
                    <span>{[p.hairColour, p.eyeColour].filter(Boolean).join(' / ') || '—'}</span>
                  </>
                )}
                {(p.weightKg != null || p.heightCm != null) && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Weight / Height</span>
                    <span>{[p.weightKg != null ? `${p.weightKg} kg` : null, p.heightCm != null ? `${p.heightCm} cm` : null].filter(Boolean).join(' / ') || '—'}</span>
                  </>
                )}
              </div>
            </Card>
          )}
          {(p.primaryDiagnosis || p.otherDiagnoses?.length || hidpaCategories.length || p.medicalSummary) && (
            <Card title="Medical" className="md:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
                <span className="text-[var(--color-muted-foreground)]">Primary Diagnosis</span>
                <span>{p.primaryDiagnosis || '—'}</span>
                <span className="text-[var(--color-muted-foreground)]">Other Diagnoses</span>
                <span className="flex flex-wrap gap-1">
                  {p.otherDiagnoses?.length ? p.otherDiagnoses.map((d) => <Tag key={d} label={d} />) : '—'}
                </span>
                <span className="text-[var(--color-muted-foreground)]">HIDPA Support Categories</span>
                <span className="flex flex-wrap gap-1">
                  {hidpaCategories.length
                    ? hidpaCategories.map((c) => <Tag key={c} label={HIDPA_CATEGORY_LABELS[c as HidpaSupportCategory] ?? c} />)
                    : '—'}
                </span>
                {p.medicalSummary && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Medical Summary</span>
                    <span className="whitespace-pre-line">{p.medicalSummary}</span>
                  </>
                )}
              </div>
            </Card>
          )}
          {/* INTAKE sub-wave B — Cultural & Consent step (research spec §4.5/§5). Same
              whole-card-conditional empty-state pattern as Key Identifiers/Medical above: nothing
              here is required, so the card only renders once at least one flag/note has a value. */}
          {(p.isCald != null || p.isLgbtqi != null || p.isFamilyCommunity != null || p.isAboriginalOrTorresStraitIslander != null
            || p.receivedRightsAndResponsibilitiesInfo != null || p.receivedPrivacyAndConfidentialityInfo != null
            || p.receivedFeedbackInfo != null || p.receivedBeingSafeInfo != null || p.receivedAdvocacyInfo != null
            || p.personalInterests || p.choiceControlNotes) && (
            <Card title="Cultural Background" className="md:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
                <span className="text-[var(--color-muted-foreground)]">CALD</span><span>{yesNoUnset(p.isCald)}</span>
                <span className="text-[var(--color-muted-foreground)]">LGBTIQA+</span><span>{yesNoUnset(p.isLgbtqi)}</span>
                <span className="text-[var(--color-muted-foreground)]">Family / Community</span><span>{yesNoUnset(p.isFamilyCommunity)}</span>
                <span className="text-[var(--color-muted-foreground)]">Aboriginal and/or Torres Strait Islander</span><span>{yesNoUnset(p.isAboriginalOrTorresStraitIslander)}</span>
                <span className="text-[var(--color-muted-foreground)]">Received: Rights and Responsibilities</span><span>{yesNoUnset(p.receivedRightsAndResponsibilitiesInfo)}</span>
                <span className="text-[var(--color-muted-foreground)]">Received: Privacy and Confidentiality</span><span>{yesNoUnset(p.receivedPrivacyAndConfidentialityInfo)}</span>
                <span className="text-[var(--color-muted-foreground)]">Received: Feedback Information and Form</span><span>{yesNoUnset(p.receivedFeedbackInfo)}</span>
                <span className="text-[var(--color-muted-foreground)]">Received: Being Safe Information</span><span>{yesNoUnset(p.receivedBeingSafeInfo)}</span>
                <span className="text-[var(--color-muted-foreground)]">Received: Advocacy Information</span><span>{yesNoUnset(p.receivedAdvocacyInfo)}</span>
                {p.personalInterests && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Personal Interests</span>
                    <span className="whitespace-pre-line">{p.personalInterests}</span>
                  </>
                )}
                {p.choiceControlNotes && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Choice & Control Notes</span>
                    <span className="whitespace-pre-line">{p.choiceControlNotes}</span>
                  </>
                )}
              </div>
            </Card>
          )}
          <Card className="md:col-span-2">
            <ParticipantConsentsSection participantId={id} />
          </Card>
          {(p.mobilityNotes || p.transportRequirements || p.equipmentRequirements || p.notes) && (
            <Card title="Notes" className="md:col-span-2">
              <div className="text-sm space-y-2 text-[var(--color-muted-foreground)]">
                {p.mobilityNotes && <p><strong>Mobility:</strong> {p.mobilityNotes}</p>}
                {p.transportRequirements && <p><strong>Transport:</strong> {p.transportRequirements}</p>}
                {p.equipmentRequirements && <p><strong>Equipment:</strong> {p.equipmentRequirements}</p>}
                {p.notes && <p><strong>General:</strong> {p.notes}</p>}
              </div>
            </Card>
          )}
          {/* INTAKE-09 — a compact section rather than its own tab; see RiskEntriesSection's
              module doc for the tab-count call. */}
          <Card className="md:col-span-2">
            <RiskEntriesSection participantId={id} />
          </Card>
        </div>
      )}

      {tab === 'contacts' && (
        <ContactsTab participantId={id} />
      )}

      {tab === 'bookings' && (
        <DataTable
          data={bookings}
          keyField="id"
          columns={[
            {
              key: 'tripName',
              header: 'Trip',
              render: (b: any) => (
                <Link to={`/trips/${b.tripInstanceId}`} className="font-medium hover:text-[var(--color-primary)]">
                  {b.tripName || 'Trip'}
                </Link>
              ),
            },
            { key: 'bookingStatus', header: 'Status', type: 'badge' },
            { key: 'bookingDate', header: 'Date', type: 'date' },
          ]}
          emptyMessage="No bookings"
        />
      )}

      {tab === 'support' && (
        <Card>
          {!supportProfile ? (
            <p className="text-[var(--color-muted-foreground)]">No support profile recorded</p>
          ) : (
            <div className="space-y-4 text-sm">
              {[
                { label: 'Communication Notes', value: supportProfile.communicationNotes },
                { label: 'Behaviour Support', value: supportProfile.behaviourSupportNotes },
                { label: 'Restrictive Practice Details', value: supportProfile.restrictivePracticeDetails },
                { label: 'Manual Handling', value: supportProfile.manualHandlingNotes },
                { label: 'Medication & Health', value: supportProfile.medicationHealthSummary },
                { label: 'Emergency Considerations', value: supportProfile.emergencyConsiderations },
                { label: 'Travel-Specific', value: supportProfile.travelSpecificNotes },
              ].filter(f => f.value).map(f => (
                <div key={f.label}>
                  <p className="font-medium text-[var(--color-muted-foreground)] mb-1">{f.label}</p>
                  <p className="whitespace-pre-line">{f.value}</p>
                </div>
              ))}
              {supportProfile.reviewDate && <p className="text-xs text-[var(--color-muted-foreground)]">Review Date: {formatDateAu(supportProfile.reviewDate)}</p>}
            </div>
          )}
        </Card>
      )}

      {tab === 'medications' && (
        <MedicationsTab participantId={id} />
      )}

      {tab === 'notes' && (
        <NotesTab participantId={id} />
      )}

      {tab === 'routines' && (
        <RoutinesTab participantId={id} />
      )}

      {tab === 'restrictive-practices' && (
        <RestrictivePracticesTab participantId={id} />
      )}

      {tab === 'history' && isAdmin && p && (
        <AuditHistoryTab entityType="Participant" entityId={String(p.id)} />
      )}
    </div>
  )
}
