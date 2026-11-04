import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Users, X } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { SearchInput } from '@/components/SearchInput'
import { SearchableSelect } from '@/components/SearchableSelect'
import { ParticipantPicker } from '@/components/ParticipantPicker'
import { ToggleGroup } from '@/components/ToggleGroup'
import { BackButton } from '@/components/BackButton'
import { PageState } from '@/components/PageState'
import { usePermissions } from '@/lib/permissions'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { cn, extractErrorMessage } from '@/lib/utils'
import type { Tone } from '@/lib/tone'
import { useAllCompatibility, useParticipants, useStaff, useUpsertCompatibility } from '@/api/hooks'
import { CAN_RECEIVE_SERVICES } from '@/api/types/participants'
import type { CompatibilityLevel, CompatibilityRowDto } from '@/api/types'
import { TierBoard } from './components/TierBoard'
import { CompatibilityMatrix, type NoUndo } from './components/CompatibilityMatrix'
import { CompatibilityReachLine } from './components/CompatibilityReachLine'

// Only Preferred (green) and No (red) carry colour; Backup and Emergency stay neutral, as on the participant card.
const MARK: Record<Exclude<CompatibilityLevel, 'Allowed'>, { label: string; tone: Tone }> = {
  Preferred: { label: 'Preferred', tone: 'success' },
  Backup: { label: 'Backup', tone: 'neutral' },
  Emergency: { label: 'Emergency', tone: 'neutral' },
  Excluded: { label: 'No', tone: 'danger' },
}

// fixedPair: both people are known (the dialog shows no pickers). fixedParticipant: only the participant is (the board's "+ Mark No").
type Draft = { staffId: string; participantId: string; reason: string; fixedPair: boolean; fixedParticipant?: boolean }

