import { useMemo, useState } from 'react'
import { StickyNote, Pin, ChevronDown, Plus, Sparkles, AlertTriangle } from 'lucide-react'
import { useParticipantNotes, useCreateNote, useUpdateNote, useDismissNoteDrift, useRegenerateNote } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { EmptyState } from '@/components/EmptyState'
import { usePermissions } from '@/lib/permissions'
import { parseApiDate, extractErrorMessage } from '@/lib/utils'
import { formatRelative } from '@/lib/format'
import type { ParticipantNoteDto } from '@/api/types/notes'

type NoteFormState = { title: string; description: string; isPinned: boolean }
const EMPTY_FORM: NoteFormState = { title: '', description: '', isPinned: false }

function NoteSkeleton() {
  return (
    <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse space-y-2.5">
      <div className="h-4 w-1/3 bg-[var(--color-muted)] rounded" />
      <div className="h-3 w-full bg-[var(--color-muted)] rounded" />
      <div className="h-3 w-2/3 bg-[var(--color-muted)] rounded" />
    </div>
  )
}

function NoteCard({ note, canWrite, onEdit, onArchive, onRestore, onDismissDrift, onRegenerate, isDriftActionPending }: {
  note: ParticipantNoteDto
  canWrite: boolean
  onEdit: () => void
  onArchive: () => void
  onRestore: () => void
  onDismissDrift: () => void
  onRegenerate: () => void
  isDriftActionPending: boolean
}) {
  return (
    <div
      className={`p-4 rounded-xl border border-[var(--color-border)] transition-colors ${
        note.isPinned ? 'bg-[var(--color-surface-container)]' : 'bg-[var(--color-card)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
          {note.isPinned && <Pin className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0" aria-label="Pinned note" />}
          <p className="font-medium text-[var(--color-foreground)] truncate">{note.title}</p>
          {note.sourceKey && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
              <Sparkles className="w-3 h-3" /> Auto-generated
            </span>
          )}
        </div>
        {canWrite && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onEdit}
              className="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
            >
              Edit
            </button>
            {note.isArchived ? (
              <button
                type="button"
                onClick={onRestore}
                className="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
              >
                Restore
              </button>
            ) : (
              <button
                type="button"
                onClick={onArchive}
                className="text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] px-2 py-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
              >
                Archive
              </button>
            )}
          </div>
        )}
      </div>
      <p className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap mt-1.5">{note.description}</p>
      {note.hasSourceDrift && (
        <div className="flex items-start gap-2 mt-3 p-2.5 rounded-lg bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)] border border-[var(--color-warning)]/40 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p>Source data has changed since this note was edited.</p>
            {canWrite && (
              <div className="flex items-center gap-3 mt-1.5">
                <button
                  type="button"
                  onClick={onDismissDrift}
                  disabled={isDriftActionPending}
                  className="font-medium hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={isDriftActionPending}
                  className="font-medium hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
                >
                  Regenerate
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <p className="text-xs text-[var(--color-muted-foreground)] mt-3">
        {note.createdByName ?? 'Unknown'} · {formatRelative(parseApiDate(note.createdAt), { style: 'long' })}
      </p>
    </div>
  )
}

export default function NotesTab({ participantId }: { participantId: string | undefined }) {
  const { canWriteNotes } = usePermissions()
  const [showArchivedSection, setShowArchivedSection] = useState(false)
  const { data: notes = [], isLoading } = useParticipantNotes(participantId, true)
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const dismissDrift = useDismissNoteDrift()
  const regenerateNote = useRegenerateNote()

  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit'; note?: ParticipantNoteDto } | null>(null)
  const [form, setForm] = useState<NoteFormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({})
  const [modalError, setModalError] = useState<string | null>(null)
  const [archivingNote, setArchivingNote] = useState<ParticipantNoteDto | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const activeNotes = useMemo(() => notes.filter(n => !n.isArchived), [notes])
  const archivedNotes = useMemo(() => notes.filter(n => n.isArchived), [notes])

  function openCreate() {
    setForm(EMPTY_FORM)
    setErrors({})
    setModalError(null)
    setModalState({ mode: 'create' })
  }

  function openEdit(note: ParticipantNoteDto) {
    setForm({ title: note.title, description: note.description, isPinned: note.isPinned })
    setErrors({})
    setModalError(null)
    setModalState({ mode: 'edit', note })
  }

  function closeModal() {
    setModalState(null)
    setModalError(null)
  }

  function validate(): boolean {
    const next: { title?: string; description?: string } = {}
    if (!form.title.trim()) next.title = 'Title is required'
    if (!form.description.trim()) next.description = 'Description is required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setModalError(null)
    try {
      if (modalState?.mode === 'edit' && modalState.note) {
        await updateNote.mutateAsync({
          id: modalState.note.id,
          data: {
            title: form.title.trim(),
            description: form.description.trim(),
            isPinned: form.isPinned,
            isArchived: modalState.note.isArchived,
          },
        })
      } else if (participantId) {
        await createNote.mutateAsync({
          participantId,
          data: { title: form.title.trim(), description: form.description.trim(), isPinned: form.isPinned },
        })
      }
      closeModal()
    } catch (err) {
      setModalError(extractErrorMessage(err, 'Failed to save note.'))
    }
  }

  async function confirmArchive() {
    if (!archivingNote) return
    setListError(null)
    try {
      await updateNote.mutateAsync({
        id: archivingNote.id,
        data: {
          title: archivingNote.title,
          description: archivingNote.description,
          isPinned: archivingNote.isPinned,
          isArchived: true,
        },
      })
      setArchivingNote(null)
    } catch (err) {
      setArchivingNote(null)
      setListError(extractErrorMessage(err, 'Failed to archive note.'))
    }
  }

  async function restoreNote(note: ParticipantNoteDto) {
    setListError(null)
    try {
      await updateNote.mutateAsync({
        id: note.id,
        data: {
          title: note.title,
          description: note.description,
          isPinned: note.isPinned,
          isArchived: false,
        },
      })
    } catch (err) {
      setListError(extractErrorMessage(err, 'Failed to restore note.'))
    }
  }

  async function handleDismissDrift(note: ParticipantNoteDto) {
    setListError(null)
    try {
      await dismissDrift.mutateAsync(note.id)
    } catch (err) {
      setListError(extractErrorMessage(err, 'Failed to dismiss the drift hint.'))
    }
  }

  async function handleRegenerate(note: ParticipantNoteDto) {
    setListError(null)
    try {
      await regenerateNote.mutateAsync(note.id)
    } catch (err) {
      setListError(extractErrorMessage(err, 'Failed to regenerate note.'))
    }
  }

  const isSaving = createNote.isPending || updateNote.isPending
  const isDriftActionPending = dismissDrift.isPending || regenerateNote.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[var(--color-foreground)]">Notes</h2>
        {canWriteNotes && participantId && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all shadow-md shadow-[var(--color-primary)]/20"
          >
            <Plus className="w-4 h-4" /> New note
          </button>
        )}
      </div>

      {listError && (
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          <span>{listError}</span>
          <button
            type="button"
            onClick={() => setListError(null)}
            className="shrink-0 text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
          >
            Dismiss
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <NoteSkeleton />
          <NoteSkeleton />
        </div>
      ) : activeNotes.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title="No notes yet"
          description="Capture shift-specific requirements here, like personal care preferences or routines."
          action={canWriteNotes && participantId ? { label: 'New note', onClick: openCreate } : undefined}
        />
      ) : (
        <div className="space-y-3">
          {activeNotes.map(n => (
            <NoteCard key={n.id} note={n} canWrite={canWriteNotes} onEdit={() => openEdit(n)} onArchive={() => setArchivingNote(n)} onRestore={() => restoreNote(n)} onDismissDrift={() => handleDismissDrift(n)} onRegenerate={() => handleRegenerate(n)} isDriftActionPending={isDriftActionPending} />
          ))}
        </div>
      )}

      {archivedNotes.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowArchivedSection(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded transition-colors"
            aria-expanded={showArchivedSection}
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showArchivedSection ? 'rotate-180' : ''}`} />
            Archived ({archivedNotes.length})
          </button>
          {showArchivedSection && (
            <div className="space-y-3 mt-3">
              {archivedNotes.map(n => (
                <NoteCard key={n.id} note={n} canWrite={canWriteNotes} onEdit={() => openEdit(n)} onArchive={() => setArchivingNote(n)} onRestore={() => restoreNote(n)} onDismissDrift={() => handleDismissDrift(n)} onRegenerate={() => handleRegenerate(n)} isDriftActionPending={isDriftActionPending} />
              ))}
            </div>
          )}
        </div>
      )}

      <Modal
        open={!!modalState}
        onClose={closeModal}
        title={modalState?.mode === 'edit' ? 'Edit note' : 'New note'}
        size="md"
        footer={
          <>
            <button
              type="button"
              onClick={closeModal}
              className="min-h-[44px] px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="min-h-[44px] px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all"
            >
              {isSaving ? 'Saving...' : 'Save note'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && (
            <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
              {modalError}
            </div>
          )}
          <FormField label="Title" required error={errors.title}>
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Morning routine"
              autoFocus
            />
          </FormField>
          <FormField label="Description" required error={errors.description}>
            <textarea
              rows={5}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Details staff should know on shift..."
            />
          </FormField>
          <FormField label="Pin this note" layout="checkbox" hint="Pinned notes stay at the top — use for critical care information">
            <input
              type="checkbox"
              checked={form.isPinned}
              onChange={e => setForm(f => ({ ...f, isPinned: e.target.checked }))}
              className="w-4 h-4 rounded border-[var(--color-border)]"
            />
          </FormField>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!archivingNote}
        onCancel={() => setArchivingNote(null)}
        onConfirm={confirmArchive}
        title={`Archive "${archivingNote?.title ?? ''}"?`}
        message="This note will be retained, not deleted — you can still view it in the Archived section below."
        confirmLabel="Archive"
        variant="danger"
        loading={updateNote.isPending}
      />
    </div>
  )
}
