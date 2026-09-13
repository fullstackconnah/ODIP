import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MessageSquare, AlertCircle, AlertTriangle, FileCheck } from 'lucide-react'
import { useShiftNotes, useCreateShiftNote, useUpdateShiftNote, useAcknowledgeShiftNoteFlags } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { formatWithTimeZone } from '@/lib/utils'
import type { ShiftNoteDto } from '@/api/types'
import { formatFlaggedCategoryList, type ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'
import type { ShiftNoteIncidentPrefillState } from '@/lib/incidentPrefill'

const BODY_MAX_LENGTH = 1000

const textareaClass = 'w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-shadow'
const primaryButtonClass = 'min-h-[44px] inline-flex items-center justify-center px-4 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2'
const ghostButtonClass = 'min-h-[44px] inline-flex items-center justify-center px-3 rounded-lg text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2'

function formatNoteTimestamp(iso: string): string {
  return formatWithTimeZone(iso, undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function CharCount({ length }: { length: number }) {
  const nearCap = length >= BODY_MAX_LENGTH * 0.9
  return (
    <span className={`text-xs ${nearCap ? 'font-medium text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}`}>
      {length} / {BODY_MAX_LENGTH}
    </span>
  )
}

export interface ShiftNotesSectionProps {
  shiftId: string
  /** NOTES-02: shift/participant context carried into the incident-report prefill hand-off when a flagged note's banner action is used — see ShiftNoteIncidentPrefillState. */
  participantId: string
  participantName: string
  serviceDate: string
  startTime: string
  endTime: string
  endsNextDay: boolean
}

/**
 * NOTES-02 flag banner on one note: "This note mentions X. Consider filing an incident report."
 * Non-blocking — a dismiss action (persisted server-side, see ShiftNote.FlagsAcknowledgedAt) and
 * a "File incident report" action that reuses the INC-03 router-state prefill mechanism. Never
 * auto-files anything; nothing is persisted until the worker/coordinator submits that form.
 */
function FlagBanner({
  note, onFileIncident, onDismiss, dismissing,
}: {
  note: ShiftNoteDto
  onFileIncident: () => void
  onDismiss: () => void
  dismissing: boolean
}) {
  const categories = note.flaggedCategories as ShiftNoteFlagCategory[]
  return (
    <div
      role="status"
      className="mt-2 flex flex-col gap-2 rounded-lg border border-[var(--color-warning-container)] bg-[var(--color-warning-container)]/60 p-3 text-sm text-[var(--color-on-warning-container)] sm:flex-row sm:items-start sm:justify-between"
    >
      <p className="flex items-start gap-1.5">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>This note mentions {formatFlaggedCategoryList(categories)}. Consider filing an incident report.</span>
      </p>
      <div className="flex shrink-0 items-center gap-2 self-end sm:self-start">
        <button type="button" onClick={onDismiss} disabled={dismissing} className={`${ghostButtonClass} px-3`}>
          {dismissing ? 'Dismissing…' : 'Dismiss'}
        </button>
        <button type="button" onClick={onFileIncident} className={`${primaryButtonClass} !bg-[var(--color-on-warning-container)]`}>
          File incident report
        </button>
      </div>
    </div>
  )
}

/**
 * Connection map item 4: once a flagged note has led to an incident (ShiftNoteDto.incidentId
 * set), the FlagBanner's dismiss/file actions no longer apply — the loop is closed. Replaces
 * them with a link into the incident that was filed. Support workers can open incidents per
 * src/lib/permissions.ts (canAccessPage('incidents') includes SupportWorker), so a plain Link
 * is enough here — no extra gating needed.
 */
function IncidentFiledNotice({ incidentId }: { incidentId: string }) {
  return (
    <div
      role="status"
      className="mt-2 flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)]/40 p-3 text-sm text-[var(--color-foreground)]"
    >
      <FileCheck className="w-4 h-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden="true" />
      <span>
        Incident filed —{' '}
        <Link to={`/incidents/${incidentId}`} className="font-medium text-[var(--color-primary)] hover:underline">
          view report
        </Link>
      </span>
    </div>
  )
}

/**
 * NOTES-01 — a "Shift notes" section on the portal shift detail page: existing notes (author +
 * local time) plus an add-note form. Any of the caller's own notes on this shift can be edited
 * in place (author-only, no delete — see ShiftNote remarks on the backend). There is no shift-
 * completion event to gate this on (see PortalController remarks), so the form is always
 * available regardless of shift status.
 *
 * NOTES-02 — flagged, unacknowledged notes (see ShiftNoteDto.flaggedCategories/flagsAcknowledgedAt)
 * render a non-blocking FlagBanner underneath them: dismiss (persisted server-side) or jump to a
 * pre-filled incident report draft via the shared INC-03 prefill mechanism.
 */
export function ShiftNotesSection({
  shiftId, participantId, participantName, serviceDate, startTime, endTime, endsNextDay,
}: ShiftNotesSectionProps) {
  const { data: notes, isLoading, isError, refetch } = useShiftNotes(shiftId)
  const createNote = useCreateShiftNote(shiftId)
  const updateNote = useUpdateShiftNote(shiftId)
  const acknowledgeFlags = useAcknowledgeShiftNoteFlags(shiftId)
  const { id: currentUserId } = usePermissions()
  const navigate = useNavigate()

  const [body, setBody] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    setCreateError(null)
    try {
      await createNote.mutateAsync(trimmed)
      setBody('')
    } catch {
      setCreateError("Couldn't save your note. Check your connection and try again.")
    }
  }

  function startEdit(note: ShiftNoteDto) {
    setEditingId(note.id)
    setEditBody(note.body)
    setEditError(null)
  }

  async function handleSaveEdit(id: string) {
    const trimmed = editBody.trim()
    if (!trimmed) return
    setEditError(null)
    try {
      await updateNote.mutateAsync({ id, body: trimmed })
      setEditingId(null)
    } catch {
      setEditError("Couldn't save your changes. Check your connection and try again.")
    }
  }

  /** NOTES-02 — reuses the INC-03 router-state prefill mechanism; nothing is persisted here, the destination form still has to be submitted. */
  function goToIncident(note: ShiftNoteDto) {
    const prefill: ShiftNoteIncidentPrefillState = {
      source: 'shift-note',
      shiftNoteId: note.id,
      categories: note.flaggedCategories as ShiftNoteFlagCategory[],
      participantId,
      participantName,
      noteBody: note.body,
      serviceDate,
      startTime,
      endTime,
      endsNextDay,
      reportedByUserId: currentUserId,
      shiftId,
    }
    navigate('/incidents/new', { state: prefill })
  }

  function dismissFlags(noteId: string) {
    acknowledgeFlags.mutate(noteId)
  }

  return (
    <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Shift notes</h2>

      {isLoading ? (
        <div className="space-y-2" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading shift notes…</span>
          <div aria-hidden="true" className="space-y-2">
            <div className="h-4 w-full rounded bg-[var(--color-accent)] animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-[var(--color-accent)] animate-pulse" />
          </div>
        </div>
      ) : isError ? (
        <div role="alert" className="flex items-center justify-between gap-3 text-sm text-[var(--color-destructive)]">
          <span className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4 shrink-0" /> Couldn't load shift notes.</span>
          <button type="button" onClick={() => refetch()} className={ghostButtonClass}>Try again</button>
        </div>
      ) : notes && notes.length > 0 ? (
        <ul className="space-y-2">
          {notes.map(note => (
            <li key={note.id} className="rounded-sm border border-[var(--color-border)] px-3 py-2 text-sm">
              {editingId === note.id ? (
                <div className="space-y-2">
                  <label htmlFor={`edit-note-${note.id}`} className="sr-only">Edit note</label>
                  <textarea
                    id={`edit-note-${note.id}`}
                    value={editBody}
                    onChange={e => setEditBody(e.target.value.slice(0, BODY_MAX_LENGTH))}
                    rows={3}
                    className={textareaClass}
                    aria-invalid={!!editError}
                    aria-describedby={editError ? `edit-note-error-${note.id}` : undefined}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <CharCount length={editBody.length} />
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setEditingId(null)} className={ghostButtonClass}>Cancel</button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(note.id)}
                        disabled={updateNote.isPending || !editBody.trim()}
                        className={primaryButtonClass}
                      >
                        {updateNote.isPending ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                  {editError && <p id={`edit-note-error-${note.id}`} role="alert" className="text-xs text-[var(--color-destructive)]">{editError}</p>}
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      <span className="font-medium text-[var(--color-foreground)]">{note.authorName}</span> · {formatNoteTimestamp(note.createdAt)}
                      {note.updatedAt > note.createdAt && ` · edited ${formatNoteTimestamp(note.updatedAt)}`}
                    </p>
                    {note.authorUserId === currentUserId && (
                      <button
                        type="button"
                        onClick={() => startEdit(note)}
                        className="shrink-0 min-h-[44px] px-2 -my-2 text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
                  {note.flaggedCategories.length > 0 && (
                    note.incidentId ? (
                      <IncidentFiledNotice incidentId={note.incidentId} />
                    ) : !note.flagsAcknowledgedAt && (
                      <FlagBanner
                        note={note}
                        onFileIncident={() => goToIncident(note)}
                        onDismiss={() => dismissFlags(note.id)}
                        dismissing={acknowledgeFlags.isPending && acknowledgeFlags.variables === note.id}
                      />
                    )
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--color-muted-foreground)]">No notes yet for this shift.</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-2 pt-3 border-t border-[var(--color-border)]">
        <label htmlFor="new-shift-note-body" className="block text-sm font-medium text-[var(--color-foreground)]">Add a note</label>
        <textarea
          id="new-shift-note-body"
          value={body}
          onChange={e => setBody(e.target.value.slice(0, BODY_MAX_LENGTH))}
          rows={3}
          placeholder="Anything worth handing over about this shift…"
          className={textareaClass}
          aria-invalid={!!createError}
          aria-describedby={createError ? 'new-shift-note-error' : undefined}
        />
        <div className="flex items-center justify-between gap-2">
          <CharCount length={body.length} />
          <button type="submit" disabled={createNote.isPending || !body.trim()} className={primaryButtonClass}>
            {createNote.isPending ? 'Saving…' : 'Add note'}
          </button>
        </div>
        {createError && <p id="new-shift-note-error" role="alert" className="text-sm text-[var(--color-destructive)]">{createError}</p>}
      </form>
    </div>
  )
}
