import { useState, type FormEvent } from 'react'
import { MessageSquare, AlertCircle } from 'lucide-react'
import { useShiftNotes, useCreateShiftNote, useUpdateShiftNote } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { formatWithTimeZone } from '@/lib/utils'
import type { ShiftNoteDto } from '@/api/types'

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

/**
 * NOTES-01 — a "Shift notes" section on the portal shift detail page: existing notes (author +
 * local time) plus an add-note form. Any of the caller's own notes on this shift can be edited
 * in place (author-only, no delete — see ShiftNote remarks on the backend). There is no shift-
 * completion event to gate this on (see PortalController remarks), so the form is always
 * available regardless of shift status.
 */
export function ShiftNotesSection({ shiftId }: { shiftId: string }) {
  const { data: notes, isLoading, isError, refetch } = useShiftNotes(shiftId)
  const createNote = useCreateShiftNote(shiftId)
  const updateNote = useUpdateShiftNote(shiftId)
  const { id: currentUserId } = usePermissions()

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
