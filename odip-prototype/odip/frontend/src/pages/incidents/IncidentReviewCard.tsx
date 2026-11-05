import { useEffect, useRef, useState } from 'react'
import { useIncidentStatusHistory, useRecordIncidentReview } from '@/api/hooks'
import type { IncidentDetailDto } from '@/api/types/incidents'
import { INCIDENT_STATUSES, INCIDENT_STATUS_LABELS } from '@/api/types/enums'
import { Card } from '@/components/Card'
import { FactList } from '@/components/FactList'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { StatusBadge } from '@/components/StatusBadge'
import { TextAreaField } from '@/components/TextAreaField'
import { SelectField } from '@/components/SelectField'
import { formatWithTimeZone } from '@/lib/utils'
import { retryingAfterError } from '@/lib/queryPhase'

const STATUS_OPTIONS = INCIDENT_STATUSES.map((s) => ({ value: s, label: INCIDENT_STATUS_LABELS[s] }))

/**
 * The Admin review step of an incident (IC7), inline in the detail page. Admins (and SuperAdmin) write it; Coordinators read it; the page does not
 * mount it for anyone else (the server strips the fields too). The reviewer is the signed-in person and the date is the server's, so the form has
 * no such fields. The status history under it is read from the audit trail.
 */
export function IncidentReviewCard({ incident, canEdit, editing: editingProp, onEditingChange, onDirtyChange }: {
  incident: IncidentDetailDto
  canEdit: boolean
  /** The page owns which part is open (one at a time); alone, the card keeps its own state. */
  editing?: boolean
  onEditingChange?: (editing: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const save = useRecordIncidentReview()
  const history = useIncidentStatusHistory(incident.id)
  const [localEditing, setLocalEditing] = useState(false)
  const editing = editingProp ?? localEditing
  const setEditing = (v: boolean) => { setLocalEditing(v); onEditingChange?.(v) }
  const [notes, setNotes] = useState('')
  const [actions, setActions] = useState('')
  const [status, setStatus] = useState<string>(incident.status)
  const [touched, setTouched] = useState(false)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { if (editing) notesRef.current?.focus() }, [editing])
  const dirty = editing && (notes !== (incident.reviewNotes ?? '') || actions !== (incident.correctiveActions ?? '') || status !== incident.status)
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  const reviewed = incident.reviewedAt != null
  const zone = incident.timeZoneId
  const notesError = touched && !notes.trim() ? 'Add review notes.' : undefined

  const open = () => {
    setNotes(incident.reviewNotes ?? '')
    setActions(incident.correctiveActions ?? '')
    setStatus(incident.status)
    setTouched(false)
    save.reset()
    setEditing(true)
  }
  const close = () => {
    setEditing(false)
    // The trigger is unmounted while the form is open; put focus back on it once it is there again.
    requestAnimationFrame(() => triggerRef.current?.focus())
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!notes.trim()) return
    save.mutate(
      { id: incident.id, data: { reviewNotes: notes.trim(), correctiveActions: actions.trim() || undefined, status: status as typeof INCIDENT_STATUSES[number] } },
      { onSuccess: close },
    )
  }

  return (
    <div data-testid="incident-review">
      <Card title="Review">
        {editing ? (
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <TextAreaField
              ref={notesRef}
              label="Review notes"
              required
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => setTouched(true)}
              error={notesError}
            />
            <TextAreaField label="Actions taken" rows={3} value={actions} onChange={(e) => setActions(e.target.value)} />
            <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} />
            {save.isError && <Callout tone="error">Couldn&apos;t save the review. Try again.</Callout>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" size="md" onClick={close} disabled={save.isPending} className="w-full sm:w-auto">Cancel</Button>
              <Button type="submit" size="md" disabled={save.isPending} className="w-full sm:w-auto">{save.isPending ? 'Saving...' : 'Save review'}</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            {reviewed ? (
              <FactList
                items={[
                  { label: 'Reviewed on', value: <span className="tabular-nums">{formatWithTimeZone(incident.reviewedAt, zone, { dateStyle: 'medium' })}</span> },
                  { label: 'Reviewed by', value: incident.reviewedByName || '—' },
                  { label: 'Review notes', value: <span className="whitespace-pre-wrap">{incident.reviewNotes || '—'}</span> },
                  { label: 'Actions taken', value: <span className="whitespace-pre-wrap">{incident.correctiveActions || '—'}</span> },
                ]}
              />
            ) : (
              <p className="text-sm text-[var(--color-muted-foreground)]">Not reviewed yet.</p>
            )}
            {canEdit && (
              <Button ref={triggerRef} variant="secondary" size="md" onClick={open} className="w-full sm:w-auto sm:self-start">
                {reviewed ? 'Update review' : 'Record review'}
              </Button>
            )}
          </div>
        )}

        <section aria-labelledby="incident-status-history" className="mt-4 border-t border-[var(--color-border)] pt-3">
          <h4 id="incident-status-history" className="text-[13px] font-medium mb-2 text-[var(--color-muted-foreground)]">Status history</h4>
          <StatusHistory incident={incident} history={history} />
        </section>
      </Card>
    </div>
  )
}

function StatusHistory({ incident, history }: { incident: IncidentDetailDto; history: ReturnType<typeof useIncidentStatusHistory> }) {
  if (history.isLoading && !retryingAfterError(history)) return <p className="text-sm text-[var(--color-muted-foreground)]">Loading status history...</p>
  if (history.isError || retryingAfterError(history)) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span role="alert">Couldn&apos;t load the status history.</span>
        <Button variant="ghost" size="sm" onClick={() => history.refetch()}>Retry</Button>
      </div>
    )
  }
  const rows = history.data ?? []
  if (rows.length === 0) return <p className="text-sm text-[var(--color-muted-foreground)]">No status changes yet.</p>
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {rows.map((r, i) => (
        <li key={`${r.at}-${i}`} className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="flex flex-wrap items-center gap-1.5">
            {r.from ? (
              <>
                <StatusBadge status={r.from} label={INCIDENT_STATUS_LABELS[r.from]} />
                <span>to</span>
                <StatusBadge status={r.to} label={INCIDENT_STATUS_LABELS[r.to]} />
              </>
            ) : (
              <>
                <span>Reported as</span>
                <StatusBadge status={r.to} label={INCIDENT_STATUS_LABELS[r.to]} />
              </>
            )}
          </span>
          <span className="tabular-nums text-xs text-[var(--color-muted-foreground)]">
            {[r.byName, formatWithTimeZone(r.at, incident.timeZoneId, { dateStyle: 'medium', timeStyle: 'short' })].filter(Boolean).join(' · ')}
          </span>
        </li>
      ))}
    </ol>
  )
}
