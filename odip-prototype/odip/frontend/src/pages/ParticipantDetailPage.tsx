import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useParticipant, useParticipantBookings, useSupportProfile, useParticipantAlerts, useDownloadIntakeFormPdf, useDownloadParticipantProfilePdf } from '@/api/hooks'
import { formatDateAu, maskNdisNumber } from '@/lib/utils'
import { DataTable } from '@/components/DataTable'
import { TabNav } from '@/components/TabNav'
import { StatusBadge } from '@/components/StatusBadge'
import { ServiceStreamBadges } from '@/components/ServiceStreamBadges'
import { ParticipantAlertsBanner } from '@/components/ParticipantAlertsBanner'
import { Card } from '@/components/Card'
import { ArrowLeft, Users, Shield, ClipboardList, Pencil, Pill, StickyNote, ListChecks, ShieldAlert, FileEdit, Contact2, Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import AuditHistoryTab from '@/components/AuditHistoryTab'
import { usePermissions } from '@/lib/permissions'
import {
  OVERNIGHT_SUPPORT_LABELS, OVERNIGHT_RATIO_LABELS, GENDER_LABELS, FUNDING_SOURCE_LABELS, LIVING_ARRANGEMENT_LABELS, HIDPA_CATEGORY_LABELS, parseHidpaCategories,
  AMBULANT_STATUS_LABELS, PERSONAL_CARE_LEVEL_LABELS, RISK_RATING_LEVEL_LABELS, MEMORY_LEVEL_LABELS,
  parseServiceStreams,
} from '@/api/types/participants'
import { CHECKLIST_ITEM_TYPES, CHECKLIST_ITEM_TYPE_LABELS, CHECKLIST_ITEM_VALUE_LABELS } from '@/api/types/enums'
import type { Gender, FundingSource, LivingArrangement, HidpaSupportCategory, ChecklistItemType } from '@/api/types/enums'
import { MedicationsTab, NotesTab, RoutinesTab, RestrictivePracticesTab, RiskEntriesSection, ParticipantConsentsSection, ParticipantHealthConditionsSection, ParticipantAdlAssessmentsSection, ContactsTab } from './participant-detail'

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
  // DOC-01 — Documents header buttons. Hooks called unconditionally, ahead of the isLoading/!p
  // early returns below, per the rules of hooks.
  const downloadIntakeForm = useDownloadIntakeFormPdf()
  const downloadParticipantProfile = useDownloadParticipantProfilePdf()

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

  // INTAKE-03, CommunityAccessDailyLiving stream.
  const isCommunityAccess = parseServiceStreams(p.serviceStreams).includes('CommunityAccessDailyLiving')
  // Only items that actually have a Value set — matching the ADL/health-condition sections'
  // "don't show a wall of unanswered rows" convention (this page has no such precedent of its
  // own; the fixed-enumerated-set sections instead render every row via DataTable, which has its
  // own emptyMessage for a still-loading/zero-row state — but a compact inline list here follows
  // the whole-card presence-or-relevance idiom this page DOES use everywhere else, so unanswered
  // placeholder rows are skipped).
  const answeredChecklistItems = CHECKLIST_ITEM_TYPES
    .map((type) => p.checklistItems?.find((row) => row.itemType === type))
    .filter((row): row is NonNullable<typeof row> => !!row?.value)

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
        <div className="flex items-center gap-2">
          {/* DOC-01 — secondary Documents actions; ungated, unlike the primary Edit action below:
              downloading/printing documents is a read action, and this page has no more specific
              canView... flag of its own to gate read-level content on (see usePermissions — the
              closest candidates, canViewAlerts/canViewAdministrationReport, are for unrelated
              features), so these follow the rest of the page's ungated read-only content. */}
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={() => downloadIntakeForm.mutate({ id: id!, fileName: `${p.fullName} - Intake Form.pdf` })}
              disabled={downloadIntakeForm.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-all disabled:opacity-50"
            >
              {downloadIntakeForm.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {downloadIntakeForm.isPending ? 'Preparing…' : 'Intake Form PDF'}
            </button>
            {downloadIntakeForm.isError && (
              <p role="alert" className="text-xs text-[var(--color-destructive)]">
                Couldn't download the file. Try again, or contact support if this keeps happening.
              </p>
            )}
          </div>
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={() => downloadParticipantProfile.mutate({ id: id!, fileName: `${p.fullName} - Participant Profile.pdf` })}
              disabled={downloadParticipantProfile.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-all disabled:opacity-50"
            >
              {downloadParticipantProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {downloadParticipantProfile.isPending ? 'Preparing…' : 'Participant Profile PDF'}
            </button>
            {downloadParticipantProfile.isError && (
              <p role="alert" className="text-xs text-[var(--color-destructive)]">
                Couldn't download the file. Try again, or contact support if this keeps happening.
              </p>
            )}
          </div>
          {canWrite && (
            <Link to={`/participants/${id}/edit`} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20">
              <Pencil className="w-4 h-4" /> Edit
            </Link>
          )}
        </div>
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

      {/* PDETAIL-01 — the Details tab's card order now mirrors the intake wizard's step-family
          order (ParticipantCreatePage.tsx's WIZARD_STEPS) end to end: Identity, NDIS & Funding,
          Key Identifiers, [Contacts has its own sibling tab, matching CONTACT-01/02/03's own
          wizard step], Cultural & Consent, Support Needs & Mobility, Medical, Behaviour &
          Communication, Daily Living, Risks & Hazards. A field now lives in the same conceptual
          group here as it does in the wizard, rather than the prior ad hoc ordering (funding
          fields dumped into "Personal Information", Key Identifiers and Cultural & Consent
          floating after Support Needs/Behaviour & Communication, mobility free-text fields
          stranded in a generic "Notes" card far from the rest of Support Needs & Mobility). See
          this PR's report for the fuller inventory of what was incoherent before this pass. */}
      {tab === 'details' && (
        <div className="grid md:grid-cols-2 gap-6">
          <Card title="Identity">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
              {/* PDETAIL-01 review round — First Name/Last Name/Preferred Name are captured on
                  the wizard's Identity step and shown as their own rows on its Review summary
                  (ParticipantCreatePage.tsx's reviewGroups), but previously rendered nowhere on
                  this page: the header's <h1> shows only the computed FullName, which — per
                  Participant.FullName's own formula — substitutes PreferredName for FirstName
                  entirely once a preferred name is set, so a participant's legal first name (and
                  the fact a preferred name is even in use) could become invisible here. Same
                  always-visible "—" idiom as every other row on this card; FirstName/LastName are
                  non-nullable on the DTO (always populated for a saved participant) but guarded
                  the same way as everything else on this card for consistency. */}
              <span className="text-[var(--color-muted-foreground)]">First Name</span><span>{p.firstName || '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Last Name</span><span>{p.lastName || '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Preferred Name</span><span>{p.preferredName || '—'}</span>
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
                  "only show what's relevant" pattern as the FUND-02 funding-source fields on the
                  NDIS & Funding card below. */}
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
          {/* PDETAIL-01 — split out of the old "Personal Information" card, which mixed Identity
              step fields with these NDIS & Funding step fields under one heading. Own card now,
              matching the wizard's own step boundary. */}
          <Card title="NDIS & Funding">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
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
            </div>
          </Card>
          {/* INTAKE sub-wave A — Key Identifiers step (research spec §4.4/§5). Same
              whole-card-conditional empty-state pattern as Medical below: nothing here is
              required, so the card only renders once at least one field has a value, rather than
              showing a wall of "—" placeholders. PDETAIL-01: repositioned to sit directly after
              NDIS & Funding, matching the wizard's own step order (Identity → NDIS & Funding →
              Key Identifiers) — it previously floated after Support Needs, several steps out of
              sequence. */}
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
          {/* INTAKE sub-wave B — Cultural & Consent step (research spec §4.5/§5). Same
              whole-card-conditional empty-state pattern as Key Identifiers/Medical above: nothing
              here is required, so the card only renders once at least one flag/note has a value.
              PDETAIL-01: repositioned (with the Consents section immediately below it) to sit
              right after Key Identifiers, matching the wizard's Cultural & Consent step — it
              previously floated after Behaviour & Communication, several steps out of sequence. */}
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
          {/* PDETAIL-01 — renamed from "Support Needs" to "Support Needs & Mobility" to match the
              wizard step's own label exactly (STEP_SUPPORT_FIELDS/WIZARD_STEPS), and widened to
              md:col-span-2 now that it also carries the free-text fields below (previously
              stranded in a generic "Notes" card near the bottom of the page, alongside the
              unrelated Risks & Hazards fields) and Intensive Support (previously not rendered
              anywhere on this page at all — see this PR's report). */}
          <Card title="Support Needs & Mobility" className="md:col-span-2">
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
              {/* PDETAIL-01 — Intensive Support (NDIS billing flag): present on the Participant
                  entity/DTO and the wizard's Support Needs & Mobility step, but never rendered
                  anywhere on this page before this pass. */}
              <span className="text-[var(--color-muted-foreground)]">Intensive Support</span><span>{p.isIntensiveSupport ? 'Yes' : 'No'}</span>
              <span className="text-[var(--color-muted-foreground)]">Overnight Support</span>
              <span>{p.overnightSupport && p.overnightSupport !== 'None' ? `${OVERNIGHT_SUPPORT_LABELS[p.overnightSupport]} (${OVERNIGHT_RATIO_LABELS[p.overnightRatio]})` : 'None'}</span>
              <span className="text-[var(--color-muted-foreground)]">Equipment</span>
              <span className="flex flex-wrap gap-1">
                {equipmentBadges.length ? equipmentBadges.map(b => <Tag key={b} label={b} />) : '—'}
              </span>
              <span className="text-[var(--color-muted-foreground)]">Restrictive Practice</span><span>{p.hasRestrictivePracticeFlag ? <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none text-amber-500">warning</span> Yes</span> : 'No'}</span>
              {/* INTAKE sub-wave C1 — Mobility & Functional (research spec §4.7/§5). */}
              <span className="text-[var(--color-muted-foreground)]">Ambulant Status</span><span>{p.ambulantStatus ? AMBULANT_STATUS_LABELS[p.ambulantStatus] : '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Falls Risk Rating</span><span>{p.fallsRiskRating ? RISK_RATING_LEVEL_LABELS[p.fallsRiskRating] : '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Uneven Ground</span><span>{yesNoUnset(p.unevenGroundFlag)}</span>
              <span className="text-[var(--color-muted-foreground)]">Level of Personal Care</span><span>{p.levelOfPersonalCare ? PERSONAL_CARE_LEVEL_LABELS[p.levelOfPersonalCare] : '—'}</span>
              {p.orthotics && (<><span className="text-[var(--color-muted-foreground)]">Orthotics</span><span className="whitespace-pre-line">{p.orthotics}</span></>)}
              {p.continenceSupportDetail && (<><span className="text-[var(--color-muted-foreground)]">Continence Support</span><span className="whitespace-pre-line">{p.continenceSupportDetail}</span></>)}
              {p.bowelCareDetail && (<><span className="text-[var(--color-muted-foreground)]">Colostomy / Catheter / Enema / Suppository</span><span className="whitespace-pre-line">{p.bowelCareDetail}</span></>)}
              {p.menstruationSupport && (<><span className="text-[var(--color-muted-foreground)]">Menstruation Support</span><span className="whitespace-pre-line">{p.menstruationSupport}</span></>)}
              {p.skinIntegrity && (<><span className="text-[var(--color-muted-foreground)]">Skin Integrity</span><span className="whitespace-pre-line">{p.skinIntegrity}</span></>)}
              {/* PDETAIL-01 — moved in from the old bottom-of-page "Notes" card, which mixed
                  these Support Needs & Mobility step fields with the unrelated Risks & Hazards
                  step's General Notes field. Rendered with this card's own established
                  conditional-row idiom (matching Orthotics/Continence Support above) rather than
                  the old card's flat "<strong>Label:</strong> value" paragraph style. */}
              {p.mobilityNotes && (<><span className="text-[var(--color-muted-foreground)]">Mobility Notes</span><span className="whitespace-pre-line">{p.mobilityNotes}</span></>)}
              {p.equipmentRequirements && (<><span className="text-[var(--color-muted-foreground)]">Equipment Requirements</span><span className="whitespace-pre-line">{p.equipmentRequirements}</span></>)}
              {p.transportRequirements && (<><span className="text-[var(--color-muted-foreground)]">Transport Requirements</span><span className="whitespace-pre-line">{p.transportRequirements}</span></>)}
            </div>
          </Card>
          {(p.primaryDiagnosis || p.otherDiagnoses?.length || hidpaCategories.length || p.hidpaNotes || p.medicalSummary
            || p.allergiesDetail || p.isAnaphylaxisRisk != null || p.allergyManagementNotes) && (
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
                {/* INTAKE-03/DIAG-02 reconciliation — ungated, same visibility as the categories above. */}
                {p.hidpaNotes && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">HIDPA Notes</span>
                    <span className="whitespace-pre-line">{p.hidpaNotes}</span>
                  </>
                )}
                {p.medicalSummary && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Medical Summary</span>
                    <span className="whitespace-pre-line">{p.medicalSummary}</span>
                  </>
                )}
                {/* INTAKE sub-wave C1 — Allergies/Anaphylaxis (Master Data Dictionary MED-012). */}
                {p.allergiesDetail && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Allergies</span>
                    <span className="whitespace-pre-line">{p.allergiesDetail}</span>
                  </>
                )}
                {p.isAnaphylaxisRisk != null && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Anaphylaxis Risk</span>
                    <span>{p.isAnaphylaxisRisk
                      ? <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none text-[var(--color-destructive)]">warning</span> Yes</span>
                      : 'No'}</span>
                  </>
                )}
                {p.allergyManagementNotes && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Allergy Management Notes</span>
                    <span className="whitespace-pre-line">{p.allergyManagementNotes}</span>
                  </>
                )}
              </div>
            </Card>
          )}
          {/* INTAKE sub-wave C1 — the structured health-condition grid (research spec §4.6/§5),
              always rendered (unlike the whole-card-conditional cards above): GetForParticipant
              always returns all ten HealthConditionType entries, so there is no genuinely-empty
              state to hide behind a condition — DataTable's own emptyMessage handles a
              still-loading/zero-row edge case instead. */}
          <Card className="md:col-span-2">
            <ParticipantHealthConditionsSection participantId={id} />
          </Card>
          {/* INTAKE sub-wave C1 — Behaviour & Communication (research spec §4.8/§5). Same
              whole-card-conditional empty-state pattern as Medical above. */}
          {(p.memory != null || p.memoryAids != null || p.impairedUnderstanding != null || p.impairedJudgementReasoning != null
            || p.behavioursOfConcernCurrent != null || p.behavioursOfConcernFiveYearHistory != null || p.behaviourRiskRating != null
            || p.ridsLogged != null || p.bspPlanProvided != null || p.bocChartProvided != null
            || p.expressiveSkills || p.receptiveSkills || p.readingAbility || p.communicationAids) && (
            <Card title="Behaviour & Communication" className="md:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
                <span className="text-[var(--color-muted-foreground)]">Memory</span><span>{p.memory ? MEMORY_LEVEL_LABELS[p.memory] : '—'}</span>
                <span className="text-[var(--color-muted-foreground)]">Memory Aids</span><span>{yesNoUnset(p.memoryAids)}</span>
                <span className="text-[var(--color-muted-foreground)]">Impaired Understanding</span><span>{yesNoUnset(p.impairedUnderstanding)}</span>
                <span className="text-[var(--color-muted-foreground)]">Impaired Judgement / Reasoning</span><span>{yesNoUnset(p.impairedJudgementReasoning)}</span>
                <span className="text-[var(--color-muted-foreground)]">Behaviours of Concern (Current)</span><span>{yesNoUnset(p.behavioursOfConcernCurrent)}</span>
                <span className="text-[var(--color-muted-foreground)]">Behaviours of Concern (5-Year History)</span><span>{yesNoUnset(p.behavioursOfConcernFiveYearHistory)}</span>
                <span className="text-[var(--color-muted-foreground)]">Behaviour Risk Rating</span><span>{p.behaviourRiskRating ? RISK_RATING_LEVEL_LABELS[p.behaviourRiskRating] : '—'}</span>
                <span className="text-[var(--color-muted-foreground)]">RIDS Logged</span><span>{yesNoUnset(p.ridsLogged)}</span>
                <span className="text-[var(--color-muted-foreground)]">BSP Plan Provided</span><span>{yesNoUnset(p.bspPlanProvided)}</span>
                <span className="text-[var(--color-muted-foreground)]">BOC Chart Provided</span><span>{yesNoUnset(p.bocChartProvided)}</span>
                {p.expressiveSkills && (<><span className="text-[var(--color-muted-foreground)]">Expressive Skills</span><span className="whitespace-pre-line">{p.expressiveSkills}</span></>)}
                {p.receptiveSkills && (<><span className="text-[var(--color-muted-foreground)]">Receptive Skills</span><span className="whitespace-pre-line">{p.receptiveSkills}</span></>)}
                {p.readingAbility && (<><span className="text-[var(--color-muted-foreground)]">Reading Ability</span><span className="whitespace-pre-line">{p.readingAbility}</span></>)}
                {p.communicationAids && (<><span className="text-[var(--color-muted-foreground)]">Communication Aids</span><span className="whitespace-pre-line">{p.communicationAids}</span></>)}
              </div>
            </Card>
          )}
          {/* INTAKE-03/04, CommunityAccessDailyLiving stream (research spec §3) — gated on the
              stream flag itself (unlike the whole-card-conditional cards elsewhere on this page,
              which gate on field presence): this card's fields have no meaning for a participant
              who isn't in the CA stream, even if stray data happened to be saved while the flag
              was briefly on (see the stream-removal confirm dialog on the wizard's NDIS & Funding
              step, which warns before that data is cleared). PDETAIL-01: repositioned directly
              after Behaviour & Communication — every field this card renders belongs to either
              the wizard's Support Needs & Mobility step (the Community Mobility & Transport Risk
              half of checklistItems) or its Behaviour & Communication step (everything else:
              signsHappyAndSettled..bocWhatNotToDo, supportsLookLike*, and the Community
              Behaviours of Concern half of checklistItems) — it previously sat after the Daily
              Living group's ADL section instead, a step family this card has no fields from. */}
          {isCommunityAccess && (
            <Card title="Community Access" className="md:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
                {p.signsHappyAndSettled && (<><span className="text-[var(--color-muted-foreground)]">Signs I Am Happy and Settled</span><span className="whitespace-pre-line">{p.signsHappyAndSettled}</span></>)}
                {p.whatHelpsMeCalmDown && (<><span className="text-[var(--color-muted-foreground)]">What Helps Me Calm Down</span><span className="whitespace-pre-line">{p.whatHelpsMeCalmDown}</span></>)}
                {p.bocTriggers && (<><span className="text-[var(--color-muted-foreground)]">BOC — Triggers</span><span className="whitespace-pre-line">{p.bocTriggers}</span></>)}
                {p.bocEarlyWarningSigns && (<><span className="text-[var(--color-muted-foreground)]">BOC — Early Warning Signs</span><span className="whitespace-pre-line">{p.bocEarlyWarningSigns}</span></>)}
                {p.bocDeEscalationStrategies && (<><span className="text-[var(--color-muted-foreground)]">BOC — De-Escalation Strategies</span><span className="whitespace-pre-line">{p.bocDeEscalationStrategies}</span></>)}
                {p.bocWhatNotToDo && (<><span className="text-[var(--color-muted-foreground)]">BOC — What Not To Do</span><span className="whitespace-pre-line">{p.bocWhatNotToDo}</span></>)}
                {(p.supportsLookLikeMorning || p.supportsLookLikeDay || p.supportsLookLikeAfternoonEvening || p.supportsLookLikeOvernight) && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">What My Supports Look Like</span>
                    <span className="whitespace-pre-line">
                      {[
                        p.supportsLookLikeMorning && `Morning: ${p.supportsLookLikeMorning}`,
                        p.supportsLookLikeDay && `Day: ${p.supportsLookLikeDay}`,
                        p.supportsLookLikeAfternoonEvening && `Afternoon-Evening: ${p.supportsLookLikeAfternoonEvening}`,
                        p.supportsLookLikeOvernight && `Overnight: ${p.supportsLookLikeOvernight}`,
                      ].filter(Boolean).join('\n')}
                    </span>
                  </>
                )}
              </div>
              {/* Compact list — only items that actually have a Value set (see answeredChecklistItems' doc above). */}
              {answeredChecklistItems.length > 0 && (
                <div className="mt-4 space-y-2 text-sm">
                  <p className="font-medium text-[var(--color-muted-foreground)]">Community Mobility &amp; Transport Risk / Behaviours of Concern Checklist</p>
                  <div className="divide-y divide-[var(--color-border)]">
                    {answeredChecklistItems.map((row) => (
                      <div key={row.itemType} className="py-2 flex items-start justify-between gap-4">
                        <span>{CHECKLIST_ITEM_TYPE_LABELS[row.itemType as ChecklistItemType]}</span>
                        <span className="text-right">
                          <Tag label={CHECKLIST_ITEM_VALUE_LABELS[row.value!] ?? row.value!} />
                          {row.notes && <span className="block text-xs text-[var(--color-muted-foreground)] mt-1 max-w-xs">{row.notes}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}
          {/* INTAKE sub-wave C2 — the structured ADL rating grid (research spec §4.9/§5), always
              rendered (unlike the whole-card-conditional cards below): GetForParticipant always
              returns all twenty AdlType entries, so there is no genuinely-empty state to hide
              behind a condition — DataTable's own emptyMessage handles a still-loading/zero-row
              edge case instead. Same convention as ParticipantHealthConditionsSection above. */}
          <Card className="md:col-span-2">
            <ParticipantAdlAssessmentsSection participantId={id} />
          </Card>
          {/* INTAKE sub-wave C2 — Meals & Diet (Daily Living step, research spec §4.9/§5). Same
              whole-card-conditional empty-state pattern as Medical/Cultural Background above. */}
          {(p.mealAssistanceDetail || p.chokingRiskMealDetail || p.modifiedDietDetail || p.pegRegimeMealDetail
            || p.specialUtensilsDetail || p.specialDietaryNeedsDetail || p.favouriteBreakfast || p.favouriteLunch
            || p.favouriteDinner || p.medicationTricks || p.foodsAlwaysEaten) && (
            <Card title="Meals & Diet" className="md:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
                {p.mealAssistanceDetail && (<><span className="text-[var(--color-muted-foreground)]">Meal Assistance</span><span className="whitespace-pre-line">{p.mealAssistanceDetail}</span></>)}
                {p.chokingRiskMealDetail && (<><span className="text-[var(--color-muted-foreground)]">Choking Risk — Meal Management</span><span className="whitespace-pre-line">{p.chokingRiskMealDetail}</span></>)}
                {p.modifiedDietDetail && (<><span className="text-[var(--color-muted-foreground)]">Modified Diet</span><span className="whitespace-pre-line">{p.modifiedDietDetail}</span></>)}
                {p.pegRegimeMealDetail && (<><span className="text-[var(--color-muted-foreground)]">PEG Regime</span><span className="whitespace-pre-line">{p.pegRegimeMealDetail}</span></>)}
                {p.specialUtensilsDetail && (<><span className="text-[var(--color-muted-foreground)]">Special Utensils</span><span className="whitespace-pre-line">{p.specialUtensilsDetail}</span></>)}
                {p.specialDietaryNeedsDetail && (<><span className="text-[var(--color-muted-foreground)]">Special Dietary Needs</span><span className="whitespace-pre-line">{p.specialDietaryNeedsDetail}</span></>)}
                {(p.favouriteBreakfast || p.favouriteLunch || p.favouriteDinner) && (
                  <>
                    <span className="text-[var(--color-muted-foreground)]">Favourite Meals</span>
                    <span className="whitespace-pre-line">
                      {[p.favouriteBreakfast && `Breakfast: ${p.favouriteBreakfast}`, p.favouriteLunch && `Lunch: ${p.favouriteLunch}`, p.favouriteDinner && `Dinner: ${p.favouriteDinner}`].filter(Boolean).join('\n')}
                    </span>
                  </>
                )}
                {p.medicationTricks && (<><span className="text-[var(--color-muted-foreground)]">Medication Tricks</span><span className="whitespace-pre-line">{p.medicationTricks}</span></>)}
                {p.foodsAlwaysEaten && (<><span className="text-[var(--color-muted-foreground)]">Foods Always Eaten</span><span className="whitespace-pre-line">{p.foodsAlwaysEaten}</span></>)}
              </div>
            </Card>
          )}
          {/* INTAKE sub-wave C2 — About Me (Daily Living step, research spec §4.9/§5). Hobbies is
              deliberately NOT repeated here — see personalInterests on the Cultural Background
              card above (dedup call, this PR's report). */}
          {(p.goals || p.supportAreas || p.strengthsFears || p.thingsToKnow || p.whoIsImportant || p.likesDislikes) && (
            <Card title="About Me" className="md:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
                {p.goals && (<><span className="text-[var(--color-muted-foreground)]">Goals</span><span className="whitespace-pre-line">{p.goals}</span></>)}
                {p.supportAreas && (<><span className="text-[var(--color-muted-foreground)]">Support Areas</span><span className="whitespace-pre-line">{p.supportAreas}</span></>)}
                {p.strengthsFears && (<><span className="text-[var(--color-muted-foreground)]">Strengths / Fears</span><span className="whitespace-pre-line">{p.strengthsFears}</span></>)}
                {p.thingsToKnow && (<><span className="text-[var(--color-muted-foreground)]">Things to Know</span><span className="whitespace-pre-line">{p.thingsToKnow}</span></>)}
                {p.whoIsImportant && (<><span className="text-[var(--color-muted-foreground)]">Who/What Is Important</span><span className="whitespace-pre-line">{p.whoIsImportant}</span></>)}
                {p.likesDislikes && (<><span className="text-[var(--color-muted-foreground)]">Likes &amp; Dislikes</span><span className="whitespace-pre-line">{p.likesDislikes}</span></>)}
              </div>
            </Card>
          )}
          {/* PDETAIL-01 — renamed from the old catch-all "Notes" card and trimmed to just this
              Risks & Hazards step's two scalar fields (STEP_RISK_FIELDS: behaviourRiskSummary,
              notes — riskEntries is the RiskEntriesSection below). The old card also carried
              mobilityNotes/equipmentRequirements/transportRequirements, which belong to the
              Support Needs & Mobility step and have moved to that card above — see this PR's
              report. behaviourRiskSummary itself was previously not rendered anywhere on this
              page at all, alongside notes' prior mis-grouping. */}
          {(p.behaviourRiskSummary || p.notes) && (
            <Card title="Risks & Hazards Summary" className="md:col-span-2">
              <div className="text-sm space-y-2 text-[var(--color-muted-foreground)]">
                {p.behaviourRiskSummary && <p><strong>Behaviour Risk Summary:</strong> {p.behaviourRiskSummary}</p>}
                {p.notes && <p><strong>General Notes:</strong> {p.notes}</p>}
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
