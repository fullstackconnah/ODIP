import { useParams, useNavigate } from 'react-router-dom'
import {
  useParticipant, useParticipantAlerts, useDownloadIntakeFormPdf, useDownloadParticipantProfilePdf, useDownloadClientOverviewPdf,
  useGenerateCaregiverLink, useRevokeCaregiverLink, useCaregiverSubmissions,
} from '@/api/hooks'
import { PLAN_TYPE_LABELS, SUPPORT_RATIO_LABELS } from '@/api/types/enums'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { Tabs } from '@/components/Tabs'
import { StatusBadge } from '@/components/StatusBadge'
import { ReadinessNote } from '@/components/ReadinessNote'
import { ServiceStreamBadges } from '@/components/ServiceStreamBadges'
import { ParticipantAlertsBanner } from '@/components/ParticipantAlertsBanner'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { BackButton } from '@/components/BackButton'
import { useTabParam } from '@/hooks/useTabParam'
import { PageState } from '@/components/PageState'
import { isNotFoundError } from '@/lib/httpStatus'
import { Users, Shield, ClipboardList, Pencil, Pill, StickyNote, ListChecks, ShieldAlert, FileEdit, Contact2, Download, Loader2, Link2, Link2Off, FileText, ClipboardCheck, CalendarRange, Wallet } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import AuditHistoryTab from '@/components/AuditHistoryTab'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu, extractErrorMessage } from '@/lib/utils'
import { copyText } from '@/lib/clipboard'
import {
  MedicationsTab, NotesTab, RoutinesTab, RestrictivePracticesTab, RiskEntriesSection, ParticipantConsentsSection,
  ParticipantHealthConditionsSection, ParticipantAdlAssessmentsSection, ContactsTab, SupportProfileTab, ClaimsTab,
  RosteringTab, FundingTab, BookingsTab,
  ParticipantIdentitySection, ParticipantAddressLivingSection, ParticipantNdisFundingSection, ParticipantKeyIdentifiersSection,
  ParticipantCulturalBackgroundSection, ParticipantMedicalSection, ParticipantBehaviourCommunicationSection,
  ParticipantCommunityAccessSection, ParticipantMealsDietSection, ParticipantAboutMeSection, ParticipantRisksHazardsSummarySection,
  hasAddressLiving, hasKeyIdentifiers, hasCulturalBackground, hasMedical, hasBehaviourCommunication, hasMealsDiet, hasAboutMe, hasRisksHazardsSummary,
  NotRecordedFold,
} from './participant-detail'
import { joinList } from '@/lib/format'
import { Card } from '@/components/Card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { retryingAfterError } from '@/lib/queryPhase'

/**
 * A zero-row (or still-loading) DataTable's only body row is one `td[colspan]` message cell — a table
 * with a column header over nothing, ~102px tall for one line of text. Health Conditions and the ADL
 * grids always come back fully populated from the API, so this only shows in the edge cases; when it
 * does it should read as a strip, not a panel: hide the header over an empty body and trim the message
 * cell to py-5, which lands the whole empty table at ≈62px. Populated tables are untouched (their
 * body has no `td[colspan]`).
 */
const COMPACT_EMPTY_TABLE = '[&_table:has(td[colspan])_thead]:hidden [&_td[colspan]]:py-5'

/** The tabs, in strip order. The active one is `?tab=` (`useTabParam`), so a reload or a shared link keeps it; an unknown value reads as Details. */
const TAB_KEYS = ['details', 'contacts', 'bookings', 'support', 'medications', 'notes', 'routines', 'restrictive-practices', 'claims', 'funding', 'rostering', 'history'] as const

