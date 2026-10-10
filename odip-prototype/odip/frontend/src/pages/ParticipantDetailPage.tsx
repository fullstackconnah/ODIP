import { useParams, useNavigate, Link } from 'react-router-dom'
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
import { Users, Shield, ClipboardList, Pencil, Pill, StickyNote, ListChecks, ShieldAlert, FileEdit, Contact2, Download, Loader2, Link2, FileText, CalendarRange, Wallet } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import AuditHistoryTab from '@/components/AuditHistoryTab'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu } from '@/lib/utils'
import { copyText } from '@/lib/clipboard'
import {
  MedicationsTab, NotesTab, RoutinesTab, RestrictivePracticesTab, RiskEntriesSection, ParticipantConsentsSection,
  ParticipantHealthConditionsSection, ParticipantAdlAssessmentsSection, ContactsTab, SupportProfileTab, ClaimsTab,
  RosteringTab, FundingTab, BookingsTab,
  ParticipantIdentitySection, ParticipantAddressLivingSection, ParticipantNdisFundingSection, ParticipantKeyIdentifiersSection,
  ParticipantCulturalBackgroundSection, ParticipantMedicalSection, ParticipantBehaviourCommunicationSection,
  ParticipantCommunityAccessSection, ParticipantMealsDietSection, ParticipantAboutMeSection, ParticipantRisksHazardsSummarySection,
} from './participant-detail'
import { Card } from '@/components/Card'
import { ConfirmDialog } from '@/components/ConfirmDialog'

/** Tailwind's `md` breakpoint, in the same rem unit its `md:` variants compile to (48rem = 768px at the
 * default font size), so this switch and the header's `md:` classes always flip together. The header
 * shows the full Documents button set from here up and folds it into one menu below (see DocumentsMenu). */
const MD_QUERY = '(min-width: 48rem)'

function subscribeMdUp(notify: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(MD_QUERY)
  mql.addEventListener('change', notify)
  return () => mql.removeEventListener('change', notify)
}

/** Where matchMedia doesn't exist (jsdom) assume a wide viewport, i.e. the full button set. */
function getMdUp(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MD_QUERY).matches
    : true
}

/** Deliberately a JS switch and not `hidden md:flex` twins: the desktop buttons and the mobile menu
 * both own download state and a `role="alert"` error line, and rendering both would duplicate them. */
