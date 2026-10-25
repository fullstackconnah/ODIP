import { useParams, useNavigate } from 'react-router-dom'
import {
  useParticipant, useParticipantAlerts, useDownloadIntakeFormPdf, useDownloadParticipantProfilePdf, useDownloadClientOverviewPdf,
  useGenerateCaregiverLink, useRevokeCaregiverLink, useCaregiverSubmissions, useDeleteParticipant, useRestoreParticipant,
} from '@/api/hooks'
import { PLAN_TYPE_LABELS, SUPPORT_RATIO_LABELS } from '@/api/types/enums'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { Tabs } from '@/components/Tabs'
import { StatusBadge } from '@/components/StatusBadge'
import { ReadinessNote } from '@/components/ReadinessNote'
import { ServiceStreamBadges } from '@/components/ServiceStreamBadges'
import { parseServiceStreams } from '@/api/types/participants'
import { ParticipantAlertsBanner } from '@/components/ParticipantAlertsBanner'
import { PageHeader, PageHeaderMeta } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { BackButton } from '@/components/BackButton'
import { useTabParam } from '@/hooks/useTabParam'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { PageState } from '@/components/PageState'
import { isNotFoundError } from '@/lib/httpStatus'
import { FileEdit, Pencil, Download, Loader2, Link2, Link2Off, FileText, ClipboardCheck } from 'lucide-react'
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
import { ParticipantSafetyFlags } from './participant-detail/ParticipantSafetyFlags'
import { BeforeYouStartCard } from './participant-detail/BeforeYouStartCard'
import { ParticipantMoreMenu } from './participant-detail/ParticipantMoreMenu'
import { useParticipantTabCounts } from './participant-detail/useParticipantTabCounts'
import {
  NEW_TABS, PARTICIPANT_TAB_KEYS, useParticipantTabRedirect, useParticipantGoTo, useScrollToHash, type ParticipantTabKey,
} from './participant-detail/participantTabs'
import { joinList, plural, formatRelative } from '@/lib/format'
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

/**
 * The cards pack into auto-fill columns (align-items:start, so no stretched siblings); the `min(26rem,100%)` track floor lets the grid
 * collapse to one column on a phone, where a bare 26rem (416px) minimum would overflow a 390px viewport and scroll the page sideways.
 */
const CARD_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))] items-start gap-[var(--section-gap)]'

/**
 * One anchored section of a tab. `id` is the deep-link target (`#medical`), so it is the contract with the flag chips, the alerts and the
 * old `?tab=` keys. A component with no heading of its own gets a screen-reader-only one, which is also where focus lands after a jump.
 */
function Section({ id, label, srHeading, wide, children }: { id: string; label: string; srHeading?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-label={label} className={`scroll-mt-12 ${wide ? 'col-span-full' : ''}`}>
      {srHeading && <h3 className="sr-only">{label}</h3>}
      {children}
    </section>
  )
}

type ShortCard = { id: string; title: string; has: boolean; node: ReactNode }

/** The cards with something recorded, then (for an editor) the empty ones folded into one line. Only an editor has empty cards to fold: each one returns null without canEdit. */
function ShortCards({ cards, canEdit }: { cards: ShortCard[]; canEdit: boolean }) {
  const empty = cards.filter(c => !c.has)
  return (
    <>
      {cards.filter(c => c.has).map(c => c.node)}
      {canEdit && empty.length > 0 && (
        <NotRecordedFold className="col-span-full" summary={joinList(empty.map(c => c.title))}>
          <div className={CARD_GRID}>{empty.map(c => c.node)}</div>
        </NotRecordedFold>
      )}
    </>
  )
}

