import { useState, type ReactNode } from 'react'
import { ShieldCheck, ShieldAlert, Check, X } from 'lucide-react'
import {
  usePendingWitnessRequests, useApproveWitnessRequest, useDeclineWitnessRequest,
  useApproveIncidentWitnessRequest, useDeclineIncidentWitnessRequest,
} from '@/api/hooks'
import { PageHeader } from '@/components/PageHeader'
import { BackButton } from '@/components/BackButton'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { PortalWitnessRequestDto } from '@/api/types'
import { INCIDENT_TYPE_LABELS, INCIDENT_SEVERITY_LABELS } from '@/api/types/enums'
import { formatWithTimeZone, extractErrorMessage } from '@/lib/utils'

function formatDateTime(value: string | null, timeZone: string | null) {
  return formatWithTimeZone(value, timeZone, { dateStyle: 'medium', timeStyle: 'short' }, undefined)
}

/** Matches the card shape/spacing of the real rows below, so the loading state doesn't jump. */
function SkeletonCard() {
  return (
    <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 animate-pulse">
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

type PendingAction = { request: PortalWitnessRequestDto; action: 'approve' | 'decline' }

export default function PortalWitnessApprovalsPage() {
  const { data: requests, isLoading, isError, refetch } = usePendingWitnessRequests()
  const approve = useApproveWitnessRequest()
  const decline = useDeclineWitnessRequest()
  const approveIncident = useApproveIncidentWitnessRequest()
  const declineIncident = useDeclineIncidentWitnessRequest()
  // IN-7: a medication row keeps today's exact interaction (immediate Approve, confirm-only
  // Decline, no statement UI ever rendered) — only an Incident row routes BOTH actions through
  // this dialog, since either response there may optionally carry a witness statement.
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [statementText, setStatementText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const list = requests ?? []
  const isBusy = approve.isPending || decline.isPending || approveIncident.isPending || declineIncident.isPending

  async function handleApproveClick(request: PortalWitnessRequestDto) {
    if (request.sourceType === 'Incident') {
      setPendingAction({ request, action: 'approve' })
      return
    }
    setError(null)
    try {
      const res = await approve.mutateAsync(request.id)
      if (!res.success) {
        setError(res.errors?.[0] || res.message || 'Failed to approve.')
        refetch()
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to approve.'))
      refetch()
    }
  }

  function handleDeclineClick(request: PortalWitnessRequestDto) {
    setPendingAction({ request, action: 'decline' })
  }

  async function handleConfirm() {
    if (!pendingAction) return
    const { request, action } = pendingAction
    setError(null)
    try {
      const res = request.sourceType === 'Incident'
        ? action === 'approve'
          ? await approveIncident.mutateAsync({ id: request.id, statementText: statementText.trim() || undefined })
          : await declineIncident.mutateAsync({ id: request.id, statementText: statementText.trim() || undefined })
        : await decline.mutateAsync(request.id) // medication only ever reaches the dialog via Decline
      if (!res.success) {
        setError(res.errors?.[0] || res.message || `Failed to ${action}.`)
        refetch()
      }
    } catch (err) {
      setError(extractErrorMessage(err, `Failed to ${action}.`))
      refetch()
    } finally {
      setPendingAction(null)
      setStatementText('')
    }
  }

  function closeDialog() {
    setPendingAction(null)
    setStatementText('')
  }

  const dialogCopy = (() => {
    if (!pendingAction) return { title: '', message: null as ReactNode, confirmLabel: '', variant: 'default' as const }
    const { request, action } = pendingAction
    if (request.sourceType === 'Incident') {
      const verb = action === 'approve' ? 'confirm you witnessed' : 'confirm you did NOT witness'
      return {
        title: action === 'approve' ? 'Approve witness request' : 'Decline witness request',
        confirmLabel: action === 'approve' ? 'Approve' : 'Decline',
        variant: action === 'approve' ? 'default' as const : 'danger' as const,
        message: (
          <div className="space-y-3">
            <p>{`Please ${verb} "${request.incidentTitle}" involving ${request.participantName}.`}</p>
            <label className="block text-sm text-[var(--color-foreground)]">
              Witness statement <span className="text-[var(--color-muted-foreground)]">(optional)</span>
              <textarea
                value={statementText}
                onChange={(e) => setStatementText(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] p-2 text-sm"
                placeholder="Describe what you saw…"
              />
            </label>
          </div>
        ),
      }
    }
    return {
      title: 'Decline witness request',
      confirmLabel: 'Decline',
      variant: 'danger' as const,
      message: `Confirm you did NOT witness the administration of ${request.medicationName} for ${request.participantName}.`,
    }
  })()

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Witness approvals" subtitle="Medication doses and incident reports waiting for you to confirm you witnessed them">
        <BackButton to="/portal" label="my shifts" variant="link" history={false} />
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
          description="You'll see a request here whenever another staff member selects you as the witness for a high-risk medication dose or an incident report."
        />
      ) : (
        <div className="space-y-3">
          {list.map(request => (
            <div key={request.id} className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  {request.sourceType === 'Incident' ? (
                    <>
                      <p className="font-medium text-[var(--color-foreground)]">
                        {request.incidentTitle}
                        {request.incidentType && ` — ${INCIDENT_TYPE_LABELS[request.incidentType] ?? request.incidentType}`}
                      </p>
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        {request.participantName}
                        {request.incidentSeverity ? ` · ${INCIDENT_SEVERITY_LABELS[request.incidentSeverity] ?? request.incidentSeverity} severity` : ''}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                        Reported by {request.recordedByName} · {formatDateTime(request.incidentDateTime, null)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-[var(--color-foreground)]">
                        {request.medicationName}{request.strength ? ` ${request.strength}` : ''}
                      </p>
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        {request.participantName} · {request.doseGiven || request.doseDescription}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                        Recorded by {request.recordedByName} · {formatDateTime(request.administeredAt, request.administeredAtTimeZone)}
                      </p>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDeclineClick(request)}
                    disabled={isBusy}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm hover:bg-[var(--color-accent)] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
                  >
                    <X className="w-4 h-4" /> Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApproveClick(request)}
                    disabled={isBusy}
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
        open={!!pendingAction}
        onCancel={closeDialog}
        onConfirm={handleConfirm}
        title={dialogCopy.title}
        message={dialogCopy.message}
        confirmLabel={dialogCopy.confirmLabel}
        variant={dialogCopy.variant}
        loading={isBusy}
      />
    </div>
  )
}
