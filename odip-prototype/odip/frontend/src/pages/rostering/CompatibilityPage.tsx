import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Pencil, Undo2, Users, X } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { SearchInput } from '@/components/SearchInput'
import { SearchableSelect } from '@/components/SearchableSelect'
import { ParticipantPicker } from '@/components/ParticipantPicker'
import { StatusBadge } from '@/components/StatusBadge'
import { ToggleGroup } from '@/components/ToggleGroup'
import { useShowAll } from '@/components/ShowAllButton'
import { DataTable, RowMenu, type Column } from '@/components/DataTable'
import { TAP_FLOOR } from '@/components/tapArea'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'
import type { Tone } from '@/lib/tone'
import { useAllCompatibility, useParticipants, useStaff, useUpsertCompatibility } from '@/api/hooks'
import { CAN_RECEIVE_SERVICES } from '@/api/types/participants'
import type { CompatibilityLevel, CompatibilityRowDto } from '@/api/types'

// Only Preferred (green) and No (red) carry colour; Backup and Emergency stay neutral, as on the participant card.
const MARK: Record<Exclude<CompatibilityLevel, 'Allowed'>, { label: string; tone: Tone }> = {
  Preferred: { label: 'Preferred', tone: 'success' },
  Backup: { label: 'Backup', tone: 'neutral' },
  Emergency: { label: 'Emergency', tone: 'neutral' },
  Excluded: { label: 'No', tone: 'danger' },
}

type View = 'all' | 'no' | 'prefs'

type Draft = { staffId: string; participantId: string; reason: string; fixedPair: boolean }

