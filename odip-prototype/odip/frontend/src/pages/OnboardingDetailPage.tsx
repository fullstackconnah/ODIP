import type React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/api/client'
import { usePermissions } from '@/lib/permissions'

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

type Gate = { label: string; state: 'Needs attention' | 'Blocked' | 'Complete'; context?: React.ReactNode }

function gateState(complete: boolean): Gate['state'] {
  return complete ? 'Complete' : 'Needs attention'
}

export default function OnboardingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { canManageParticipantLifecycle } = usePermissions()
  const detail = useQuery({ queryKey: ['onboarding', id], enabled: !!id, queryFn: () => apiGet<Detail>(`/inquiries/${id}/onboarding`) })
  // These retain the existing server endpoints and empty payloads: server-side saved-record validation remains authoritative.
  const profile = useMutation({ mutationFn: () => apiPost<Detail>(`/inquiries/${id}/onboarding/profile-validation`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding', id] }) })
  const services = useMutation({ mutationFn: () => apiPost<Detail>(`/inquiries/${id}/onboarding/service-needs-confirmation`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding', id] }) })
  const d = detail.data

  if (detail.isLoading) return <div>Loading onboarding…</div>
  if (!d) return <div role="alert">Onboarding record was not found.</div>

  const recommended = !d.intakeComplete
    ? { label: 'Complete intake', reason: 'Complete the saved draft intake. Completing intake does not activate the participant.', action: <Link className="inline-flex rounded bg-[var(--color-primary)] px-4 py-2 text-white" to={`/participants/${id}/intake`}>Complete intake</Link> }
    : !d.profileComplete
      ? { label: 'Validate saved profile', reason: 'The server validates the currently saved canonical profile fields before it records this gate.', action: <button type="button" className="rounded bg-[var(--color-primary)] px-4 py-2 text-white disabled:opacity-50" disabled={profile.isPending} onClick={() => profile.mutate()}>Validate saved profile</button> }
      : !d.serviceTypeConfirmed
        ? { label: 'Confirm saved service needs', reason: 'The server only records confirmation against a current dated provisional draft with valid catalogue-priced support lines.', action: <button type="button" className="rounded bg-[var(--color-primary)] px-4 py-2 text-white disabled:opacity-50" disabled={services.isPending} onClick={() => services.mutate()}>Confirm saved service needs</button> }
        : !d.serviceAgreementSigned
          ? { label: 'Review agreement evidence', reason: 'Agreement evidence remains server-derived. This screen cannot sign or approve an agreement.', action: <Link className="inline-flex rounded bg-[var(--color-primary)] px-4 py-2 text-white" to={`/participants/${id}/agreement-draft`}>Review agreement evidence</Link> }
          : { label: 'Review schedule proposal', reason: 'Schedule review is proposal-only. No schedule coverage has been approved and no shifts are created here.', action: null }

  const gates: Gate[] = [
    { label: 'Intake PDF', state: gateState(d.intakeComplete) },
    { label: 'Profile essentials', state: gateState(d.profileComplete) },
    { label: 'Service needs and provisional lines', state: gateState(d.serviceTypeConfirmed) },
    { label: 'Current agreement evidence', state: gateState(d.serviceAgreementSigned), context: 'This screen cannot sign or approve an agreement.' },
    { label: 'Schedule review', state: 'Blocked', context: 'Proposal-only. This screen never creates shifts.' },
  ]

  return <div className="space-y-6">
    <div className="space-y-3">
      <Link to="/onboarding">← Onboarding</Link>
      <div>
        <p className="text-sm text-[var(--color-muted-foreground)]">Participant identity</p>
        <h1 className="text-2xl font-semibold">Participant {d.participantId}</h1>
      </div>
      <div className="rounded border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">Current stage</p>
        <p className="font-semibold">{d.isReady ? 'Complete' : 'Onboarding in progress'}</p>
        <p className="mt-2 text-sm">Progress: {gates.filter(gate => gate.state === 'Complete').length} of {gates.length} gates complete</p>
      </div>
      <section className="rounded border-2 border-[var(--color-primary)] bg-[var(--color-accent)] p-4" aria-labelledby="recommended-action-heading">
        <p className="text-sm font-medium text-[var(--color-muted-foreground)]">Recommended next action</p>
        <h2 id="recommended-action-heading" className="mt-1 text-lg font-semibold">{recommended.label}</h2>
        <p className="mt-1 text-sm">{recommended.reason}</p>
        <div className="mt-3">
          {canManageParticipantLifecycle ? recommended.action : <p className="text-sm font-medium">Read-only access: lifecycle changes are unavailable for this role.</p>}
        </div>
      </section>
      <p className="text-sm text-[var(--color-muted-foreground)]">All status is derived and server-owned. It does not activate a participant or permit booking, rostering, invoices, or claims.</p>
    </div>

    {profile.error || services.error ? <div role="alert">The server could not validate this step. Correct the saved record and retry.</div> : null}

    <section aria-labelledby="onboarding-gates-heading" className="space-y-3">
      <h2 id="onboarding-gates-heading" className="text-lg font-semibold">Onboarding gates</h2>
      {gates.map(gate => <article key={gate.label} className="rounded border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{gate.label}</h3><span className="rounded-full border px-2 py-1 text-sm">{gate.state}</span></div>
        {gate.context ? <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{gate.context}</p> : null}
      </article>)}
    </section>

    {d.reasons.length > 0 ? <section aria-labelledby="readiness-reasons-heading" className="rounded border p-4">
      <h2 id="readiness-reasons-heading" className="font-semibold">Server readiness notes</h2>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">The API supplies these as an overall readiness list, not as gate-specific associations.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">{d.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    </section> : null}
  </div>
}
