import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck, Check, X } from 'lucide-react'
import { usePendingWitnessRequests, useApproveWitnessRequest, useDeclineWitnessRequest } from '@/api/hooks'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { PortalWitnessRequestDto } from '@/api/types'

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function PortalWitnessApprovalsPage() {
  const { data: requests, isLoading } = usePendingWitnessRequests()
  const approve = useApproveWitnessRequest()
  const decline = useDeclineWitnessRequest()
  const [declining, setDeclining] = useState<PortalWitnessRequestDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  const list = requests ?? []

  async function handleApprove(id: string) {
    setError(null)
    try {
      const res = await approve.mutateAsync(id)
      if (!res.success) setError(res.errors?.[0] || res.message || 'Failed to approve.')
    } catch {
      setError('Failed to approve.')
    }
  }

  async function handleDecline() {
    if (!declining) return
    setError(null)
    try {
      const res = await decline.mutateAsync(declining.id)
      if (!res.success) setError(res.errors?.[0] || res.message || 'Failed to decline.')
    } catch {
      setError('Failed to decline.')
    } finally {
      setDeclining(null)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Witness approvals" subtitle="Medication doses waiting for you to confirm you witnessed them">
        <Link to="/portal" className="inline-flex items-center gap-1 text-sm text-[var(--color-primary)] hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to My Shifts
        </Link>
      </PageHeader>

      {error && (
        <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          {error}
        </div>
      )}

      {!isLoading && list.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No witness requests waiting"
          description="You'll see a request here whenever another staff member selects you as the witness for a high-risk medication dose."
        />
      ) : (
        <div className="space-y-3">
          {list.map(request => (
            <div key={request.id} className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--color-foreground)]">
                    {request.medicationName}{request.strength ? ` ${request.strength}` : ''}
                  </p>
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {request.participantName} · {request.doseGiven || request.doseDescription}
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                    Recorded by {request.recordedByName} · {formatDateTime(request.administeredAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setDeclining(request)}
                    disabled={approve.isPending || decline.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:bg-[var(--color-accent)] transition-colors disabled:opacity-50"
                  >
                    <X className="w-4 h-4" /> Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApprove(request.id)}
                    disabled={approve.isPending || decline.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-colors disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" /> Approve
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!declining}
        onCancel={() => setDeclining(null)}
        onConfirm={handleDecline}
        title="Decline witness request"
        message={declining ? `Confirm you did NOT witness the administration of ${declining.medicationName} for ${declining.participantName}.` : ''}
        confirmLabel="Decline"
        variant="danger"
        loading={decline.isPending}
      />
    </div>
  )
}