export default function CompatibilityPage() {
  const { canWrite, isAdmin } = usePermissions()
  const [params, setParams] = useSearchParams()
  // An old ?view=all link opens the table. The table needs room: below md the board is the one view.
  const belowMd = useIsBelowMd()
  const tableView = params.get('view') === 'table' || params.get('view') === 'all'
  const showTable = tableView && !belowMd
  // INTAKE-08: drafts are out; the list keeps today's scope (active staff, ready participants).
  const participants = useParticipants(CAN_RECEIVE_SERVICES)
  const staff = useStaff()
  const all = useAllCompatibility()
  const upsert = useUpsertCompatibility()

  const [query, setQuery] = useState(params.get('q') ?? '')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<CompatibilityRowDto | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [noUndo, setNoUndo] = useState<NoUndo | null>(null)
  if (!showTable && noUndo) setNoUndo(null) // leaving the table drops its Undo

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

  // The board's participant list: the same scope, filtered by the search, with each one's counts.
  const counts = useMemo(() => {
    const m = new Map<string, { listed: number; no: number }>()
    for (const r of inScope) {
      const c = m.get(r.participantId) ?? { listed: 0, no: 0 }
      if (r.level === 'Excluded') c.no++
      else c.listed++
      m.set(r.participantId, c)
    }
    return m
  }, [inScope])
  const listed = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (participants.data ?? []).filter(p => !q || p.fullName.toLowerCase().includes(q))
  }, [participants.data, query])
  const chosen = (participants.data ?? []).find(p => p.id === params.get('participant'))
  const current = chosen ?? listed[0]   // from md up the first participant shows without writing the URL
  const setParam = (key: string, value: string | null) =>
    setParams(p => { const n = new URLSearchParams(p); if (value) n.set(key, value); else n.delete(key); return n }, { replace: true })
  const metaFor = (id: string) => {
    if (all.isLoading) return ''
    const c = counts.get(id)
    return [c?.listed && `${c.listed} listed`, c?.no && `${c.no} No`].filter(Boolean).join(' · ') || 'Nothing listed'
  }

  const isLoading = participants.isLoading || staff.isLoading || all.isLoading
  const isError = participants.isError || staff.isError || all.isError
  const noPeopleYet = !isLoading && !isError && (activeStaff.length === 0 || (participants.data ?? []).length === 0)

  const pair = draft && inScope.find(r => r.staffId === draft.staffId && r.participantId === draft.participantId)
  const staffName = (id: string) => activeStaff.find(s => s.id === id)?.fullName ?? ''
  const participantName = (id: string) => (participants.data ?? []).find(p => p.id === id)?.fullName ?? ''
  // Only a pair that is already No is an edit: marking No from a chip fixes both people but is still a new mark.
  const editing = pair?.level === 'Excluded'

  function openNew(next: Partial<Draft> = {}) {
    setDialogError(null)
    setDraft({ staffId: '', participantId: '', reason: '', fixedPair: false, ...next })
  }

  function openEdit(r: CompatibilityRowDto) {
    setDialogError(null)
    setDraft({ staffId: r.staffId, participantId: r.participantId, reason: r.reason ?? '', fixedPair: true })
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

  // The table's Undo puts the pair back as `before` had it (no row: Allowed). The board has no Undo.
  function offerUndo(staffId: string, participantId: string, before: CompatibilityRowDto | undefined, message: string) {
    if (!showTable) return
    const level = before?.level ?? 'Allowed'
    const rank = before && before.rank > 0 ? before.rank : null
    setNoUndo({ message, writes: [{ staffId, participantId, level, rank, reason: before?.reason ?? null }] })
  }

  function submit() {
    if (!draft) return
    const reason = draft.reason.trim()
    upsert.mutate(
      { staffId: draft.staffId, participantId: draft.participantId, level: 'Excluded', reason },
      {
        onSuccess: () => {
          const message = editing ? 'Reason saved.' : `Marked No: ${staffName(draft.staffId)} and ${participantName(draft.participantId)}.`
          setAnnouncement(message)
          offerUndo(draft.staffId, draft.participantId, pair || undefined, message)
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
        onSuccess: () => {
          const message = `Removed No: ${row.staffName} and ${row.participantName}.`
          setAnnouncement(message)
          offerUndo(row.staffId, row.participantId, row, message)
        },
        onError: err => setSaveError(extractErrorMessage(err, "Couldn't save that change. Please try again.")),
      },
    )
    setRemoving(null)
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Compatibility"
        subtitle="Pairings that differ from the default. A worker marked No can’t be rostered for that participant."
        count={isLoading || isError ? undefined : inScope.length}
        action={canWrite && !noPeopleYet ? <Button onClick={() => openNew()}>Mark as No</Button> : undefined}
      />

      <CompatibilityReachLine canChange={isAdmin} />

      {!noPeopleYet && (
        <ToggleGroup
          className="max-md:hidden"
          ariaLabel="View"
          value={tableView ? 'table' : 'participant'}
          onChange={key => setParam('view', key === 'table' ? 'table' : null)}
          options={[{ key: 'participant', label: 'By participant' }, { key: 'table', label: 'Table' }]}
        />
      )}

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

      {!noPeopleYet && !showTable && (
        <div className="md:grid md:grid-cols-[15.5rem_minmax(0,1fr)] md:items-start md:gap-6">
          {/* Below md the list and the board are two steps: the list until a participant is chosen, then the board. */}
          <nav aria-label="Participants" className={cn('space-y-2 md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:overflow-y-auto', chosen && 'max-md:hidden')}>
            <SearchInput value={query} onChange={setQuery} placeholder="Search participants" className="w-full" />
            {listed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No participants match “{query.trim()}”.</p>
            ) : (
              <ul>
                {listed.map(p => (
                  <li key={p.id}>
                    <Link
                      to={{ search: `?${new URLSearchParams({ ...Object.fromEntries(params), participant: p.id })}` }}
                      aria-current={p.id === current?.id ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 flex-col justify-center rounded-[var(--radius-sm)] px-3 py-1 hover:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]',
                        p.id === current?.id && 'bg-[var(--color-accent)]',
                      )}
                    >
                      <span className="text-sm font-medium">{p.fullName}</span>
                      <span className="text-xs text-muted-foreground">{metaFor(p.id)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </nav>
          {current && (
            <div className={cn('min-w-0 space-y-4', !chosen && 'max-md:hidden')}>
              <BackButton variant="link" label="participants" onBack={() => setParam('participant', null)} className="md:hidden" />
              <h2 className="text-lg font-semibold">{current.fullName}</h2>
              <TierBoard
                key={current.id}
                participantId={current.id}
                participantName={current.fullName}
                onMarkNo={staffId => openNew(staffId ? { staffId, participantId: current.id, fixedPair: true } : { participantId: current.id, fixedParticipant: true })}
                onEditNo={openEdit}
                onRemoveNo={setRemoving}
              />
            </div>
          )}
        </div>
      )}

      {!noPeopleYet && showTable && isLoading && <PageState kind="loading" noun="compatibility" />}
      {!noPeopleYet && showTable && isError && (
        <PageState kind="error" noun="compatibility" onRetry={() => { participants.refetch(); staff.refetch(); all.refetch() }} />
      )}
      {!noPeopleYet && showTable && !isLoading && !isError && (
        <CompatibilityMatrix
          rows={all.data ?? []}
          participants={participants.data ?? []}
          staff={activeStaff}
          canWrite={canWrite}
          participantQuery={query}
          onParticipantQuery={q => { setQuery(q); setParam('q', q || null) }}
          staffQuery={params.get('sq') ?? ''}
          onStaffQuery={q => setParam('sq', q || null)}
          onMarkNo={(staffId, participantId) => {
            const no = inScope.find(r => r.staffId === staffId && r.participantId === participantId && r.level === 'Excluded')
            if (no) openEdit(no)
            else openNew({ staffId, participantId, fixedPair: true })
          }}
          onRemoveNo={setRemoving}
          noUndo={noUndo}
        />
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
                {!draft.fixedParticipant && (
                  <FormField label="Participant" required>
                    <ParticipantPicker value={draft.participantId} onChange={participantId => pick({ participantId })} placeholder="Choose a participant" />
                  </FormField>
                )}
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