export default function ParticipantDetailPage() {
  const { canWrite, canViewAlerts, canWriteParticipantDetails, canManageFunding, canAccessPage, isAdmin, isSuperAdmin } = usePermissions()
  const { id } = useParams()
  const canAccessClaims = canAccessPage('claims')
  // The agreement draft carries money: only the roles the API admits to its GETs are offered it (ReadOnly would only meet a 403).
  const canOpenAgreementDraft = canAccessPage('agreement-drafts')
  // Connection map item 12 — the Rostering tab, same canAccessPage gate RosterBoardPage itself
  // uses (see lib/permissions.ts's SUPPORT_WORKER_PAGES — SupportWorker is excluded).
  const canAccessRostering = canAccessPage('rostering')
  const canSeeHistory = isSuperAdmin || isAdmin
  // Only the tabs this role can see are valid ?tab= keys (L5-05): a link to History, Claims, Funding or Rostering opened by a role without that tab
  // reads as Details, instead of selecting nothing over an empty body. Funding is money (a participant's plan budget), so it has its own gate and never `canWrite`.
  const tabKeys = useMemo(
    () => TAB_KEYS.filter(key => (key === 'claims' ? canAccessClaims : key === 'funding' ? canManageFunding : key === 'rostering' ? canAccessRostering : key === 'history' ? canSeeHistory : true)),
    [canAccessClaims, canManageFunding, canAccessRostering, canSeeHistory],
  )
  const [tab, setTab] = useTabParam(tabKeys, 'details')
  const pageQuery = useParticipant(id)
  const { data: p, isLoading, isError, error, refetch } = pageQuery
  const { data: alertsData } = useParticipantAlerts(id, canViewAlerts)
  // DOC-01 — Documents header buttons. Hooks called unconditionally, ahead of the isLoading/!p
  // early returns below, per the rules of hooks.
  const downloadIntakeForm = useDownloadIntakeFormPdf()
  const downloadParticipantProfile = useDownloadParticipantProfilePdf()
  // PF-10.6 — third Documents button, no tripId: SPEC-05 flagged this Participant-detail surface
  // as an open product question (Client Overview only really makes sense per-trip) but included
  // it as the safer default (more availability, not less) — same document, blank TRIP/DATE/GROUP
  // header. See this branch's report for the reversible product call.
  const downloadClientOverview = useDownloadClientOverviewPdf()
  const caregiverLink = useCaregiverLink(id!)

  if (isLoading && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="participant" />
  if (!p) {
    return (isError || retryingAfterError(pageQuery)) && !isNotFoundError(error)
      ? <PageState kind="error" noun="participant" onRetry={() => refetch()} />
      : <PageState kind="not-found" noun="participant" backTo="/participants" backLabel="participants" />
  }

  // The Details tab's short cards in wizard order; `has` is false for a card with nothing recorded yet (Identity, NDIS & Funding and
  // Community Access always have something: a name, a funding source, and a card that only shows for that stream).
  const edit = { p, participantId: id!, canEdit: canWriteParticipantDetails }
  const shortCards = [
    { title: 'Identity', has: true, card: <ParticipantIdentitySection key="identity" {...edit} /> },
    { title: 'Address & Living Arrangements', has: hasAddressLiving(p), card: <ParticipantAddressLivingSection key="address" {...edit} /> },
    { title: 'NDIS & Funding', has: true, card: <ParticipantNdisFundingSection key="ndis" {...edit} /> },
    { title: 'Key Identifiers', has: hasKeyIdentifiers(p), card: <ParticipantKeyIdentifiersSection key="identifiers" {...edit} /> },
    { title: 'Cultural Background', has: hasCulturalBackground(p), card: <ParticipantCulturalBackgroundSection key="cultural" {...edit} /> },
    { title: 'Medical', has: hasMedical(p), card: <ParticipantMedicalSection key="medical" {...edit} /> },
    { title: 'Behaviour & Communication', has: hasBehaviourCommunication(p), card: <ParticipantBehaviourCommunicationSection key="behaviour" {...edit} /> },
    { title: 'Community Access', has: true, card: <ParticipantCommunityAccessSection key="community" {...edit} /> },
    { title: 'Meals & Diet', has: hasMealsDiet(p), card: <ParticipantMealsDietSection key="meals" {...edit} /> },
    { title: 'About Me', has: hasAboutMe(p), card: <ParticipantAboutMeSection key="about" {...edit} /> },
    { title: 'Risks & Hazards Summary', has: hasRisksHazardsSummary(p), card: <ParticipantRisksHazardsSummarySection key="risks" {...edit} /> },
  ]
  // Back goes where the user came from; with no history (a deep link) it falls back to the list this participant is on. A draft is never on
  // Active participants: before intake is complete it is a Draft intake row on Enquiries, after it a row on Onboarding.
  const [backTo, backLabel] = !p.isDraft ? ['/participants', 'participants']
    : p.intakeCompletedAt ? ['/participants?tab=onboarding', 'onboarding'] : ['/participants?tab=enquiries', 'enquiries']
  const recordedCards = shortCards.filter(c => c.has)
  const emptyCards = shortCards.filter(c => !c.has)

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <div className="flex items-start gap-2">
        {/* The icon variant is a --control-h-sm square (36px on a coarse pointer); its --tap-min floor lifts it to
            44 there and is 0 — no change — on a mouse. */}
        <BackButton to={backTo} label={backLabel} variant="icon" className="mt-1" />
        <div className="flex-1 min-w-0">
          <PageHeader
            title={p.fullName}
            subtitle={
              <div className="flex flex-wrap items-center gap-3 text-[13px] text-[var(--color-muted-foreground)]">
                <StatusBadge status={p.isActive ? 'Active' : 'Inactive'} />
                {/* What is still missing, as a quiet warning-tone chip beside the status. Informational: nothing on this page is gated on it. */}
                <ReadinessNote issues={p.readinessIssues} variant="chip" />
                <span>{p.region || 'No region'} · {PLAN_TYPE_LABELS[p.planType] ?? p.planType} · Support Ratio: {SUPPORT_RATIO_LABELS[p.supportRatio] ?? p.supportRatio}</span>
                <ServiceStreamBadges value={p.serviceStreams} />
              </div>
            }
            action={
              // One menu and one primary at every width (VISUAL-1 V2): the documents, the agreement draft and the caregiver link fold into
              // the menu, and Edit is the visible action. justify-start below md (the cluster sits under the title); justify-end from md up.
              <div className="flex flex-wrap items-start justify-start gap-2 md:justify-end">
                {/* DOC-01 — the downloads are ungated, unlike Edit: downloading/printing documents is a read action, and this page has no
                    more specific canView... flag of its own to gate read-level content on. The caregiver-link items inside are gated on
                    canWriteParticipantDetails (a write action) — see B15 in the discovery fact sheet. */}
                <DocumentsMenu
                  participantId={id!}
                  fullName={p.fullName}
                  canOpenAgreementDraft={canOpenAgreementDraft}
                  intake={downloadIntakeForm}
                  profile={downloadParticipantProfile}
                  overview={downloadClientOverview}
                  caregiverLink={caregiverLink}
                />
                {canWrite && (
                  // PF-10.7 (SPEC-05): the old single-step wizard is retired — this now
                  // points straight at the Profile-wizard edit entry point (PF-10.4) rather than the
                  // now-redirecting /edit route.
                  <Button to={`/participants/${id}/profile`} variant="primary" size="md">
                    <Pencil className="w-4 h-4" /> Edit
                  </Button>
                )}
              </div>
            }
          />
          {/* SPEC-05 PF-10.5 — three-way resume-banner state, derived from IntakeCompletedAt/IsDraft:
              no IntakeCompletedAt -> "Resume intake" (fresh Intake start, pre-filled from this row);
              IntakeCompletedAt set + IsDraft -> "Continue profile"; IsDraft false -> no banner at all. */}
          {p.isDraft && (
            <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)] text-sm border border-[var(--color-on-warning-container)]/20">
              <span className="flex items-center gap-2">
                <FileEdit className="w-4 h-4 shrink-0" aria-hidden="true" />
                {p.servicesStartedAt && p.isActive
                  ? 'Services have started, and onboarding is still open. They can be rostered and supported; the checklist shows what is left before they are made active.'
                  : p.intakeCompletedAt
                  ? "Intake is complete, but this participant's profile isn't finished yet. Excluded from rosters, claims, and other operational lists until finalised."
                  : "This participant is a draft — intake hasn't been completed yet. Excluded from rosters, claims, and other operational lists until finalised."}
              </span>
              {p.servicesStartedAt && p.isActive ? (
                <Button variant="secondary" size="sm" className="shrink-0" to={`/onboarding/${id}`}>Open checklist</Button>
              ) : canWrite && (
                <Button variant="secondary" size="sm" className="shrink-0" to={p.intakeCompletedAt ? `/participants/${id}/profile` : `/participants/${id}/intake`}>
                  <Pencil className="w-4 h-4" /> {p.intakeCompletedAt ? 'Continue profile' : 'Resume intake'}
                </Button>
              )}
            </div>
          )}
          {canViewAlerts && alertsData && (
            <ParticipantAlertsBanner alerts={alertsData.alerts} onSelectTab={setTab} />
          )}
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'details', label: 'Details', icon: Users },
          { id: 'contacts', label: 'Contacts', icon: Contact2 },
          { id: 'bookings', label: 'Bookings', icon: ClipboardList },
          { id: 'support', label: 'Support Profile', icon: Shield },
          { id: 'medications', label: 'Medications', icon: Pill },
          { id: 'notes', label: 'Notes', icon: StickyNote },
          { id: 'routines', label: 'Routines', icon: ListChecks },
          { id: 'restrictive-practices', label: 'Restrictive Practices', icon: ShieldAlert },
          ...(canAccessClaims ? [{ id: 'claims' as const, label: 'Claims', icon: FileText }] : []),
          ...(canManageFunding ? [{ id: 'funding' as const, label: 'Funding', icon: Wallet }] : []),
          ...(canAccessRostering ? [{ id: 'rostering' as const, label: 'Rostering', icon: CalendarRange }] : []),
          ...(canSeeHistory ? [{ id: 'history' as const, label: 'History' }] : []),
        ]}
        active={tab}
        onChange={setTab}
        ariaLabel="Participant detail sections"
      />

      {/* PDETAIL-01 — the short cards keep the original single-wizard's step-family order among
          themselves (retired by PF-10.7; now split across the Intake/Profile wizards): Identity,
          Address & Living Arrangements, NDIS & Funding, Key Identifiers, [Contacts has its own
          sibling tab, matching CONTACT-01/02/03's own wizard step], Cultural & Consent, [Support
          Needs & Mobility moved to the Support Profile tab under PD-6], Medical, Behaviour &
          Communication, Community Access, Meals & Diet (Daily Living), About Me, Risks & Hazards.
          Density review — the nested-CRUD sections (Consents, Health Conditions, ADLs, Risk
          entries) span the whole row, so they come AFTER every short card: interleaved, a
          full-width section strands the short card beside it in a row-wide void. The short cards
          therefore pack into the auto-fill columns first (align-items:start, no stretched
          siblings) and the full-width sections stack underneath.
          The `min(26rem,100%)` track floor lets the grid collapse to one column on a phone: a bare
          26rem (416px) minimum would overflow a 390px viewport and scroll the page sideways.
          PD-7 — every short card is a `SectionEditPanel`-backed component under
          `pages/participant-detail/`, gated on `canWriteParticipantDetails` (SPEC-03's PD-7):
          see this branch's report for the section → CORE-02 patch-group mapping and how each
          section avoids nulling fields it doesn't render. */}
      {tab === 'details' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))] items-start gap-[var(--section-gap)]">
          {/* PD-6 — the "Support Needs & Mobility" card that used to live after Cultural Background has moved to the
              Support Profile tab (SupportProfileTab.tsx), merged with the `/support-profile`
              sub-resource fields and made editable there. See SPEC-03's PD-6: having the same
              fields editable/displayed in two places would repeat the dual-write-path
              inconsistency discovery already flagged for consents/health/ADL. */}
          {recordedCards.map(c => c.card)}
          {/* VISUAL-1 V2: the cards with nothing recorded fold into one line naming them. Only an editor has empty cards to fold:
              each one returns null without canEdit. */}
          {canWriteParticipantDetails && emptyCards.length > 0 && (
            <NotRecordedFold className="col-span-full" summary={joinList(emptyCards.map(c => c.title))}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))] items-start gap-[var(--section-gap)]">
                {emptyCards.map(c => c.card)}
              </div>
            </NotRecordedFold>
          )}

          {/* ── Full-width sections ── */}
          <Card className="col-span-full">
            <ParticipantConsentsSection participantId={id} />
          </Card>
          {/* INTAKE sub-wave C1 — the structured health-condition grid (research spec §4.6/§5),
              always rendered (unlike the whole-card-conditional cards above): GetForParticipant
              always returns all ten HealthConditionType entries, so there is no genuinely-empty
              state to hide behind a condition — DataTable's own emptyMessage handles a
              still-loading/zero-row edge case instead. A bare wrapper, not a Card: the DataTable
              already draws its own border, and a Card around it made two nested borders. */}
          <div className={`col-span-full ${COMPACT_EMPTY_TABLE}`}>
            <ParticipantHealthConditionsSection participantId={id} />
          </div>
          {/* INTAKE sub-wave C2 — the structured ADL rating grid (research spec §4.9/§5), always
              rendered (unlike the whole-card-conditional cards above): GetForParticipant always
              returns all twenty AdlType entries, so there is no genuinely-empty state to hide
              behind a condition — DataTable's own emptyMessage handles a still-loading/zero-row
              edge case instead. Same convention (and same bare wrapper) as
              ParticipantHealthConditionsSection above. */}
          <div className={`col-span-full ${COMPACT_EMPTY_TABLE}`}>
            <ParticipantAdlAssessmentsSection participantId={id} />
          </div>
          {/* INTAKE-09 — a compact section rather than its own tab; see RiskEntriesSection's
              module doc for the tab-count call. */}
          <Card className="col-span-full">
            <RiskEntriesSection participantId={id} />
          </Card>
        </div>
      )}


      {tab === 'contacts' && (
        <ContactsTab participantId={id} />
      )}

      {tab === 'bookings' && (
        <BookingsTab participantId={id} />
      )}

      {tab === 'support' && (
        <SupportProfileTab participantId={id} onNavigateToTab={setTab} />
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

      {tab === 'claims' && canAccessClaims && (
        <ClaimsTab participantId={id!} canWrite={canWrite} />
      )}

      {tab === 'funding' && canManageFunding && (
        <FundingTab participantId={id!} planType={p.planType} />
      )}

      {tab === 'rostering' && canAccessRostering && (
        <RosteringTab participantId={id!} />
      )}

      {tab === 'history' && canSeeHistory && p && (
        <AuditHistoryTab entityType="Participant" entityId={String(p.id)} />
      )}
    </div>
  )
}

