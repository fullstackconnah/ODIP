import { useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useCaregiverSubmission, useAcceptCaregiverSubmission, useRejectCaregiverSubmission } from '@/api/hooks/caregiver'
import { computeCaregiverDiff, type DiffRow } from '@/lib/caregiverDiff'
import { usePermissions } from '@/lib/permissions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Modal } from '@/components/Modal'
import { formatDateAu } from '@/lib/utils'

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
  const { data: s, isLoading } = useCaregiverSubmission(id)
  const accept = useAcceptCaregiverSubmission()
  const reject = useRejectCaregiverSubmission()
  const [confirmAccept, setConfirmAccept] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [showReject, setShowReject] = useState(false)

  const rows = useMemo(() => (s ? computeCaregiverDiff(s.current, s.payload) : []), [s])
  const byGroup = useMemo(
    () => rows.reduce<Record<string, DiffRow[]>>((acc, r) => { (acc[r.group] ??= []).push(r); return acc }, {}),
    [rows],
  )

  if (isLoading) return <p>Loading…</p>
  if (!s) return <p>Submission not found.</p>
  const canAct = canWriteParticipantDetails && s.status === 'Submitted'

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start gap-4">
        <Link to="/caregiver-submissions" className="mt-1 p-2 rounded-lg hover:bg-[var(--color-accent)]">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{s.participantName}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Submitted by <strong>{s.caregiverName ?? '—'}</strong>
            {s.caregiverRelationship ? ` (${s.caregiverRelationship})` : ''}
            {s.submittedAt ? ` on ${formatDateAu(s.submittedAt)}` : ''} · {s.status}
          </p>
        </div>
        {canAct && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowReject(true)} className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm">
              Reject…
            </button>
            <button type="button" onClick={() => setConfirmAccept(true)} className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm">
              Accept
            </button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">The caregiver submitted the form without changing any values.</p>
      ) : (
        Object.entries(byGroup).map(([group, groupRows]) => (
          <section key={group} className="rounded-2xl border border-[var(--color-border)] overflow-hidden">
            <h2 className="px-4 py-2 bg-[var(--color-accent)] text-sm font-medium">{group}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--color-muted-foreground)]">
                  <th className="p-3">Field</th>
                  <th className="p-3">Current</th>
                  <th className="p-3">Caregiver's value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {groupRows.map((r) => (
                  <tr key={r.field}>
                    <td className="p-3 font-medium">{r.label}</td>
                    <td className="p-3">{r.current}</td>
                    <td className="p-3">{r.proposed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
        onConfirm={async () => {
          await accept.mutateAsync({ id: s.id, participantId: s.participantId })
          setConfirmAccept(false)
          navigate('/caregiver-submissions')
        }}
      />

      <Modal
        open={showReject}
        onClose={() => setShowReject(false)}
        title="Reject submission"
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setShowReject(false)} className="px-3 py-2 text-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={!rejectNote.trim() || reject.isPending}
              onClick={async () => {
                await reject.mutateAsync({ id: s.id, note: rejectNote.trim() })
                setShowReject(false)
                navigate('/caregiver-submissions')
              }}
              className="px-4 py-2 rounded-lg bg-[var(--color-destructive)] text-white text-sm disabled:opacity-50"
            >
              Reject and reopen link
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="reject-note">What should the caregiver fix?</label>
          <textarea
            id="reject-note"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            className="w-full p-2 rounded-lg border border-[var(--color-border)]"
            rows={3}
          />
        </div>
      </Modal>
    </div>
  )
}