export default function ParticipantDetailPage() {
  const { canWrite, canViewAlerts, canWriteParticipantDetails, canManageFunding, canManageParticipantLifecycle, canAccessPage, isAdmin, isSuperAdmin } = usePermissions()
  const { id } = useParams()
  const canAccessClaims = canAccessPage('claims')
  // The agreement draft carries money: only the roles the API admits to its GETs are offered it (ReadOnly would only meet a 403).
  const canOpenAgreementDraft = canAccessPage('agreement-drafts')
  // Connection map item 12 — the Rostering section, same canAccessPage gate RosterBoardPage itself
  // uses (see lib/permissions.ts's SUPPORT_WORKER_PAGES — SupportWorker is excluded).
  const canAccessRostering = canAccessPage('rostering')
  const canSeeHistory = isSuperAdmin || isAdmin
  // Only the tabs this role can see are valid ?tab= keys: a link to Funding opened by a role without it reads as Overview, instead of selecting nothing
  // over an empty body. Funding is money (a participant's plan budget, the claims), so it has its own gates and never `canWrite`.
  const showFunding = canManageFunding || canAccessClaims
  const tabKeys = useMemo(
    () => PARTICIPANT_TAB_KEYS.filter(key => key !== 'funding' || showFunding),
    [showFunding],
  )
  const [tab, setTab] = useTabParam(tabKeys, 'overview')
  const goTo = useParticipantGoTo(tabKeys)
  useParticipantTabRedirect(tabKeys)
  useScrollToHash(id)
  const counts = useParticipantTabCounts(id)
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
  // The same confirm dialog and failure banner the participant list uses; the More menu opens it without a row button.
  const archiveRestore = useArchiveRestore<{ id: string; fullName: string }>({
    deleteMutation: useDeleteParticipant(),
    restoreMutation: useRestoreParticipant(),
    // Restore reactivates and changes nothing else, so the endpoint takes an empty body.
    restoreData: () => ({}),
    entityName: row => row.fullName,
    entityId: row => row.id,
  })

  if (isLoading && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="participant" />
  if (!p) {
    return (isError || retryingAfterError(pageQuery)) && !isNotFoundError(error)
      ? <PageState kind="error" noun="participant" onRetry={() => refetch()} />
      : <PageState kind="not-found" noun="participant" backTo="/participants" backLabel="participants" />
  }

  const edit = { p, participantId: id!, canEdit: canWriteParticipantDetails }
  // The short cards in wizard order within each tab. `has` is false for a card with nothing recorded yet (Identity and NDIS & Funding always have
  // something: a name and a funding source).
  const card = (cid: string, title: string, has: boolean, node: ReactNode): ShortCard => ({
    id: cid, title, has, node: <Section key={cid} id={cid} label={title}>{node}</Section>,
  })
  const aboutCards = [
    card('identity', 'Identity', true, <ParticipantIdentitySection {...edit} />),
    card('home-and-living', 'Address & Living Arrangements', hasAddressLiving(p), <ParticipantAddressLivingSection {...edit} />),
    card('ndis-plan', 'NDIS & Funding', true, <ParticipantNdisFundingSection {...edit} />),
    card('key-identifiers', 'Key Identifiers', hasKeyIdentifiers(p), <ParticipantKeyIdentifiersSection {...edit} />),
    card('culture-and-rights', 'Cultural Background', hasCulturalBackground(p), <ParticipantCulturalBackgroundSection {...edit} />),
    card('about-me', 'About Me', hasAboutMe(p), <ParticipantAboutMeSection {...edit} />),
  ]
  // Community Access returns null without its service stream, so it gets no wrapper and no grid cell at all.
  const hasCommunityAccess = parseServiceStreams(p.serviceStreams).includes('CommunityAccessDailyLiving')
  const risksSummary = card('risks-summary', 'Risks & Hazards Summary', hasRisksHazardsSummary(p), <ParticipantRisksHazardsSummarySection {...edit} />)
  const healthCards = [
    card('medical', 'Medical', hasMedical(p), <ParticipantMedicalSection {...edit} />),
    card('behaviour-and-communication', 'Behaviour & Communication', hasBehaviourCommunication(p), <ParticipantBehaviourCommunicationSection {...edit} />),
    ...(hasCommunityAccess ? [card('community-access', 'Community Access', true, <ParticipantCommunityAccessSection {...edit} />)] : []),
  ]
  const dailyCards = [card('meals', 'Meals & Diet', hasMealsDiet(p), <ParticipantMealsDietSection {...edit} />)]
  // Back goes where the user came from; with no history (a deep link) it falls back to the list this participant is on. A draft is never on
  // Active participants: before intake is complete it is a Draft intake row on Enquiries, after it a row on Onboarding.
  const [backTo, backLabel] = !p.isDraft ? ['/participants', 'participants']
    : p.intakeCompletedAt ? ['/participants?tab=onboarding', 'onboarding'] : ['/participants?tab=enquiries', 'enquiries']
  const otherAlerts = canViewAlerts && (alertsData?.alerts ?? []).some(a => a.severity !== 'Critical')

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <div className="flex items-start gap-2">
        {/* The icon variant is a --control-h-sm square (36px on a coarse pointer); its --tap-min floor lifts it to
            44 there and is 0 — no change — on a mouse. */}
        <BackButton to={backTo} label={backLabel} variant="icon" className="mt-1" />
        <div className="flex-1 min-w-0">
          <PageHeader
            variant="detail"
            title={p.fullName}
            subtitle={
              <PageHeaderMeta>
                <StatusBadge status={p.isActive ? 'Active' : 'Inactive'} />
                {/* What is still missing, as a quiet warning-tone chip beside the status. Informational: nothing on this page is gated on it. */}
                {p.readinessIssues?.length ? <ReadinessNote issues={p.readinessIssues} variant="chip" /> : null}
                <span>{p.region || 'No region'}</span>
                <span>{PLAN_TYPE_LABELS[p.planType] ?? p.planType}</span>
                <span>Ratio {SUPPORT_RATIO_LABELS[p.supportRatio] ?? p.supportRatio}</span>
                <span>Updated <time dateTime={p.updatedAt}>{formatRelative(p.updatedAt, { style: 'long' })}</time></span>
                {parseServiceStreams(p.serviceStreams).length > 0 ? <ServiceStreamBadges value={p.serviceStreams} /> : null}
              </PageHeaderMeta>
            }
            action={
              // The documents menu and the More menu: no filled primary here, the page's actions are all in menus. justify-start below md
              // (the cluster sits under the title); justify-end from md up.
              <div className="flex flex-wrap items-start justify-start gap-2 md:justify-end">
                {/* DOC-01 — the downloads are ungated: downloading/printing documents is a read action, and this page has no
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
                <ParticipantMoreMenu
                  participantId={id!}
                  canEditProfile={canWrite}
                  canArchive={canManageParticipantLifecycle && p.isActive}
                  canRestore={canManageParticipantLifecycle && !p.isActive && !p.isDraft}
                  onArchive={() => archiveRestore.requestArchive(p)}
                  onRestore={() => archiveRestore.requestRestore(p)}
                />
              </div>
            }
          >
            <ParticipantSafetyFlags participant={p} />
          </PageHeader>
        </div>
      </div>

      {archiveRestore.errorNotice}
      {/* Every critical alert, on every tab and with no cap: a worker who deep-links to any tab still sees it. The rest are on Overview. */}
      {canViewAlerts && alertsData && (
        <ParticipantAlertsBanner severity="critical" alerts={alertsData.alerts} onSelectTab={goTo} />
      )}

      <Tabs
        overflow="scroll"
        tabs={NEW_TABS.filter(t => tabKeys.includes(t.id)).map(t => {
          const n = t.id === 'health' ? counts.health : t.id === 'daily' ? counts.daily : t.id === 'people' ? counts.people : t.id === 'records' ? counts.records : undefined
          return {
            id: t.id,
            label: <>{t.label}{n && t.noun ? <span className="sr-only">, {plural(n, t.noun[0], t.noun[1])}</span> : null}</>,
            badge: n,
          }
        })}
        active={tab}
        onChange={setTab}
        ariaLabel="Participant sections"
      />

      <TabPanel tab={tab} id="overview">
        <div className="flex flex-col gap-[var(--section-gap)]">
          {/* SPEC-05 PF-10.5 — three-way resume-banner state, derived from IntakeCompletedAt/IsDraft:
              no IntakeCompletedAt -> "Resume intake" (fresh Intake start, pre-filled from this row);
              IntakeCompletedAt set + IsDraft -> "Continue profile"; IsDraft false -> no banner at all. */}
          {p.isDraft && (
            <section id="onboarding" aria-label="Onboarding" className="scroll-mt-12">
              <div role="status" className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)] text-sm border border-[var(--color-on-warning-container)]/20">
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
            </section>
          )}
          {otherAlerts && alertsData && (
            <section id="alerts" aria-label="Alerts" className="scroll-mt-12">
              <ParticipantAlertsBanner severity="other" alerts={alertsData.alerts} onSelectTab={goTo} />
            </section>
          )}
          <BeforeYouStartCard participant={p} />
        </div>
      </TabPanel>

      <TabPanel tab={tab} id="about">
        <div className={CARD_GRID}>
          <ShortCards cards={aboutCards} canEdit={canWriteParticipantDetails} />
        </div>
      </TabPanel>

      <TabPanel tab={tab} id="health">
        <div className={CARD_GRID}>
          <ShortCards cards={healthCards.slice(0, 1)} canEdit={canWriteParticipantDetails} />
          {/* INTAKE sub-wave C1 — the structured health-condition grid, always rendered: GetForParticipant always returns all ten
              HealthConditionType entries, so there is no genuinely-empty state to hide behind a condition. A bare wrapper, not a Card:
              the DataTable already draws its own border. */}
          <Section id="health-conditions" label="Health conditions" wide>
            <div className={COMPACT_EMPTY_TABLE}><ParticipantHealthConditionsSection participantId={id} /></div>
          </Section>
          <Section id="medications" label="Medications" srHeading wide><MedicationsTab participantId={id} /></Section>
          <ShortCards cards={healthCards.slice(1)} canEdit={canWriteParticipantDetails} />
          {/* INTAKE-09 — the risk entries are a compact section rather than their own tab; the summary card shares the section's inner grid. */}
          <Section id="risks" label="Risks and hazards" wide>
            <div className={CARD_GRID}>
              {risksSummary.has && risksSummary.node}
              <Card className="col-span-full"><RiskEntriesSection participantId={id} /></Card>
              {canWriteParticipantDetails && !risksSummary.has && (
                <NotRecordedFold className="col-span-full" summary={risksSummary.title}>
                  <div className={CARD_GRID}>{risksSummary.node}</div>
                </NotRecordedFold>
              )}
            </div>
          </Section>
          <Section id="restrictive-practices" label="Restrictive practices" srHeading wide><RestrictivePracticesTab participantId={id} /></Section>
        </div>
      </TabPanel>

      <TabPanel tab={tab} id="daily">
        <div className={CARD_GRID}>
          <Section id="support-profile" label="Support profile" srHeading wide><SupportProfileTab participantId={id} onNavigateToTab={goTo} /></Section>
          {/* INTAKE sub-wave C2 — the structured ADL rating grid, always rendered (GetForParticipant always returns all twenty AdlType entries). */}
          <Section id="daily-living" label="Daily living" wide>
            <div className={COMPACT_EMPTY_TABLE}><ParticipantAdlAssessmentsSection participantId={id} /></div>
          </Section>
          <Section id="routines" label="Routines" srHeading wide><RoutinesTab participantId={id} /></Section>
          <ShortCards cards={dailyCards} canEdit={canWriteParticipantDetails} />
        </div>
      </TabPanel>

      <TabPanel tab={tab} id="people">
        <div className={CARD_GRID}>
          <Section id="contacts" label="Contacts" srHeading wide><ContactsTab participantId={id} /></Section>
          {canAccessRostering && <Section id="roster" label="Rostering" srHeading wide><RosteringTab participantId={id!} /></Section>}
          <Section id="trips" label="Bookings" srHeading wide><BookingsTab participantId={id} /></Section>
        </div>
      </TabPanel>

      <TabPanel tab={tab} id="funding">
        <div className={CARD_GRID}>
          {canManageFunding && <Section id="plan-budget" label="Plan budget" srHeading wide><FundingTab participantId={id!} planType={p.planType} /></Section>}
          {canAccessClaims && <Section id="claims" label="Claims" srHeading wide><ClaimsTab participantId={id!} canWrite={canWrite} /></Section>}
        </div>
      </TabPanel>

      <TabPanel tab={tab} id="records">
        <div className={CARD_GRID}>
          <Section id="notes" label="Notes" srHeading wide><NotesTab participantId={id} /></Section>
          <Section id="consents" label="Consents" wide>
            <Card><ParticipantConsentsSection participantId={id} /></Card>
          </Section>
          {canSeeHistory && (
            <Section id="history" label="History" srHeading wide><AuditHistoryTab entityType="Participant" entityId={String(p.id)} /></Section>
          )}
        </div>
      </TabPanel>

      {archiveRestore.confirmDialog}
    </div>
  )
}

/** A tab's panel: only the active one is mounted, so the other tabs make no requests until opened. */
function TabPanel({ tab, id, children }: { tab: ParticipantTabKey; id: ParticipantTabKey; children: ReactNode }) {
  return tab === id ? <>{children}</> : null
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
