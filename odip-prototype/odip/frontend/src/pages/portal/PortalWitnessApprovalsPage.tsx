import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck, ShieldAlert, Check, X } from 'lucide-react'
import { usePendingWitnessRequests, useApproveWitnessRequest, useDeclineWitnessRequest } from '@/api/hooks'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { PortalWitnessRequestDto } from '@/api/types'
import { formatWithTimeZone } from '@/lib/utils'

function formatDateTime(value: string | null, timeZone: string | null) {
  return formatWithTimeZone(value, timeZone, { dateStyle: 'medium', timeStyle: 'short' }, undefined)
}

/** Matches the card shape/spacing of the real rows below, so the loading state doesn't jump. */
function SkeletonCard() {
  return (
    <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-4 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-40 bg-[var(--color-muted)] rounded" />
          <div className="h-3 w-56 bg-[var(--color-muted)] rounded" />
          <div className="h-3 w-32 bg-[var(--color-muted)] rounded" />
        </div>
        <div className="h-9 w-40 bg-[var(--color-muted)] rounded-lg shrink-0" />
      </div>
    </div>
  )
}

export default function PortalWitnessApprovalsPage() {
  const { data: requests, isLoading, isError, refetch } = usePendingWitnessRequests()
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

      {isLoading ? (
        <div className="space-y-3" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading witness requests…</span>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : isError ? (
        <EmptyState
          icon={ShieldAlert}
          title="Couldn't load witness requests"
          description="Check your connection and try again."
          action={{ label: 'Try again', onClick: () => refetch() }}
        />
      ) : list.length === 0 ? (
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
                    Recorded by {request.recordedByName} · {formatDateTime(request.administeredAt, request.administeredAtTimeZone)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setDeclining(request)}
                    disabled={approve.isPending || decline.isPending}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm hover:bg-[var(--color-accent)] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
                  >
                    <X className="w-4 h-4" /> Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApprove(request.id)}
                    disabled={approve.isPending || decline.isPending}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
                  >
                    <Check className="w-4 h-4" /> {approve.isPending && approve.variables === request.id ? 'Approving…' : 'Approve'}
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
