import type React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { apiGet, apiPost } from '@/api/client'
import { useParticipant } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { useBackTarget } from '@/hooks/useBackNavigation'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'

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

  const back = useBackTarget('/participants?tab=onboarding')

  if (detail.isLoading) return <div>Loading onboarding…</div>
  if (!d) return <Callout tone="error">Onboarding record was not found.</Callout>

  const participantName = participant
    ? `${participant.preferredName?.trim() || participant.firstName} ${participant.lastName}`.trim()
    : undefined
  const headingTitle = participantLoading ? 'Loading…' : (participantName ?? 'Participant')

  const recommended = !d.intakeComplete
    ? {
        label: 'Complete intake',
        reason: 'Complete the saved draft intake. Completing intake does not activate the participant.',
        action: <Button to={`/participants/${id}/intake`}>Complete intake</Button>,
      }
    : !d.profileComplete
      ? {
          label: 'Validate saved profile',
          reason: 'Checks the saved profile is complete before marking this step done.',
          action: (
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={profile.isPending} onClick={() => profile.mutate()}>Validate saved profile</Button>
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
          : {
              label: 'Review schedule proposal',
              reason: 'Schedule review is proposal-only. No schedule coverage has been approved and no shifts are created here.',
              action: canAccessPage('rostering') ? <Button to="/rostering/patterns">Open shift patterns</Button> : null,
            }

  const gates: Gate[] = [
    { label: 'Intake completed', state: gateState(d.intakeComplete) },
    { label: 'Participant Profile', state: gateState(d.profileComplete), fixRoute: { to: `/participants/${id}/profile`, label: 'Edit profile' } },
    { label: 'Service needs and provisional lines', state: gateState(d.serviceTypeConfirmed), fixRoute: { to: `/participants/${id}?tab=support`, label: 'Edit service needs' } },
    { label: 'Current agreement evidence', state: gateState(d.serviceAgreementSigned), context: 'Agreements are signed and approved elsewhere.', fixRoute: { to: `/participants/${id}/agreement-draft`, label: 'Open agreement draft' } },
    { label: 'Schedule review', state: 'Blocked', context: 'Shows the proposed schedule only — no shifts are created.', fixRoute: canAccessPage('rostering') ? { to: '/rostering/patterns', label: 'Open shift patterns' } : undefined },
  ]
  const completedGateCount = gates.filter(gate => gate.state === 'Complete').length
  // The onboarding checklist is reached from the Participants hub's Onboarding tab. Honour real
  // in-app history when the user got here via a non-hub route, and otherwise fall back to the
  // hub's Onboarding tab so the user always lands on the right stage.

  return <div className="flex flex-col gap-[var(--section-gap)]">
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        title={headingTitle}
        subtitle={<Link to={`/participants/${id}`} className="font-medium text-[var(--color-primary)] hover:underline">View participant record</Link>}
        action={
          <Button variant="secondary" size="md" onClick={back.onBack} aria-label={back.ariaLabel}>
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        }
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(26rem,1fr))] items-start gap-[var(--section-gap)] max-md:grid-cols-1">
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
      <p className="text-sm text-[var(--color-muted-foreground)]">Completing these steps doesn't activate the participant or allow bookings, rostering, invoicing or claims.</p>
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