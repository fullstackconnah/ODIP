import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  useCreateStaffAvailability, useUpdateStaffAvailability, useDeleteStaffAvailability,
} from '../../api/hooks'
import { toDateInput, toStartDt, toEndDt } from './helpers'
import type { StaffAvailabilityDto } from '@/api/types'

const availTypeColors: Record<string, string> = {
  Available:   'text-emerald-600 bg-emerald-50',
  Unavailable: 'text-[#ba1a1a] bg-[#ffdad6]/60',
  Leave:       'text-[#ba1a1a] bg-[#ffdad6]/60',
  Training:    'text-[#8e337b] bg-[#ffd7ef]/60',
  Preferred:   'text-[var(--color-secondary)] bg-[var(--color-secondary-container)]/40',
  Tentative:   'text-amber-700 bg-amber-50',
}

interface AvailabilityEditorProps {
  staffId: string
  availability: StaffAvailabilityDto[]
}

export default function AvailabilityEditor({ staffId, availability }: AvailabilityEditorProps) {
  const createAvail = useCreateStaffAvailability()
  const updateAvail = useUpdateStaffAvailability()
  const deleteAvail = useDeleteStaffAvailability()

  const [edits, setEdits] = useState<Record<string, { startDate: string; endDate: string; notes: string }>>({})
  const [adding, setAdding] = useState<{ startDate: string; endDate: string; notes: string } | null>(null)

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
  }

  function handleSave(a: StaffAvailabilityDto) {
    const e = getEdit(a)
    if (!e.startDate || !e.endDate || e.endDate < e.startDate) return
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

  function handleDelete(id: string) {
    deleteAvail.mutate(id, {
      onSuccess: () => setEdits(prev => { const next = { ...prev }; delete next[id]; return next }),
    })
  }

  function handleAdd() {
    if (!adding || !adding.startDate || !adding.endDate || adding.endDate < adding.startDate) return
    createAvail.mutate({
      staffId,
      startDateTime: toStartDt(adding.startDate),
      endDateTime: toEndDt(adding.endDate),
      availabilityType: 'Leave',
      isRecurring: false,
      notes: adding.notes || undefined,
    }, { onSuccess: () => setAdding(null) })
  }

  const dateInputClass = 'px-2 py-1 rounded-lg bg-[var(--color-surface-container-low)] border-none outline-none text-xs focus:ring-2 focus:ring-[var(--color-primary)]/30'
  const notesInputClass = 'flex-1 px-2 py-1 rounded-lg bg-[var(--color-surface-container-low)] border-none outline-none text-xs focus:ring-2 focus:ring-[var(--color-primary)]/30'

  return (
    <div className="pl-8 py-3">
      <p className="text-xs font-semibold text-[var(--color-muted-foreground)] mb-3 uppercase tracking-wide">Availability Records</p>
      <div className="space-y-2">
        {availability.length === 0 && !adding && (
          <p className="text-xs text-[var(--color-muted-foreground)] italic py-1">No availability records</p>
        )}
        {availability.map((a: StaffAvailabilityDto) => {
          const e = getEdit(a)
          const dirty = isDirty(a)
          const colorClass = availTypeColors[a.availabilityType] ?? 'text-[var(--color-muted-foreground)] bg-[var(--color-surface-container)]'
          return (
            <div key={a.id} className="flex items-center gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold min-w-[72px] text-center ${colorClass}`}>
                {a.availabilityType}
              </span>
              <input type="date" value={e.startDate}
                onChange={ev => patchEdit(a.id, { startDate: ev.target.value }, a)}
                className={dateInputClass}
              />
              <span className="text-[var(--color-muted-foreground)]">—</span>
              <input type="date" value={e.endDate}
                onChange={ev => patchEdit(a.id, { endDate: ev.target.value }, a)}
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
                onClick={() => handleDelete(a.id)}
                disabled={deleteAvail.isPending}
                title="Delete"
                className="p-1 rounded-full hover:bg-[#ffdad6]/60 text-[var(--color-muted-foreground)] hover:text-[#ba1a1a] transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )
        })}
        {!adding && (
          <button
            onClick={() => setAdding({ startDate: '', endDate: '', notes: '' })}
            className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1 mt-2"
          >
            <Plus className="w-3 h-3" /> Add Leave
          </button>
        )}
        {adding && (
          <div className="flex items-center gap-2 text-xs border-t border-[var(--color-surface-container)] pt-2 mt-1">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold min-w-[72px] text-center text-[#ba1a1a] bg-[#ffdad6]/60">
              Leave
            </span>
            <input type="date" value={adding.startDate}
              onChange={e => setAdding(prev => prev ? { ...prev, startDate: e.target.value } : null)}
              className={dateInputClass}
            />
            <span className="text-[var(--color-muted-foreground)]">—</span>
            <input type="date" value={adding.endDate}
              onChange={e => setAdding(prev => prev ? { ...prev, endDate: e.target.value } : null)}
              className={dateInputClass}
            />
            <input type="text" value={adding.notes} placeholder="Notes…"
              onChange={e => setAdding(prev => prev ? { ...prev, notes: e.target.value } : null)}
              className={notesInputClass}
            />
            <button
              onClick={handleAdd}
              disabled={!adding.startDate || !adding.endDate || adding.endDate < adding.startDate || createAvail.isPending}
              className="px-3 py-0.5 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {createAvail.isPending ? '…' : 'Save'}
            </button>
            <button
              onClick={() => setAdding(null)}
              className="px-3 py-0.5 rounded-full bg-[var(--color-surface-container)] text-[10px] hover:bg-[var(--color-surface-container-high)] transition-colors text-[var(--color-foreground)]"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