export default function CompatibilityPage() {
  const { canWrite } = usePermissions()
  const [params] = useSearchParams()
  // INTAKE-08: drafts are out; the list keeps today's scope (active staff, ready participants).
  const participants = useParticipants(CAN_RECEIVE_SERVICES)
  const staff = useStaff()
  const all = useAllCompatibility()
  const upsert = useUpsertCompatibility()

  const [query, setQuery] = useState(params.get('q') ?? '')
  const [view, setView] = useState<View>('all')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<CompatibilityRowDto | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const tableRef = useRef<HTMLDivElement>(null)

  const activeStaff = useMemo(
    () => (staff.data ?? []).filter(s => s.isActive !== false).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [staff.data],
  )
  const inScope = useMemo(() => {
    const staffIds = new Set(activeStaff.map(s => s.id))
    const participantIds = new Set((participants.data ?? []).map(p => p.id))
    // Allowed rows are kept by the server (the upsert never deletes): they are the default, not an exception.
    return (all.data ?? []).filter(r => r.level !== 'Allowed' && staffIds.has(r.staffId) && participantIds.has(r.participantId))
  }, [all.data, activeStaff, participants.data])

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? inScope.filter(r => r.staffName.toLowerCase().includes(q) || r.participantName.toLowerCase().includes(q)) : inScope
  }, [inScope, query])
  const noCount = searched.filter(r => r.level === 'Excluded').length
  const rows = view === 'no' ? searched.filter(r => r.level === 'Excluded') : view === 'prefs' ? searched.filter(r => r.level !== 'Excluded') : searched
  const showAll = useShowAll(rows.length, tableRef, 'tbody tr')

  const isLoading = participants.isLoading || staff.isLoading || all.isLoading
  const isError = participants.isError || staff.isError || all.isError
  const noPeopleYet = !isLoading && !isError && (activeStaff.length === 0 || (participants.data ?? []).length === 0)

  const pair = draft && inScope.find(r => r.staffId === draft.staffId && r.participantId === draft.participantId)
  const staffName = (id: string) => activeStaff.find(s => s.id === id)?.fullName ?? ''
  const participantName = (id: string) => (participants.data ?? []).find(p => p.id === id)?.fullName ?? ''
  const editing = !!draft && (draft.fixedPair || pair?.level === 'Excluded')

  function openNew() {
    setDialogError(null)
    setDraft({ staffId: '', participantId: '', reason: '', fixedPair: false })
  }

  function pick(next: Partial<Draft>) {
    setDraft(d => {
      if (!d) return d
      const merged = { ...d, ...next }
      // Choosing a pair that is already No opens it as an edit, with the reason kept.
      const existing = inScope.find(r => r.staffId === merged.staffId && r.participantId === merged.participantId && r.level === 'Excluded')
      return existing && !d.reason ? { ...merged, reason: existing.reason ?? '' } : merged
    })
  }

  function submit() {
    if (!draft) return
    const reason = draft.reason.trim()
    upsert.mutate(
      { staffId: draft.staffId, participantId: draft.participantId, level: 'Excluded', reason },
      {
        onSuccess: () => {
          setAnnouncement(editing ? 'Reason saved.' : `Marked No: ${staffName(draft.staffId)} and ${participantName(draft.participantId)}.`)
          setDraft(null)
        },
        onError: err => setDialogError(extractErrorMessage(err, "Couldn't save that change. Please try again.")),
      },
    )
  }

  function confirmRemove() {
    if (!removing) return
    const row = removing
    setSaveError(null)
    upsert.mutate(
      { staffId: row.staffId, participantId: row.participantId, level: 'Allowed', reason: null },
      {
        onSuccess: () => setAnnouncement(`Removed No: ${row.staffName} and ${row.participantName}.`),
        onError: err => setSaveError(extractErrorMessage(err, "Couldn't save that change. Please try again.")),
      },
    )
    setRemoving(null)
  }

  const columns: Column<CompatibilityRowDto & { id: string }>[] = [
    {
      key: 'participantName', header: 'Participant', minWidth: '11rem', mobile: 'primary',
      render: r => (
        <Link
          to={`/participants/${r.participantId}?tab=roster`}
          className={`${TAP_FLOOR} font-medium text-[var(--color-foreground)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-sm`}
        >
          {r.participantName}
        </Link>
      ),
    },
    { key: 'staffName', header: 'Staff', minWidth: '11rem', mobile: 'meta' },
    {
      key: 'level', header: 'Mark', width: '7rem', mobile: 'status',
      render: r => <StatusBadge tone={MARK[r.level as keyof typeof MARK].tone} label={MARK[r.level as keyof typeof MARK].label} />,
    },
    {
      key: 'reason', header: 'Reason', wrap: true, maxWidth: '40rem', mobile: 'meta', hideWhenEmpty: true,
      render: r => r.reason || '—',
    },
    { key: 'updatedAt', header: 'Updated', type: 'date', width: '7rem', mobile: 'meta' },
    ...(canWrite ? [{
      key: 'actions', header: '', overlay: true, mobile: 'trail' as const,
      render: (r: CompatibilityRowDto & { id: string }) => r.level !== 'Excluded' ? null : (
        <RowMenu
          name={`${r.staffName} and ${r.participantName}`}
          items={[
            { label: 'Edit reason', icon: <Pencil className="w-4 h-4" aria-hidden="true" />, onSelect: () => { setDialogError(null); setDraft({ staffId: r.staffId, participantId: r.participantId, reason: r.reason ?? '', fixedPair: true }) } },
            { label: 'Remove No', icon: <Undo2 className="w-4 h-4" aria-hidden="true" />, onSelect: () => setRemoving(r) },
          ]}
        />
      ),
    }] : []),
  ]

  const nothingMarked = !isLoading && !isError && !noPeopleYet && inScope.length === 0

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Compatibility"
        subtitle="Pairings that differ from the default. A worker marked No can’t be rostered for that participant."
        count={isLoading || isError ? undefined : inScope.length}
        action={canWrite && !noPeopleYet ? <Button onClick={openNew}>Mark as No</Button> : undefined}
      />

      {saveError && (
        <Callout
          tone="error"
          actions={
            <Button variant="ghost" size="sm" iconOnly onClick={() => setSaveError(null)} aria-label="Dismiss error">
              <X className="h-4 w-4" />
            </Button>
          }
        >
          {saveError}
        </Callout>
      )}

      {noPeopleYet && (
        <EmptyState icon={Users} title="Nothing to match yet" description="Add at least one staff member and one participant first." />
      )}

      {nothingMarked && (
        <EmptyState
          icon={Users}
          title="No pairings marked yet"
          description="Every worker can be rostered for every participant. Mark a pairing No when a worker must not work with someone. Preferred, backup and emergency staff are set on each participant’s Rostering tab."
          action={canWrite ? { label: 'Mark as No', onClick: openNew } : undefined}
        />
      )}

      {!noPeopleYet && !nothingMarked && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput value={query} onChange={setQuery} placeholder="Search staff or participants" />
            <ToggleGroup
              ariaLabel="Show"
              disabled={isLoading}
              value={view}
              onChange={key => setView(key as View)}
              options={[
                { key: 'all', label: `All ${searched.length}` },
                { key: 'no', label: `No ${noCount}` },
                { key: 'prefs', label: `Preferences ${searched.length - noCount}` },
              ]}
            />
          </div>
          <div ref={tableRef}>
            <DataTable
              data={rows.map(r => ({ ...r, id: `${r.staffId}:${r.participantId}` }))}
              keyField="id"
              columns={columns}
              sortable={false}
              limit={showAll.limit}
              loading={isLoading}
              error={isError}
              onRetry={() => { participants.refetch(); staff.refetch(); all.refetch() }}
              emptyMessage="No pairings match."
            />
            {showAll.button}
          </div>
        </>
      )}

      <p role="status" className="sr-only">{announcement}</p>

      <ConfirmDialog
        open={draft !== null}
        onCancel={() => setDraft(null)}
        title={editing ? 'Edit reason' : 'Mark as No'}
        message={draft && (
          <>
            <p>
              {draft.staffId && draft.participantId ? (
                <>
                  <strong className="text-foreground">{staffName(draft.staffId)}</strong> cannot be rostered for{' '}
                  <strong className="text-foreground">{participantName(draft.participantId)}</strong>’s shifts. Shifts already rostered stay as they are, but cannot be edited until the worker is replaced or the shift is unassigned or cancelled.
                </>
              ) : (
                'A worker marked No cannot be rostered for that participant’s shifts. Shifts already rostered stay as they are, but cannot be edited until the worker is replaced or the shift is unassigned or cancelled.'
              )}
            </p>
            {!draft.fixedPair && (
              <>
                <FormField label="Staff" required>
                  <SearchableSelect
                    items={activeStaff.map(s => ({ value: s.id, label: s.fullName }))}
                    value={draft.staffId}
                    onChange={staffId => pick({ staffId })}
                    placeholder="Choose a staff member"
                  />
                </FormField>
                <FormField label="Participant" required>
                  <ParticipantPicker value={draft.participantId} onChange={participantId => pick({ participantId })} placeholder="Choose a participant" />
                </FormField>
              </>
            )}
            {pair && pair.level !== 'Excluded' && (
              <p className="text-sm text-muted-foreground">
                {`${pair.staffName} is listed as ${MARK[pair.level as keyof typeof MARK].label} for ${pair.participantName}. Marking No takes them off that list${pair.level === 'Preferred' ? `, and off ${pair.participantName}’s profile as preferred staff member if set` : ''}.`}
              </p>
            )}
            <FormField label="Reason" required hint="Stored with this choice and visible in audit.">
              <textarea
                rows={2}
                value={draft.reason}
                onChange={e => setDraft(d => d && { ...d, reason: e.target.value })}
                placeholder="Why can’t they work together?"
              />
            </FormField>
            {dialogError && <Callout tone="error">{dialogError}</Callout>}
          </>
        )}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              variant={editing ? 'primary' : 'danger'}
              disabled={!draft?.staffId || !draft.participantId || !draft.reason.trim() || upsert.isPending}
              onClick={submit}
            >
              {upsert.isPending ? 'Saving…' : editing ? 'Save reason' : 'Mark as No'}
            </Button>
          </>
        }
      />

      <ConfirmDialog
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
        title="Remove No?"
        message={removing && `${removing.staffName} can be rostered for ${removing.participantName}’s shifts again.`}
        confirmLabel="Remove No"
      />
    </div>
  )
}
