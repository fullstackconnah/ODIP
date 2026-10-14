import { useEffect, useRef, useState } from 'react'
import type { AxiosError } from 'axios'
import { Lock } from 'lucide-react'
import { useCreatePublicHoliday, useDeletePublicHoliday, usePublicHolidays, useSyncHolidays } from '@/api/hooks'
import type { PublicHolidayDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { plural } from '@/lib/format'
import { formatDateAu } from '@/lib/utils'

/**
 * The public holiday calendar. It is global: every tenant's plan quotes and claims read the same rows, and a row decides whether a day is priced at
 * the public holiday rate (+122% on a weekday). So only a SuperAdmin may add, delete or sync rows (the API refuses everyone else); with
 * <code>canEdit</code> false the tab is the calendar to read, with no control that would only fail.
 */
export default function PublicHolidaysSection({ canEdit }: { canEdit: boolean }) {
  const [year, setYear] = useState(new Date().getFullYear())
  const [state, setState] = useState('VIC')
  const { data: holidays = [], isLoading: holidaysLoading, isError: holidaysError, refetch: refetchHolidays } = usePublicHolidays(year, state)
  const createHoliday = useCreatePublicHoliday()
  const deleteHoliday = useDeletePublicHoliday()
  const syncHolidays = useSyncHolidays()
  const [adding, setAdding] = useState(false)
  const [deletingHoliday, setDeletingHoliday] = useState<PublicHolidayDto | null>(null)
  const [newForm, setNewForm] = useState({ date: '', name: '', state: 'VIC' })
  const [showSyncAdvanced, setShowSyncAdvanced] = useState(false)
  const [syncFromYear, setSyncFromYear] = useState<number | undefined>(undefined)
  const [syncToYear, setSyncToYear] = useState<number | undefined>(undefined)
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null)
  // A sync's result line goes away by itself after four seconds. The timer is kept so the next sync can cancel it (it would take the new line down
  // early) and leaving the tab can cancel it: left running it fires setSyncMessage into a tree that is gone.
  const syncMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (syncMessageTimer.current) clearTimeout(syncMessageTimer.current)
    }
  }, [])

  const inputClass = 'px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all'

  function handleAdd() {
    createHoliday.mutate(newForm, {
      onSuccess: () => { setAdding(false); setNewForm({ date: '', name: '', state: 'VIC' }) }
    })
  }

  function handleSync() {
    if (syncMessageTimer.current) clearTimeout(syncMessageTimer.current)
    setSyncMessage(null)
    syncHolidays.mutate(
      { fromYear: syncFromYear, toYear: syncToYear },
      {
        onSuccess: (result) => {
          const errSuffix = result.errors?.length > 0 ? ` (${plural(result.errors.length, 'error')} — check server logs)` : ''
          setSyncMessage({ type: result.errors?.length > 0 ? 'warning' : 'success', text: `Sync complete: ${result.holidaysAdded} added, ${result.holidaysUpdated} updated${errSuffix}` })
          syncMessageTimer.current = setTimeout(() => setSyncMessage(null), 4000)
        },
        onError: (error: Error) => {
          const err = error as AxiosError<{ message?: string }>
          const msg = err?.response?.data?.message || err?.message || 'Sync failed. Please try again.'
          setSyncMessage({ type: 'error', text: msg })
        },
      }
    )
  }

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i)
  const states = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']

  return (
    <div className="space-y-4">
      {!canEdit && (
        <Callout tone="info" icon={Lock} announce={false} className="max-w-prose">
          Only a super admin can change this calendar, because it prices every organisation&apos;s plans and claims.
        </Callout>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown
          variant="form"
          value={String(year)}
          onChange={v => setYear(Number(v))}
          items={years.map(y => ({ value: String(y), label: String(y) }))}
          label="Select year"
        />
        <Dropdown
          variant="form"
          value={state}
          onChange={v => setState(v)}
          items={states.map(s => ({ value: s, label: s }))}
          label="Select state"
        />
        {canEdit && (
          <Button size="md" onClick={() => setAdding(true)}>
            Add holiday
          </Button>
        )}
      </div>

      {canEdit && adding && (
        <div className="bg-[var(--color-card)] rounded-t-2xl border border-b-0 border-[var(--color-border)] p-3">
          <div className="flex items-center gap-3">
            <input type="date" value={newForm.date} onChange={e => setNewForm(p => ({ ...p, date: e.target.value }))} className={inputClass + ' w-40'} />
            <input value={newForm.name} onChange={e => setNewForm(p => ({ ...p, name: e.target.value }))} placeholder="Holiday name" className={inputClass + ' flex-1'} />
            <Dropdown
              variant="form"
              value={newForm.state}
              onChange={v => setNewForm(p => ({ ...p, state: v }))}
              items={states.map(s => ({ value: s, label: s }))}
              label="Select state"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={createHoliday.isPending}>Save</Button>
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
      <DataTable
        data={holidays as PublicHolidayDto[]}
        keyField="id"
        className={adding ? 'relative bg-[var(--color-card)] rounded-b-2xl border border-t-0 border-[var(--color-border)] overflow-x-auto' : undefined}
        sortable
        columns={[
          { key: 'date', header: 'Date', type: 'date' as const, sortable: true, className: 'font-medium' },
          { key: 'name', header: 'Name', sortable: true },
          {
            key: 'state',
            header: 'State',
            render: (h: PublicHolidayDto) => (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent)] text-[var(--color-muted-foreground)]">
                {h.state || 'All'}
              </span>
            ),
          },
          ...(canEdit
            ? [{
                key: 'actions',
                header: '',
                render: (h: PublicHolidayDto) => (
                  <Button variant="ghost-danger" size="sm" onClick={() => setDeletingHoliday(h)} aria-label={`Delete: ${h.name}, ${formatDateAu(h.date)} (${h.state || 'All'})`}>
                    Delete
                  </Button>
                ),
              }]
            : []),
        ]}
        loading={holidaysLoading}
        error={holidaysError}
        onRetry={() => refetchHolidays()}
        emptyMessage={`No holidays found for ${year} in ${state}.`}
      />

      {/* Holiday Sync */}
      {canEdit && (
        <div className="pt-4">
          <div className="flex items-center gap-3">
            <Button size="md" onClick={handleSync} disabled={syncHolidays.isPending}>
              {syncHolidays.isPending ? 'Syncing...' : 'Sync holidays'}
            </Button>
            <button
              type="button"
              onClick={() => setShowSyncAdvanced(v => !v)}
              className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] underline"
            >
              {showSyncAdvanced ? 'Hide advanced' : 'Advanced'}
            </button>
          </div>

          {showSyncAdvanced && (
            <div className="flex items-center gap-3 mt-3">
              <label htmlFor="holiday-sync-from" className="text-sm text-[var(--color-muted-foreground)]">From year</label>
              <input
                id="holiday-sync-from"
                type="number"
                value={syncFromYear ?? ''}
                onChange={e => setSyncFromYear(e.target.value ? Number(e.target.value) : undefined)}
                placeholder={String(new Date().getFullYear())}
                className="w-24 px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
              />
              <label htmlFor="holiday-sync-to" className="text-sm text-[var(--color-muted-foreground)]">To year</label>
              <input
                id="holiday-sync-to"
                type="number"
                value={syncToYear ?? ''}
                onChange={e => setSyncToYear(e.target.value ? Number(e.target.value) : undefined)}
                placeholder={String(new Date().getFullYear() + 1)}
                className="w-24 px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
              />
            </div>
          )}

          {syncMessage && (
            <div className={`mt-3 px-4 py-2.5 rounded-[var(--radius-md)] text-sm ${
              syncMessage.type === 'success'
                ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
                : syncMessage.type === 'warning'
                ? 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]'
                : 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
            }`}>
              {syncMessage.text}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deletingHoliday !== null}
        onCancel={() => setDeletingHoliday(null)}
        onConfirm={() => {
          if (!deletingHoliday) return
          deleteHoliday.mutate(deletingHoliday.id, { onSuccess: () => setDeletingHoliday(null) })
        }}
        title="Delete Public Holiday"
        message={
          deletingHoliday
            ? `Delete the public holiday "${deletingHoliday.name}" on ${formatDateAu(deletingHoliday.date)} (${deletingHoliday.state || 'All states'})? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteHoliday.isPending}
      />
    </div>
  )
}
