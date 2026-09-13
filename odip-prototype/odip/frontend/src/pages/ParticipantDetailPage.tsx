import { useParams, useSearchParams, Link } from 'react-router-dom'
import {
  useParticipant, useParticipantBookings, useParticipantAlerts, useDownloadIntakeFormPdf, useDownloadParticipantProfilePdf, useDownloadClientOverviewPdf,
  useGenerateCaregiverLink, useRevokeCaregiverLink, useCaregiverSubmissions,
} from '@/api/hooks'
import { DataTable } from '@/components/DataTable'
import { TabNav } from '@/components/TabNav'
import { StatusBadge } from '@/components/StatusBadge'
import { ServiceStreamBadges } from '@/components/ServiceStreamBadges'
import { ParticipantAlertsBanner } from '@/components/ParticipantAlertsBanner'
import { ArrowLeft, Users, Shield, ClipboardList, Pencil, Pill, StickyNote, ListChecks, ShieldAlert, FileEdit, Contact2, Download, Loader2, Link2, FileText, CalendarRange } from 'lucide-react'
import { useState } from 'react'
import AuditHistoryTab from '@/components/AuditHistoryTab'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu } from '@/lib/utils'
import {
  MedicationsTab, NotesTab, RoutinesTab, RestrictivePracticesTab, RiskEntriesSection, ParticipantConsentsSection,
  ParticipantHealthConditionsSection, ParticipantAdlAssessmentsSection, ContactsTab, SupportProfileTab, ClaimsTab,
  RosteringTab,
  ParticipantIdentitySection, ParticipantAddressLivingSection, ParticipantNdisFundingSection, ParticipantKeyIdentifiersSection,
  ParticipantCulturalBackgroundSection, ParticipantMedicalSection, ParticipantBehaviourCommunicationSection,
  ParticipantCommunityAccessSection, ParticipantMealsDietSection, ParticipantAboutMeSection, ParticipantRisksHazardsSummarySection,
} from './participant-detail'
import { Card } from '@/components/Card'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export default function ParticipantDetailPage() {
  const { canWrite, canViewAlerts, canWriteParticipantDetails, canAccessPage, isAdmin, isSuperAdmin } = usePermissions()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  type Tab = 'details' | 'contacts' | 'bookings' | 'support' | 'medications' | 'notes' | 'routines' | 'restrictive-practices' | 'claims' | 'rostering' | 'history'
  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(
    initialTab === 'contacts' || initialTab === 'bookings' || initialTab === 'support' || initialTab === 'medications' || initialTab === 'notes' || initialTab === 'routines' || initialTab === 'restrictive-practices' || initialTab === 'claims' || initialTab === 'rostering' || initialTab === 'history' ? initialTab : 'details'
  )
  const canAccessClaims = canAccessPage('claims')
  // Connection map item 12 — the Rostering tab, same canAccessPage gate RosterBoardPage itself
  // uses (see lib/permissions.ts's SUPPORT_WORKER_PAGES — SupportWorker is excluded).
  const canAccessRostering = canAccessPage('rostering')
  const { data: p, isLoading } = useParticipant(id)
  const { data: bookings = [] } = useParticipantBookings(id)
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

  if (isLoading) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>
  if (!p) return <div className="text-center py-12">Participant not found</div>

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
          {/* SPEC-05 PF-10.5 — three-way resume-banner state, derived from IntakeCompletedAt/IsDraft:
              no IntakeCompletedAt -> "Resume intake" (fresh Intake start, pre-filled from this row);
              IntakeCompletedAt set + IsDraft -> "Continue profile"; IsDraft false -> no banner at all. */}
          {p.isDraft && (
            <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)] text-sm border border-[var(--color-on-warning-container)]/20">
              <span className="flex items-center gap-2">
                <FileEdit className="w-4 h-4 shrink-0" aria-hidden="true" />
                {p.intakeCompletedAt
                  ? "Intake is complete, but this participant's profile isn't finished yet. Excluded from rosters, claims, and other operational lists until finalised."
                  : "This participant is a draft — intake hasn't been completed yet. Excluded from rosters, claims, and other operational lists until finalised."}
              </span>
              {canWrite && (
                <Link
                  to={p.intakeCompletedAt ? `/participants/${id}/profile` : `/participants/${id}/intake`}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-[var(--color-on-warning-container)] text-white text-sm font-medium hover:bg-[var(--color-on-warning-container)]/90 transition-colors shrink-0"
                >
                  <Pencil className="w-4 h-4" /> {p.intakeCompletedAt ? 'Continue profile' : 'Resume intake'}
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
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={() => downloadClientOverview.mutate({ id: id!, fileName: `${p.fullName} - Client Overview.pdf` })}
              disabled={downloadClientOverview.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-all disabled:opacity-50"
            >
              {downloadClientOverview.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {downloadClientOverview.isPending ? 'Preparing…' : 'Client Overview PDF'}
            </button>
            {downloadClientOverview.isError && (
              <p role="alert" className="text-xs text-[var(--color-destructive)]">
                Couldn't download the file. Try again, or contact support if this keeps happening.
              </p>
            )}
          </div>
          {/* cg04 Task 9 (design §5) — the caregiver-link header control. Gated on
              canWriteParticipantDetails (a write action), unlike the ungated Documents
              downloads above — see B15 in the discovery fact sheet. */}
          <CaregiverLinkControl participantId={id!} />
          {canWrite && (
            // PF-10.7 (SPEC-05): the old single-step wizard is retired — this now
            // points straight at the Profile-wizard edit entry point (PF-10.4) rather than the
            // now-redirecting /edit route.
            <Link to={`/participants/${id}/profile`} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20">
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
          ...(canAccessClaims ? [{ key: 'claims' as const, label: 'Claims', icon: FileText }] : []),
          ...(canAccessRostering ? [{ key: 'rostering' as const, label: 'Rostering', icon: CalendarRange }] : []),
          ...((isSuperAdmin || isAdmin) ? [{ key: 'history' as const, label: 'History' }] : []),
        ]}
        active={tab}
        onChange={(key) => setTab(key as typeof tab)}
      />

      {/* PDETAIL-01 — the Details tab's card order mirrors the original single-wizard's step-family
          order (retired by PF-10.7; now split across the Intake/Profile wizards) end to end: Identity, Address & Living
          Arrangements, NDIS & Funding, Key Identifiers, [Contacts has its own sibling tab,
          matching CONTACT-01/02/03's own wizard step], Cultural & Consent, [Support Needs &
          Mobility moved to the Support Profile tab under PD-6], Medical, Behaviour &
          Communication, Community Access, Daily Living, Risks & Hazards.
          PD-7 — every card below is now a `SectionEditPanel`-backed component under
          `pages/participant-detail/`, gated on `canWriteParticipantDetails` (SPEC-03's PD-7):
          see this branch's report for the section → CORE-02 patch-group mapping and how each
          section avoids nulling fields it doesn't render. */}
      {tab === 'details' && (
        <div className="grid md:grid-cols-2 gap-6">
          <ParticipantIdentitySection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantAddressLivingSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantNdisFundingSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantKeyIdentifiersSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantCulturalBackgroundSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <Card className="md:col-span-2">
            <ParticipantConsentsSection participantId={id} />
          </Card>
          {/* PD-6 — the "Support Needs & Mobility" card that used to live here has moved to the
              Support Profile tab (SupportProfileTab.tsx), merged with the `/support-profile`
              sub-resource fields and made editable there. See SPEC-03's PD-6: having the same
              fields editable/displayed in two places would repeat the dual-write-path
              inconsistency discovery already flagged for consents/health/ADL. */}
          <ParticipantMedicalSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          {/* INTAKE sub-wave C1 — the structured health-condition grid (research spec §4.6/§5),
              always rendered (unlike the whole-card-conditional cards above): GetForParticipant
              always returns all ten HealthConditionType entries, so there is no genuinely-empty
              state to hide behind a condition — DataTable's own emptyMessage handles a
              still-loading/zero-row edge case instead. */}
          <Card className="md:col-span-2">
            <ParticipantHealthConditionsSection participantId={id} />
          </Card>
          <ParticipantBehaviourCommunicationSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantCommunityAccessSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          {/* INTAKE sub-wave C2 — the structured ADL rating grid (research spec §4.9/§5), always
              rendered (unlike the whole-card-conditional cards below): GetForParticipant always
              returns all twenty AdlType entries, so there is no genuinely-empty state to hide
              behind a condition — DataTable's own emptyMessage handles a still-loading/zero-row
              edge case instead. Same convention as ParticipantHealthConditionsSection above. */}
          <Card className="md:col-span-2">
            <ParticipantAdlAssessmentsSection participantId={id} />
          </Card>
          <ParticipantMealsDietSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantAboutMeSection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
          <ParticipantRisksHazardsSummarySection p={p} participantId={id!} canEdit={canWriteParticipantDetails} />
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
        <SupportProfileTab participantId={id} onNavigateToTab={(t) => setTab(t as typeof tab)} />
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

      {tab === 'rostering' && canAccessRostering && (
        <RosteringTab participantId={id!} />
      )}

      {tab === 'history' && (isSuperAdmin || isAdmin) && p && (
        <AuditHistoryTab entityType="Participant" entityId={String(p.id)} />
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
      <div className="flex items-center gap-2">
        <StatusBadge status={active?.status ?? 'None'} />
        <button
          type="button"
          onClick={async () => {
            const res = await generate.mutateAsync({ participantId })
            const token = res.data!.token
            setIssued({ url: `${window.location.origin}/caregiver/${token}`, expiresAt: res.data!.expiresAt })
          }}
          disabled={generate.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm hover:bg-[var(--color-accent)] transition-all disabled:opacity-50"
        >
          {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          {active ? 'Regenerate caregiver link' : 'Generate caregiver link'}
        </button>
        {active && (
          <button
            type="button"
            onClick={() => setConfirmingRevoke(true)}
            disabled={revoke.isPending}
            className="px-3 py-2 rounded-lg text-sm text-[var(--color-destructive)] hover:bg-[var(--color-accent)]"
          >
            Revoke
          </button>
        )}
      </div>
      {issued && (
        <div role="status" className="text-xs p-2 rounded bg-[var(--color-accent)] break-all">
          <span>Copy this link now — it won't be shown again. Expires {formatDateAu(issued.expiresAt)}.</span>
          <code className="block mt-1">{issued.url}</code>
          <button type="button" className="mt-1 underline" onClick={() => navigator.clipboard.writeText(issued.url)}>
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
