import type React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/api/client'

type Detail = { participantId: string; intakeComplete: boolean; profileComplete: boolean; profileCompletedAt?: string; profileCompletedBy?: string; serviceTypeConfirmed: boolean; serviceTypeConfirmedAt?: string; serviceTypeConfirmedBy?: string; serviceAgreementSigned: boolean; isReady: boolean; reasons: string[] }

export default function OnboardingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const detail = useQuery({ queryKey: ['onboarding', id], enabled: !!id, queryFn: () => apiGet<Detail>(`/inquiries/${id}/onboarding`) })
  const profile = useMutation({ mutationFn: () => apiPost<Detail>(`/inquiries/${id}/onboarding/profile-validation`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding', id] }) })
  const services = useMutation({ mutationFn: () => apiPost<Detail>(`/inquiries/${id}/onboarding/service-needs-confirmation`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding', id] }) })
  const d = detail.data
  if (detail.isLoading) return <div>Loading onboarding…</div>
  if (!d) return <div role="alert">Onboarding record was not found.</div>
  const rows = [
    ['Intake PDF', d.intakeComplete, <Link to={`/participants/${id}/intake`}>Open intake</Link>],
    ['Profile essentials', d.profileComplete, <><Link to={`/participants/${id}/profile`}>Edit profile</Link>{!d.profileComplete && <button type="button" onClick={() => profile.mutate()}>Validate saved profile</button>}</>],
    ['Service needs and provisional lines', d.serviceTypeConfirmed, <><Link to={`/participants/${id}/agreement-draft`}>Open provisional draft</Link>{!d.serviceTypeConfirmed && <button type="button" onClick={() => services.mutate()}>Confirm saved service needs</button>}</>],
    ['Current agreement evidence', d.serviceAgreementSigned, <span>Pending — this screen cannot sign or approve an agreement.</span>],
    ['Schedule review', false, <span>Proposal-only. This screen never creates shifts.</span>],
  ]
  return <div className="space-y-6"><div><Link to="/onboarding">← Onboarding</Link><h1 className="text-2xl font-semibold">Onboarding checklist</h1><p>All status is derived and server-owned. It does not activate a participant or permit booking, rostering, invoices, or claims.</p></div>{profile.error || services.error ? <div role="alert">The server could not validate this step. Correct the saved record and retry.</div> : null}<div className="space-y-3">{rows.map(([label, complete, action]) => <section key={String(label)} className="rounded border p-4"><strong>{String(label)}: {complete ? 'Complete' : 'Not complete'}</strong><div className="mt-2 flex gap-3">{action as React.ReactNode}</div></section>)}</div><section><h2 className="font-semibold">Readiness reasons</h2><ul>{d.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></section></div>
}
