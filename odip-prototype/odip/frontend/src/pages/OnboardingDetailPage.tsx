import type React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/api/client'
import { useParticipant } from '@/api/hooks'
import { Button } from '@/components/Button'
import { BackButton } from '@/components/BackButton'
import { PageState } from '@/components/PageState'
import { isNotFoundError } from '@/lib/httpStatus'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage, formatWithTimeZone } from '@/lib/utils'

type Detail = {
  participantId: string
  intakeComplete: boolean
  profileComplete: boolean
  profileCompletedAt?: string
  profileCompletedBy?: string
  serviceTypeConfirmed: boolean
  serviceTypeConfirmedAt?: string
  serviceTypeConfirmedBy?: string
  serviceAgreementSigned: boolean
  isReady: boolean
  reasons: string[]
  /** The newest revision of the agreement that has been approved for rostering, and when (plan builder, phase D). Absent until one has. */
  scheduleApprovedVersion?: number
  scheduleApprovedAt?: string
}

type Gate = { label: string; state: 'Needs attention' | 'Blocked' | 'Complete'; context?: React.ReactNode; fixRoute?: { to: string; label: string } }

function gateState(complete: boolean): Gate['state'] {
  return complete ? 'Complete' : 'Needs attention'
}

export default function OnboardingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { canManageParticipantLifecycle, canAccessPage } = usePermissions()
  const detail = useQuery({ queryKey: ['onboarding', id], enabled: !!id, queryFn: () => apiGet<Detail>(`/inquiries/${id}/onboarding`) })
  // Participant identity for the heading — the onboarding gate payload above only carries the
  // participantId (a raw GUID), never a name, so the display name is fetched separately.
  const { data: participant, isLoading: participantLoading } = useParticipant(id)
  // These retain the existing server endpoints and empty payloads: server-side saved-record validation remains authoritative.
  const profile = useMutation({ mutationFn: () => apiPost<Detail>(`/inquiries/${id}/onboarding/profile-validation`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding', id] }) })
  const services = useMutation({ mutationFn: () => apiPost<Detail>(`/inquiries/${id}/onboarding/service-needs-confirmation`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding', id] }) })
  const d = detail.data

  if (detail.isLoading) return <PageState kind="loading" noun="onboarding record" />
  if (!d) {
    return detail.isError && !isNotFoundError(detail.error)
      ? <PageState kind="error" noun="onboarding record" onRetry={() => detail.refetch()} />
      : <PageState kind="not-found" noun="onboarding record" backTo="/participants?tab=onboarding" backLabel="onboarding" />
  }

  const participantName = participant
    ? `${participant.preferredName?.trim() || participant.firstName} ${participant.lastName}`.trim()
    : undefined
  const headingTitle = participantLoading ? 'Loading…' : (participantName ?? 'Participant')

  const scheduleApproved = d.scheduleApprovedVersion !== undefined
  const approvedOn = d.scheduleApprovedAt ? formatWithTimeZone(d.scheduleApprovedAt, undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : undefined
  const recommended = !d.intakeComplete
    ? {
        label: 'Complete intake',
        reason: 'Complete the saved draft intake. Completing intake puts the participant in onboarding; completing their profile activates them.',
        action: <Button to={`/participants/${id}/intake`}>Complete intake</Button>,
      }
    : !d.profileComplete
      ? {
          label: 'Validate profile data',
          reason: 'Checks the saved profile has a name, date of birth, gender and (for NDIS-funded participants) an NDIS number before marking this step done.',
          action: (
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={profile.isPending} onClick={() => profile.mutate()}>Validate profile data</Button>
              <Button variant="secondary" to={`/participants/${id}/profile`}>Edit profile</Button>
            </div>
          ),
        }
      : !d.serviceTypeConfirmed
        ? {
            label: 'Confirm saved service needs',
            reason: 'Confirms the current draft service plan has valid, correctly priced support lines before marking this step done.',
            action: (
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={services.isPending} onClick={() => services.mutate()}>Confirm saved service needs</Button>
                <Button variant="secondary" to={`/participants/${id}?tab=support`}>Edit service needs</Button>
              </div>
            ),
          }
        : !d.serviceAgreementSigned
          ? {
              label: 'Review agreement evidence',
              reason: 'Open the agreement draft to check its signing evidence. Agreements are signed and approved there, not on this screen.',
              action: <Button to={`/participants/${id}/agreement-draft`}>Review agreement evidence</Button>,
            }
          : scheduleApproved
            ? {
                // A revision has been approved for rostering: what is left is to look at what it made.
                label: 'Check the roster',
                reason: `Version ${d.scheduleApprovedVersion} was approved for rostering${approvedOn ? ` on ${approvedOn}` : ''}: its weekly patterns and unfilled shifts are made. Check them under Shift patterns and on the roster. Nothing is created from this page.`,
                action: canAccessPage('rostering') ? <Button to="/rostering/patterns">Open shift patterns</Button> : null,
              }
            : {
                label: 'Approve the agreement for rostering',
                // What to do, not why again: that the schedule is made by approving a revision, and not from here, is said once, in the list of what is still missing below.
                reason: 'Open the agreement draft and approve its newest revision for rostering. That makes the weekly patterns and unfilled shifts, which you can then check under Shift patterns.',
                // The draft carries money, so only the roles the API admits to it are sent there.
                action: canAccessPage('agreement-drafts')
                  ? <Button to={`/participants/${id}/agreement-draft`}>Open agreement draft</Button>
                  : canAccessPage('rostering') ? <Button to="/rostering/patterns">Open shift patterns</Button> : null,
              }

  const gates: Gate[] = [
    { label: 'Intake completed', state: gateState(d.intakeComplete) },
    { label: 'Participant Profile', state: gateState(d.profileComplete), fixRoute: { to: `/participants/${id}/profile`, label: 'Edit profile' } },
    { label: 'Service needs and provisional lines', state: gateState(d.serviceTypeConfirmed), fixRoute: { to: `/participants/${id}?tab=support`, label: 'Edit service needs' } },
    // The draft carries money, so only the roles the API admits to it are sent there (a ReadOnly or SupportWorker who can read this page would only meet a redirect or a 403).
    { label: 'Current agreement evidence', state: gateState(d.serviceAgreementSigned), context: 'Agreements are signed and approved elsewhere.', fixRoute: canAccessPage('agreement-drafts') ? { to: `/participants/${id}/agreement-draft`, label: 'Open agreement draft' } : undefined },
    {
      label: 'Schedule review',
      // Complete once a revision has been approved for rostering (it made the patterns and the shifts), and the row says which one. Until then it is Blocked and says no more than that and where to go: what the
      // schedule needs is said once, by the next action above and the list below, not a third time here.
      state: scheduleApproved ? 'Complete' : 'Blocked',
      context: scheduleApproved ? `Approved for rostering: version ${d.scheduleApprovedVersion}${approvedOn ? `, on ${approvedOn}` : ''}.` : undefined,
      // The schedule is made on the agreement draft: the shift patterns page has nothing to show before a revision is approved, so it is only the way for a role the API does not admit to the draft.
      fixRoute: canAccessPage('agreement-drafts')
        ? { to: `/participants/${id}/agreement-draft`, label: 'Open agreement draft' }
        : canAccessPage('rostering') ? { to: '/rostering/patterns', label: 'Open shift patterns' } : undefined },
  ]
  const completedGateCount = gates.filter(gate => gate.state === 'Complete').length
  // Finishing onboarding is the Profile wizard's Complete Profile: it finalises the participant, and when the organisation's readiness rule allows it they
  // become active and move to Active participants. It is offered whenever the participant is a draft with the intake complete, whichever gate is open: the
  // gate actions above only edit or validate data, and "Edit profile" disappears once the profile gate is complete, which left nothing that ends onboarding.
  const canCompleteProfile = canManageParticipantLifecycle && d.intakeComplete && participant?.isDraft === true
  // The onboarding checklist is reached from the Participants hub's Onboarding tab. Honour real
  // in-app history when the user got here via a non-hub route, and otherwise fall back to the
  // hub's Onboarding tab so the user always lands on the right stage.

  return <div className="flex flex-col gap-[var(--section-gap)]">
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        title={headingTitle}
        subtitle={<Link to={`/participants/${id}`} className="font-medium text-[var(--color-primary)] hover:underline">View participant record</Link>}
        action={<BackButton to="/participants?tab=onboarding" label="onboarding" history={false} />}
      />
      {/* min(26rem,100%) is what collapses this to one column on a phone (a bare 26rem floor
          overflows a 390px viewport), so the old max-md:grid-cols-1 override is redundant. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))] items-start gap-[var(--section-gap)]">
        <Card title="Current stage">
          <p className="font-semibold">{d.isReady ? 'Complete' : 'Onboarding in progress'}</p>
          <p className="mt-1 text-sm tabular-nums">Progress: {completedGateCount} of {gates.length} gates complete</p>
        </Card>
        <section
          aria-labelledby="recommended-action-heading"
          className="!border-2 !border-[var(--color-primary)] !bg-[var(--color-accent)] bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)]"
        >
          <p className="text-sm font-medium text-[var(--color-muted-foreground)]">Recommended next action</p>
          <h2 id="recommended-action-heading" className="mt-1 text-base font-semibold">{recommended.label}</h2>
          <p className="mt-1 text-sm">{recommended.reason}</p>
          <div className="mt-2">
            {canManageParticipantLifecycle ? recommended.action : <p className="text-sm font-medium">Read-only access: lifecycle changes are unavailable for this role.</p>}
          </div>
        </section>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {/* "Listed below" only while there is a list: with nothing missing the page says so, and what finishing onboarding looks like. */}
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {d.reasons.length > 0
            ? "Completing the participant's profile finishes onboarding: they move to Active participants once your organisation's readiness rule allows it. What is still missing is listed below."
            : "Nothing else is missing. Completing the participant's profile finishes onboarding: they move to Active participants once your organisation's readiness rule allows it."}
        </p>
        {canCompleteProfile && <Button to={`/participants/${id}/profile`}>Complete profile</Button>}
      </div>
    </div>

    {profile.error || services.error ? (
      <Callout tone="error">
        {profile.error
          ? extractErrorMessage(profile.error, 'Profile is incomplete — edit the profile, then validate again.')
          : extractErrorMessage(services.error, 'Service needs are incomplete — edit the service needs, then confirm again.')}
      </Callout>
    ) : null}

    <section aria-labelledby="onboarding-gates-heading" className="flex flex-col gap-2">
      <h2 id="onboarding-gates-heading" className="text-base font-semibold">Onboarding gates</h2>
      {gates.map(gate => (
        <article key={gate.label} className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{gate.label}</h3>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={gate.state} />
              {gate.state !== 'Complete' && gate.fixRoute && (
                <Button variant="secondary" size="sm" to={gate.fixRoute.to}>{gate.fixRoute.label}</Button>
              )}
            </div>
          </div>
          {gate.context ? <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{gate.context}</p> : null}
        </article>
      ))}
    </section>

    {d.reasons.length > 0
      ? (
        <Card aria-labelledby="readiness-reasons-heading">
          <h2 id="readiness-reasons-heading" className="font-semibold">What's still missing</h2>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{d.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        </Card>
      )
      : null}
  </div>
}