function useIsMdUp(): boolean {
  return useSyncExternalStore(subscribeMdUp, getMdUp, () => true)
}

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
  const isMdUp = useIsMdUp()
  const canAccessClaims = canAccessPage('claims')
  // The agreement draft carries money: only the roles the API admits to its GETs are offered it (ReadOnly satisfies canWrite, and would only meet a 403).
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
  const { data: p, isLoading, isError, error, refetch } = useParticipant(id)
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

  if (isLoading) return <PageState kind="loading" noun="participant" />
  if (!p) {
    return isError && !isNotFoundError(error)
      ? <PageState kind="error" noun="participant" onRetry={() => refetch()} />
      : <PageState kind="not-found" noun="participant" backTo="/participants" backLabel="participants" />
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <div className="flex items-start gap-2">
        {/* The icon variant is a --control-h-sm square (36px on a coarse pointer); its --tap-min floor lifts it to
            44 there and is 0 — no change — on a mouse. */}
        <BackButton to="/participants" label="participants" variant="icon" history={false} className="mt-1" />
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
              // justify-start below md (the cluster sits under the title, left-aligned); justify-end
              // from md up, unchanged.
              <div className="flex flex-wrap items-start justify-start gap-2 md:justify-end">
                {isMdUp ? (
                  <>
                    {/* DOC-01 — secondary Documents actions; ungated, unlike the primary Edit action below:
                        downloading/printing documents is a read action, and this page has no more specific
                        canView... flag of its own to gate read-level content on (see usePermissions — the
                        closest candidates, canViewAlerts/canViewAdministrationReport, are for unrelated
                        features), so these follow the rest of the page's ungated read-only content. */}
                    <div className="flex flex-col items-start gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        onClick={() => downloadIntakeForm.mutate({ id: id!, fileName: `${p.fullName} - Intake Form.pdf` })}
                        disabled={downloadIntakeForm.isPending}
                      >
                        {downloadIntakeForm.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {downloadIntakeForm.isPending ? 'Preparing…' : 'Intake Form PDF'}
                      </Button>
                      {downloadIntakeForm.isError && (
                        <p role="alert" className="text-xs text-[var(--color-destructive)]">
                          Couldn't download the file. Try again, or contact support if this keeps happening.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-start gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        onClick={() => downloadParticipantProfile.mutate({ id: id!, fileName: `${p.fullName} - Participant Profile.pdf` })}
                        disabled={downloadParticipantProfile.isPending}
                      >
                        {downloadParticipantProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {downloadParticipantProfile.isPending ? 'Preparing…' : 'Participant Profile PDF'}
                      </Button>
                      {downloadParticipantProfile.isError && (
                        <p role="alert" className="text-xs text-[var(--color-destructive)]">
                          Couldn't download the file. Try again, or contact support if this keeps happening.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-start gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        onClick={() => downloadClientOverview.mutate({ id: id!, fileName: `${p.fullName} - Client Overview.pdf` })}
                        disabled={downloadClientOverview.isPending}
                      >
                        {downloadClientOverview.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {downloadClientOverview.isPending ? 'Preparing…' : 'Client Overview PDF'}
                      </Button>
                      {downloadClientOverview.isError && (
                        <p role="alert" className="text-xs text-[var(--color-destructive)]">
                          Couldn't download the file. Try again, or contact support if this keeps happening.
                        </p>
                      )}
                    </div>
                    {canOpenAgreementDraft && (
                      <Button to={`/participants/${id}/agreement-draft`} variant="secondary" size="md">
                        <FileText className="w-4 h-4" /> Agreement draft
                      </Button>
                    )}
                  </>
                ) : (
                  // Below md: five stacked 44px rows would bury the name, so the three PDFs and
                  // "Agreement draft" fold into one Documents menu. Edit stays a visible button.
                  <DocumentsMenu
                    participantId={id!}
                    fullName={p.fullName}
                    canOpenAgreementDraft={canOpenAgreementDraft}
                    intake={downloadIntakeForm}
                    profile={downloadParticipantProfile}
                    overview={downloadClientOverview}
                  />
                )}
                {/* cg04 Task 9 (design §5) — the caregiver-link header control. Gated on
                    canWriteParticipantDetails (a write action), unlike the ungated Documents
                    downloads above — see B15 in the discovery fact sheet. */}
                <CaregiverLinkControl participantId={id!} />
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
                {p.intakeCompletedAt
                  ? "Intake is complete, but this participant's profile isn't finished yet. Excluded from rosters, claims, and other operational lists until finalised."
                  : "This participant is a draft — intake hasn't been completed yet. Excluded from rosters, claims, and other operational lists until finalised."}
              </span>
              {canWrite && (
                <Link
                  to={p.intakeCompletedAt ? `/participants/${id}/profile` : `/participants/${id}/intake`}
                  className="inline-flex items-center gap-1.5 h-[var(--control-h)] px-3 rounded-[var(--radius-sm)] bg-[var(--color-on-warning-container)] text-white text-sm font-medium hover:bg-[var(--color-on-warning-container)]/90 transition-colors shrink-0"
                >
                  <Pencil className="w-4 h-4" /> {p.intakeCompletedAt ? 'Continue profile' : 'Resume intake'}
                </Link>
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
          <ParticipantIdentitySection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantAddressLivingSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantNdisFundingSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantKeyIdentifiersSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantCulturalBackgroundSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          {/* PD-6 — the "Support Needs & Mobility" card that used to live here has moved to the
              Support Profile tab (SupportProfileTab.tsx), merged with the `/support-profile`
              sub-resource fields and made editable there. See SPEC-03's PD-6: having the same
              fields editable/displayed in two places would repeat the dual-write-path
              inconsistency discovery already flagged for consents/health/ADL. */}
          <ParticipantMedicalSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantBehaviourCommunicationSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantCommunityAccessSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantMealsDietSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantAboutMeSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantRisksHazardsSummarySection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />

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
 * The shared Dropdown "menu" trigger is a primary-CTA pill (gradient fill, rounded-full, bold, 40px
 * tall). In this header Edit is the primary action, so the trigger is restyled from out here to read
 * as a secondary Button: --control-h tall (32px, 44px under a coarse pointer, the same token Button
 * md uses), radius-sm, bordered card fill. Dropdown takes no className/appearance prop, so this is a
 * descendant-selector skin scoped to the one trigger button its wrapper contains (the option panel is
 * portalled to <body> and unaffected).
 */
const DOCUMENTS_TRIGGER_SKIN = [
  '[&_button]:h-[var(--control-h)]', '[&_button]:px-4', '[&_button]:py-0',
  '[&_button]:rounded-[var(--radius-sm)]', '[&_button]:border', '[&_button]:border-[var(--color-border)]',
  '[&_button]:bg-none', '[&_button]:bg-[var(--color-card)]', '[&_button:hover]:bg-[var(--color-accent)]',
  '[&_button]:font-medium', '[&_button]:text-[var(--color-foreground)]', '[&_button]:shadow-none',
].join(' ')

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
 * The header's document actions below md, folded into one menu (the shared Dropdown "menu" variant,
 * as ItineraryTab's export uses): the three PDF downloads plus "Agreement draft" (canWrite only, same
 * gate as the desktop button). Each download keeps its desktop file name and pending state; the
 * per-button error lines collapse into one shared `role="alert"` under the trigger.
 */
function DocumentsMenu({
  participantId, fullName, canOpenAgreementDraft, intake, profile, overview,
}: {
  participantId: string
  fullName: string
  canOpenAgreementDraft: boolean
  intake: PdfDownload
  profile: PdfDownload
  overview: PdfDownload
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
  ]

  const onSelect = (value: string) => {
    const download = downloads.find(d => d.value === value)
    if (download) {
      download.mutation.mutate({ id: participantId, fileName: download.fileName })
      return
    }
    if (value === 'agreement') navigate(`/participants/${participantId}/agreement-draft`)
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className={DOCUMENTS_TRIGGER_SKIN}>
        <Dropdown
          variant="menu"
          align="left"
          label={busy ? 'Preparing…' : 'Documents'}
          icon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          items={items}
          onSelect={onSelect}
        />
      </div>
      {failed && (
        <p role="alert" className="text-xs text-[var(--color-destructive)]">
          Couldn't download the file. Try again, or contact support if this keeps happening.
        </p>
      )}
    </div>
  )
}

/**
 * cg04 Task 9 (design §5) — status chip + Generate/Regenerate/Revoke for this participant's
 * caregiver form link. Gated on canWriteParticipantDetails, per B14 in the discovery fact
 * sheet (never canWrite — this is a write action on a sensitive, unauthenticated-facing link,
 * not a general edit permission). `ParticipantDetailDto` does not carry the active submission
 * status itself, so the "active link" state is derived from two small Draft/Submitted queries
 * filtered by participantId (per the plan) rather than widening the participant DTO.
 *
 * The freshly generated URL is held in local component state only — it is shown once, with a
 * Copy button, and is never persisted anywhere the UI could recover it after navigating away
 * (not in the query cache, not on the participant DTO): re-mounting this control loses it for
 * good, exactly like the raw token itself is never re-derivable from the backend after issue.
 */
function CaregiverLinkControl({ participantId }: { participantId: string }) {
  const { canWriteParticipantDetails } = usePermissions()
  const generate = useGenerateCaregiverLink()
  const revoke = useRevokeCaregiverLink()
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(null)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const drafts = useCaregiverSubmissions('Draft')
  const submitted = useCaregiverSubmissions('Submitted')

  if (!canWriteParticipantDetails) return null

  const active = [...(submitted.data ?? []), ...(drafts.data ?? [])].find((s) => s.participantId === participantId)

  return (
    <div data-testid="caregiver-link-control" className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={active?.status ?? 'None'} />
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={async () => {
            const res = await generate.mutateAsync({ participantId })
            const token = res.data!.token
            setIssued({ url: `${window.location.origin}/caregiver/${token}`, expiresAt: res.data!.expiresAt })
          }}
          disabled={generate.isPending}
        >
          {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          {active ? 'Regenerate caregiver link' : 'Generate caregiver link'}
        </Button>
        {active && (
          <Button type="button" variant="ghost-danger" size="md" onClick={() => setConfirmingRevoke(true)} disabled={revoke.isPending}>
            Revoke
          </Button>
        )}
      </div>
      {issued && (
        <div role="status" className="text-xs p-2 rounded bg-[var(--color-accent)] break-all">
          <span>Copy this link now — it won't be shown again. Expires {formatDateAu(issued.expiresAt)}.</span>
          <code className="block mt-1">{issued.url}</code>
          <button type="button" className="mt-1 underline" onClick={() => { void copyText(issued.url) }}>
            Copy
          </button>
        </div>
      )}
      {(generate.isError || revoke.isError) && (
        <p role="alert" className="text-xs text-[var(--color-destructive)]">Something went wrong. Try again.</p>
      )}
      <ConfirmDialog
        open={confirmingRevoke}
        onCancel={() => setConfirmingRevoke(false)}
        onConfirm={async () => {
          await revoke.mutateAsync({ participantId })
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
}