/**
 * Dropdown option rows are `py-1.5` around a 20px line = 32px, and take no height prop. The row is a
 * flex box that sizes to its tallest child, so each item's icon slot carries a coarse-pointer floor:
 * (--tap-min - the row's 12px of vertical padding) of content lifts the row to 44px under a touch
 * pointer. --tap-min is 0 on a mouse, so calc() goes negative, min-height clamps to 0 and the 32px
 * row is untouched.
 */
const MENU_ITEM_ICON = 'flex min-h-[calc(var(--tap-min)-12px)] items-center'

/** The slice of a react-query mutation DocumentsMenu drives — a PDF download. */
type PdfDownload = {
  mutate: (variables: { id: string; fileName: string }) => void
  isPending: boolean
  isError: boolean
}

/**
 * The header's one menu, at every width (VISUAL-1 V2: seven header controls at 1440 became one menu and Edit). A secondary-look
 * trigger, so Edit stays the page's one filled primary. It holds the three PDF downloads, "Agreement draft" (same gate as before) and
 * the caregiver-link actions. Each download keeps its file name and pending state; their error lines collapse into one shared
 * `role="alert"` under the trigger, and the caregiver link's own panel (the issued URL, its error, the Revoke confirm) sits there too.
 */
function DocumentsMenu({
  participantId, fullName, canOpenAgreementDraft, intake, profile, overview, caregiverLink,
}: {
  participantId: string
  fullName: string
  canOpenAgreementDraft: boolean
  intake: PdfDownload
  profile: PdfDownload
  overview: PdfDownload
  caregiverLink: CaregiverLink
}) {
  const navigate = useNavigate()
  const downloads = [
    { value: 'intake', label: 'Intake Form PDF', fileName: `${fullName} - Intake Form.pdf`, mutation: intake },
    { value: 'profile', label: 'Participant Profile PDF', fileName: `${fullName} - Participant Profile.pdf`, mutation: profile },
    { value: 'overview', label: 'Client Overview PDF', fileName: `${fullName} - Client Overview.pdf`, mutation: overview },
  ]
  const busy = downloads.some(d => d.mutation.isPending)
  const failed = downloads.some(d => d.mutation.isError)

  const items: DropdownItem[] = [
    ...downloads.map(d => ({
      value: d.value,
      label: d.label,
      icon: <span className={MENU_ITEM_ICON}><Download className="w-4 h-4" /></span>,
      disabled: d.mutation.isPending,
    })),
    ...(canOpenAgreementDraft ? [{ value: 'agreement', label: 'Agreement draft', icon: <span className={MENU_ITEM_ICON}><FileText className="w-4 h-4" /></span> }] : []),
    ...caregiverLink.items,
  ]

  const onSelect = (value: string) => {
    const download = downloads.find(d => d.value === value)
    if (download) {
      download.mutation.mutate({ id: participantId, fileName: download.fileName })
      return
    }
    if (value === 'agreement') navigate(`/participants/${participantId}/agreement-draft`)
    else caregiverLink.onSelect(value)
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Dropdown
        variant="menu"
        triggerVariant="secondary"
        label={busy ? 'Preparing…' : 'Documents'}
        icon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        items={items}
        onSelect={onSelect}
      />
      {failed && (
        <p role="alert" className="text-xs text-[var(--color-destructive)]">
          Couldn't download the file. Try again, or contact support if this keeps happening.
        </p>
      )}
      {caregiverLink.panel}
    </div>
  )
}

