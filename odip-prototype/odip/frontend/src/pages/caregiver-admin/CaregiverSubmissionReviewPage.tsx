import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { useCaregiverSubmission, useAcceptCaregiverSubmission, useRejectCaregiverSubmission } from '@/api/hooks/caregiver'
import { computeCaregiverDiff, type DiffRow } from '@/lib/caregiverDiff'
import { usePermissions } from '@/lib/permissions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Modal } from '@/components/Modal'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { BackButton } from '@/components/BackButton'
import { TAP_AREA } from '@/components/tapArea'
import { PageState } from '@/components/PageState'
import { isNotFoundError } from '@/lib/httpStatus'
import { Callout } from '@/components/Callout'
import { formatDateAu, extractErrorMessage } from '@/lib/utils'
import { retryingAfterError } from '@/lib/queryPhase'

/**
 * cg04 Task 11 (design §5) — side-by-side current | caregiver's value for changed fields only,
 * grouped by field group. Accept and Reject both confirm before acting (Accept via
 * `ConfirmDialog`; Reject via its own inline note form, whose submit button stays disabled
 * until the note is non-empty). Both actions — and the whole action cluster — are hidden
 * unless the submission is Submitted and the viewer has canWriteParticipantDetails.
 *
 * NOTE: `ConfirmDialog`'s real prop is `message` (ReactNode), not `description` as the plan's
 * sketch names it — confirmed against src/components/ConfirmDialog.tsx.
 */
export default function CaregiverSubmissionReviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { canWriteParticipantDetails } = usePermissions()
  const pageQuery = useCaregiverSubmission(id)
  const { data: s, isLoading, isError, error, refetch } = pageQuery
  const accept = useAcceptCaregiverSubmission()
  const reject = useRejectCaregiverSubmission()
  const [confirmAccept, setConfirmAccept] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const rows = useMemo(() => (s ? computeCaregiverDiff(s.current, s.payload, s.base) : []), [s])
  const byGroup = useMemo(
    () => rows.reduce<Record<string, DiffRow[]>>((acc, r) => { (acc[r.group] ??= []).push(r); return acc }, {}),
    [rows],
  )

  if (isLoading && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="submission" />
  if (!s) {
    return (isError || retryingAfterError(pageQuery)) && !isNotFoundError(error)
      ? <PageState kind="error" noun="submission" onRetry={() => refetch()} />
      : <PageState kind="not-found" noun="submission" backTo="/caregiver-submissions" backLabel="caregiver submissions" />
  }
  const canAct = canWriteParticipantDetails && s.status === 'Submitted'
  // Staff edits since the form was opened only matter while there is still something to accept.
  const flagStaffChanges = s.status === 'Submitted'

  // A refusal (409 when someone else reviewed it first) closes the dialog, says why and reloads the submission's real state.
  const act = async (request: () => Promise<unknown>, fallback: string) => {
    setActionError(null)
    try {
      await request()
    } catch (err) {
      setConfirmAccept(false)
      setShowReject(false)
      setActionError(extractErrorMessage(err, fallback))
      void refetch()
      return
    }
    setConfirmAccept(false)
    setShowReject(false)
    navigate('/caregiver-submissions')
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <div className="flex items-start gap-3">
        {/* Reached from the list and from the participant's Documents menu, so Back returns to whichever it was. */}
        <BackButton to="/caregiver-submissions" label="caregiver submissions" variant="icon" className="mt-0.5" />
        <div className="flex-1">
          <PageHeader
            title={s.participantName}
            subtitle={(
              <>
                Submitted by <strong>{s.caregiverName ?? '—'}</strong>
                {s.caregiverRelationship ? ` (${s.caregiverRelationship})` : ''}
                {s.submittedAt ? ` on ${formatDateAu(s.submittedAt)}` : ''} · {s.status}
                {' · '}
                <Link to={`/participants/${s.participantId}`} className={`${TAP_AREA} font-medium text-[var(--color-primary)] hover:underline`}>View participant record</Link>
              </>
            )}
            action={canAct && (
              <div className="flex gap-2">
                <Button variant="secondary" size="md" onClick={() => setShowReject(true)}>
                  Reject…
                </Button>
                <Button size="md" onClick={() => setConfirmAccept(true)}>
                  Accept
                </Button>
              </div>
            )}
          />
        </div>
      </div>

      {actionError && <Callout tone="error">{actionError}</Callout>}

      {!s.base && rows.length > 0 && <Callout tone="info">Sent before change tracking: every value shown here will be applied.</Callout>}

      {rows.length === 0 ? (
        <p className="min-h-[60px] flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-[var(--card-pad)] py-2 text-center text-sm text-[var(--color-muted-foreground)]">No changes from the caregiver.</p>
      ) : (
        Object.entries(byGroup).map(([group, groupRows]) => (
          <section key={group} className="rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
            <h2 className="px-[var(--cell-px)] py-[6px] bg-[var(--color-accent)] text-sm font-medium">{group}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--color-muted-foreground)] text-xs">
                    <th className="px-[var(--cell-px)] py-[6px] font-medium">Field</th>
                    <th className="px-[var(--cell-px)] py-[6px] font-medium">Current</th>
                    <th className="px-[var(--cell-px)] py-[6px] font-medium">Caregiver's value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {groupRows.map((r) => (
                    <tr key={r.field}>
                      <td className="px-[var(--cell-px)] py-[7px] font-medium">{r.label}</td>
                      <td className="px-[var(--cell-px)] py-[7px]">
                        {r.current}
                        {flagStaffChanges && r.staffChanged && (
                          <p className="mt-1 flex items-start gap-1 text-xs font-medium text-[var(--color-on-warning-container)]">
                            <AlertCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            Staff edited this since the caregiver started. Accept replaces it.
                          </p>
                        )}
                      </td>
                      <td className="px-[var(--cell-px)] py-[7px]">{r.proposed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <ConfirmDialog
        open={confirmAccept}
        title="Accept this submission?"
        message="All the caregiver's changes above will be applied to the participant record."
        confirmLabel="Accept"
        loading={accept.isPending}
        onCancel={() => setConfirmAccept(false)}
        onConfirm={() => act(() => accept.mutateAsync({ id: s.id, participantId: s.participantId }), "Couldn't accept this submission. Please try again.")}
      />

      <Modal
        open={showReject}
        onClose={() => setShowReject(false)}
        title="Reject submission"
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setShowReject(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={!rejectNote.trim() || reject.isPending}
              onClick={() => act(() => reject.mutateAsync({ id: s.id, note: rejectNote.trim() }), "Couldn't reject this submission. Please try again.")}
            >
              Reject and reopen link
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="reject-note">What should the caregiver fix?</label>
          <textarea
            id="reject-note"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            className="w-full p-2 rounded-[var(--radius-sm)] border border-[var(--color-border)]"
            rows={3}
          />
        </div>
      </Modal>
    </div>
  )
}
