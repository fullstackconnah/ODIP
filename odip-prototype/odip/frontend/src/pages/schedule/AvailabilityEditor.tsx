import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import {
  useUpdateStaffAvailability, useDeleteStaffAvailability,
} from '../../api/hooks'
import { toDateInput, toStartDt, toEndDt, formatDate } from './helpers'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { StaffAvailabilityDto } from '@/api/types'

const availTypeColors: Record<string, string> = {
  Available:   'text-emerald-600 bg-emerald-50',
  Unavailable: 'text-[var(--color-destructive)] bg-[var(--color-error-container)]/60',
  Leave:       'text-[var(--color-destructive)] bg-[var(--color-error-container)]/60',
  // #8e337b (the text color) has no token equivalent in index.css — left as a literal hex.
  // The background half (#ffd7ef) does match --color-accessible-container exactly.
  Training:    'text-[#8e337b] bg-[var(--color-accessible-container)]/60',
  Preferred:   'text-[var(--color-secondary)] bg-[var(--color-secondary-container)]/40',
  Tentative:   'text-amber-700 bg-amber-50',
}

interface AvailabilityEditorProps {
  staffId: string
  staffName: string
  availability: StaffAvailabilityDto[]
}

export default function AvailabilityEditor({ staffId, staffName, availability }: AvailabilityEditorProps) {
  const updateAvail = useUpdateStaffAvailability()
  const deleteAvail = useDeleteStaffAvailability()

  const [edits, setEdits] = useState<Record<string, { startDate: string; endDate: string; notes: string }>>({})
  const [deletingAvail, setDeletingAvail] = useState<StaffAvailabilityDto | null>(null)
  const [rangeErrors, setRangeErrors] = useState<Record<string, string>>({})

  function getEdit(a: StaffAvailabilityDto) {
    return edits[a.id] ?? {
      startDate: toDateInput(a.startDateTime),
      endDate: toDateInput(a.endDateTime),
      notes: a.notes ?? '',
    }
  }

  function isDirty(a: StaffAvailabilityDto) {
    const e = edits[a.id]
    if (!e) return false
    return (
      e.startDate !== toDateInput(a.startDateTime) ||
      e.endDate !== toDateInput(a.endDateTime) ||
      e.notes !== (a.notes ?? '')
    )
  }

  function patchEdit(id: string, patch: Partial<{ startDate: string; endDate: string; notes: string }>, base: StaffAvailabilityDto) {
    setEdits(prev => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { startDate: toDateInput(base.startDateTime), endDate: toDateInput(base.endDateTime), notes: base.notes ?? '' }),
        ...patch,
      },
    }))
    // Clear any stale range error for this row now that its dates have changed — it's
    // re-validated on the next Save.
    setRangeErrors(prev => { if (!(id in prev)) return prev; const next = { ...prev }; delete next[id]; return next })
  }

  function handleSave(a: StaffAvailabilityDto) {
    const e = getEdit(a)
    if (!e.startDate || !e.endDate || e.endDate < e.startDate) {
      setRangeErrors(prev => ({ ...prev, [a.id]: 'End date must be on or after the start date.' }))
      return
    }
    setRangeErrors(prev => { if (!(a.id in prev)) return prev; const next = { ...prev }; delete next[a.id]; return next })
    updateAvail.mutate({
      id: a.id,
      data: {
        staffId,
        startDateTime: toStartDt(e.startDate),
        endDateTime: toEndDt(e.endDate),
        availabilityType: a.availabilityType,
        isRecurring: a.isRecurring ?? false,
        recurrenceNotes: a.recurrenceNotes ?? undefined,
        notes: e.notes || undefined,
      },
    }, {
      onSuccess: () => setEdits(prev => { const next = { ...prev }; delete next[a.id]; return next }),
    })
  }

  function handleDelete(a: StaffAvailabilityDto) {
    setDeletingAvail(a)
  }

  function confirmDelete() {
    if (!deletingAvail) return
    const id = deletingAvail.id
    deleteAvail.mutate(id, {
      onSuccess: () => {
        setEdits(prev => { const next = { ...prev }; delete next[id]; return next })
        setDeletingAvail(null)
      },
    })
  }

  const dateInputClass = 'px-2 py-1 rounded-lg bg-[var(--color-surface-container-low)] border-none outline-none text-xs focus:ring-2 focus:ring-[var(--color-ring)]'
  const notesInputClass = 'flex-1 px-2 py-1 rounded-lg bg-[var(--color-surface-container-low)] border-none outline-none text-xs focus:ring-2 focus:ring-[var(--color-ring)]'

  return (
    <div className="pl-8 py-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide">Availability Records</p>
        <Link to="/rostering/leave" className="text-xs text-[var(--color-primary)] hover:underline">
          Manage leave requests →
        </Link>
      </div>
      <div className="space-y-2">
        {availability.length === 0 && (
          <p className="text-xs text-[var(--color-muted-foreground)] italic py-1">
            No availability records. Leave requests are now managed on the{' '}
            <Link to="/rostering/leave" className="text-[var(--color-primary)] hover:underline">Leave approvals</Link> page.
          </p>
        )}
        {availability.map((a: StaffAvailabilityDto) => {
          const e = getEdit(a)
          const dirty = isDirty(a)
          const colorClass = availTypeColors[a.availabilityType] ?? 'text-[var(--color-muted-foreground)] bg-[var(--color-surface-container)]'
          const rangeError = rangeErrors[a.id]
          return (
            <div key={a.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold min-w-[72px] text-center ${colorClass}`}>
                {a.availabilityType}
              </span>
              <input type="date" value={e.startDate}
                onChange={ev => patchEdit(a.id, { startDate: ev.target.value }, a)}
                aria-invalid={rangeError ? 'true' : undefined}
                className={dateInputClass}
              />
              <span className="text-[var(--color-muted-foreground)]">—</span>
              <input type="date" value={e.endDate}
                onChange={ev => patchEdit(a.id, { endDate: ev.target.value }, a)}
                aria-invalid={rangeError ? 'true' : undefined}
                className={dateInputClass}
              />
              <input type="text" value={e.notes} placeholder="Notes…"
                onChange={ev => patchEdit(a.id, { notes: ev.target.value }, a)}
                className={notesInputClass}
              />
              {dirty && (
                <button
                  onClick={() => handleSave(a)}
                  disabled={updateAvail.isPending}
                  className="px-3 py-0.5 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  Save
                </button>
              )}
              <button
                onClick={() => handleDelete(a)}
                disabled={deleteAvail.isPending}
                title="Delete"
                className="p-1 rounded-full hover:bg-[var(--color-error-container)]/60 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            {rangeError && (
              <p role="alert" className="pl-[80px] text-[10px] text-[var(--color-destructive)]">
                {rangeError}
              </p>
            )}
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={deletingAvail !== null}
        onCancel={() => setDeletingAvail(null)}
        onConfirm={confirmDelete}
        title="Delete Availability Record"
        message={
          deletingAvail
            ? `Delete the ${deletingAvail.availabilityType} record for ${staffName} (${formatDate(toDateInput(deletingAvail.startDateTime))} – ${formatDate(toDateInput(deletingAvail.endDateTime))})? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteAvail.isPending}
      />
    </div>
  )
}