type CaregiverLink = { items: DropdownItem[]; onSelect: (value: string) => void; panel: ReactNode }

/**
 * cg04 Task 9 (design §5) — Generate/Regenerate/Revoke for this participant's caregiver form link, as items of the header's menu.
 * Gated on canWriteParticipantDetails, per B14 in the discovery fact sheet (never canWrite — this is a write action on a sensitive,
 * unauthenticated-facing link, not a general edit permission): without it there are no items and no panel. `ParticipantDetailDto`
 * does not carry the active submission status itself, so the "active link" state is derived from two small Draft/Submitted queries
 * filtered by participantId (per the plan) rather than widening the participant DTO; the Regenerate item names it.
 *
 * The freshly generated URL is held in local component state only — it is shown once, with a Copy button, and is never persisted
 * anywhere the UI could recover it after navigating away (not in the query cache, not on the participant DTO): re-mounting the page
 * loses it for good, exactly like the raw token itself is never re-derivable from the backend after issue.
 */
function useCaregiverLink(participantId: string): CaregiverLink {
  const { canWriteParticipantDetails } = usePermissions()
  const navigate = useNavigate()
  const generate = useGenerateCaregiverLink()
  const revoke = useRevokeCaregiverLink()
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(null)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  // The latest refusal, Generate's or Revoke's: each attempt clears it, so an older failure never stands in for a newer one.
  const [linkError, setLinkError] = useState<string | null>(null)
  // The list route is Admin/Coordinator/SuperAdmin only: other roles would get a 403 for each call.
  const drafts = useCaregiverSubmissions('Draft', { participantId, enabled: canWriteParticipantDetails })
  const submitted = useCaregiverSubmissions('Submitted', { participantId, enabled: canWriteParticipantDetails })

  if (!canWriteParticipantDetails) return { items: [], onSelect: () => {}, panel: null }

  const active = [...(submitted.data ?? []), ...(drafts.data ?? [])].find((s) => s.participantId === participantId)
  const toReview = submitted.data?.find((s) => s.participantId === participantId)

  const items: DropdownItem[] = [
    // A submitted form waits for review; this is its one door from the participant (the list is the other).
    ...(toReview ? [{ value: 'caregiver-review', label: 'Review caregiver form', icon: <span className={MENU_ITEM_ICON}><ClipboardCheck className="w-4 h-4" /></span> }] : []),
    {
      value: 'caregiver-generate',
      label: active ? 'Regenerate caregiver link' : 'Generate caregiver link',
      description: active ? `Current link: ${active.status.toLowerCase()}` : undefined,
      icon: <span className={MENU_ITEM_ICON}>{generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}</span>,
      disabled: generate.isPending,
    },
    ...(active ? [{ value: 'caregiver-revoke', label: 'Revoke caregiver link', icon: <span className={MENU_ITEM_ICON}><Link2Off className="w-4 h-4" /></span>, disabled: revoke.isPending }] : []),
  ]

  const generateLink = async () => {
    setLinkError(null)
    const res = await generate.mutateAsync({ participantId }).catch((err: unknown) => { setLinkError(extractErrorMessage(err, 'Something went wrong. Try again.')); return null })
    if (!res) return
    setIssued({ url: `${window.location.origin}/caregiver/${res.data!.token}`, expiresAt: res.data!.expiresAt })
  }
  const onSelect = (value: string) => {
    if (value === 'caregiver-review' && toReview) navigate(`/caregiver-submissions/${toReview.id}`)
    else if (value === 'caregiver-revoke') setConfirmingRevoke(true)
    else if (value === 'caregiver-generate') void generateLink()
  }

  const panel = (
    <div data-testid="caregiver-link-control" className="contents">
      {issued && (
        <div role="status" className="text-xs p-2 rounded bg-[var(--color-accent)] break-all">
          <span>Copy this link now — it won't be shown again. Expires {formatDateAu(issued.expiresAt)}.</span>
          <code className="block mt-1">{issued.url}</code>
          <button type="button" className="mt-1 underline" onClick={() => { void copyText(issued.url) }}>
            Copy
          </button>
        </div>
      )}
      {linkError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{linkError}</p>}
      <ConfirmDialog
        open={confirmingRevoke}
        onCancel={() => setConfirmingRevoke(false)}
        onConfirm={async () => {
          // A refusal closes the dialog too, so the message above is not left behind it.
          setLinkError(null)
          await revoke.mutateAsync({ participantId }).catch((err: unknown) => setLinkError(extractErrorMessage(err, 'Something went wrong. Try again.')))
          setConfirmingRevoke(false)
        }}
        title="Revoke caregiver link?"
        message="The caregiver will no longer be able to access or submit this link. This can't be undone."
        confirmLabel="Revoke"
        variant="danger"
        loading={revoke.isPending}
      />
    </div>
  )

  return { items, onSelect, panel }
}
