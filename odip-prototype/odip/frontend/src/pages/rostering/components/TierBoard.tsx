import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, X } from 'lucide-react'
import { useCompatibility, useStaff, useUpsertCompatibility } from '@/api/hooks'
import type { CompatibilityRowDto, UpsertCompatibilityDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { PageState } from '@/components/PageState'
import { usePermissions } from '@/lib/permissions'
import { queryPhase } from '@/lib/queryPhase'
import { extractErrorMessage } from '@/lib/utils'
import { RANKED_LEVELS, compareCompatibility } from '@/pages/rostering/lib/compatibilityOrder'
import { StaffChecklist } from './StaffChecklist'

type RankedLevel = (typeof RANKED_LEVELS)[number]

const lower = (level: string) => level.toLowerCase()

// The kebab look and 44px target of DataTable's row menu.
const TRIGGER = 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-40 transition-colors'

/**
 * One participant's compatibility as four columns: Preferred, Backup and Emergency are ranked, No is a plain list. Every write goes
 * through the matrix's own useUpsertCompatibility; the server places the row and renumbers the tier. Marking No needs the reason
 * dialog, which the page owns, so the board hands it the person (or null when the person is still to be picked).
 */
export function TierBoard({ participantId, participantName, onMarkNo, onEditNo, onRemoveNo }: {
  participantId: string
  participantName: string
  onMarkNo: (staffId: string | null) => void
  onEditNo: (row: CompatibilityRowDto) => void
  onRemoveNo: (row: CompatibilityRowDto) => void
}) {
  const { canWrite } = usePermissions()
  const compat = useCompatibility(participantId)
  const { data: staff = [] } = useStaff()
  const upsert = useUpsertCompatibility()
  const rootRef = useRef<HTMLDivElement>(null)
  const [busyStaffId, setBusyStaffId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [adding, setAdding] = useState<RankedLevel | null>(null)
  const focusStaffId = useRef<string | null>(null)

  // After a write the moved person's menu trigger takes focus back; runs once the save has settled and the list has refetched.
  useEffect(() => {
    const id = focusStaffId.current
    if (!id || busyStaffId) return
    focusStaffId.current = null
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-person="${id}"] button`)?.focus()
  })

  const phase = queryPhase(compat)
  if (phase === 'loading') return <PageState kind="loading" noun="compatibility" />
  if (phase === 'error') return <PageState kind="error" noun="compatibility" onRetry={() => compat.refetch()} />

  const rows = compat.data ?? []
  const byName = (a: CompatibilityRowDto, b: CompatibilityRowDto) =>
    compareCompatibility({ level: a.level, rank: a.rank, name: a.staffName }, { level: b.level, rank: b.rank, name: b.staffName })
  const inLevel = (level: CompatibilityRowDto['level']) => rows.filter(r => r.level === level).sort(byName)
  const listedOrNo = new Set(rows.filter(r => r.level !== 'Allowed').map(r => r.staffId))
  const addable = staff.filter(s => s.isActive && !listedOrNo.has(s.id)).sort((a, b) => a.fullName.localeCompare(b.fullName))
  const busy = busyStaffId !== null

  function save(dto: UpsertCompatibilityDto, announce: string) {
    setBusyStaffId(dto.staffId)
    setError(null)
    upsert.mutate(dto, {
      onSuccess: () => {
        setBusyStaffId(null)
        setAnnouncement(announce)
        focusStaffId.current = dto.staffId
      },
      onError: err => {
        setBusyStaffId(null)
        setError(extractErrorMessage(err, 'Couldn’t save this change. Try again.'))
      },
    })
  }

  function menuItems(row: CompatibilityRowDto, i: number, count: number): DropdownItem[] {
    if (row.level === 'Excluded') {
      return [{ value: 'edit', label: 'Edit reason…' }, { value: 'remove-no', label: 'Remove No…' }]
    }
    return [
      { value: 'up', label: 'Move up', disabled: i === 0 },
      { value: 'down', label: 'Move down', disabled: i === count - 1 },
      ...RANKED_LEVELS.filter(l => l !== row.level).map(l => ({ value: l, label: `Move to ${l}` })),
      { value: 'no', label: 'Mark No…' },
      { value: 'remove', label: 'Remove from list' },
    ]
  }

  function choose(row: CompatibilityRowDto, i: number, value: string) {
    const base = { staffId: row.staffId, participantId }
    if (value === 'edit') return onEditNo(row)
    if (value === 'remove-no') return onRemoveNo(row)
    if (value === 'no') return onMarkNo(row.staffId)
    if (value === 'remove') return save({ ...base, level: 'Allowed', reason: null }, `${row.staffName} is no longer listed.`)
    if (value === 'up' || value === 'down') {
      const rank = value === 'up' ? i : i + 2
      return save({ ...base, level: row.level, reason: row.reason, rank }, `${row.staffName} is now ${lower(row.level)} #${rank}.`)
    }
    const place = inLevel(value as RankedLevel).length + 1
    save({ ...base, level: value as RankedLevel, reason: row.reason }, `${row.staffName} is now ${lower(value)} #${place}.`)
  }

  function chip(row: CompatibilityRowDto, i: number, count: number) {
    const ranked = row.level !== 'Excluded'
    return (
      <li key={row.staffId} className="rounded-[var(--radius-sm)] border border-border bg-card py-1 pl-3 pr-1">
        <div className="flex items-start gap-2">
          {ranked && <span data-rank className="w-5 shrink-0 pt-2.5 text-sm tabular-nums text-muted-foreground">{i + 1}</span>}
          <p data-name className="min-w-0 flex-1 py-2.5 text-sm font-medium [overflow-wrap:anywhere]">{row.staffName}</p>
          {canWrite && (
            <span data-person={row.staffId}>
              <Dropdown
                variant="icon"
                label={`Options for ${row.staffName}`}
                icon={<MoreHorizontal className="h-5 w-5" aria-hidden="true" />}
                items={menuItems(row, i, count)}
                onSelect={value => choose(row, i, value)}
                disabled={busy}
                triggerClassName={TRIGGER}
              />
            </span>
          )}
        </div>
        {row.reason && <p data-reason className="-mt-1.5 pb-2.5 pr-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{row.reason}</p>}
      </li>
    )
  }

  return (
    <div ref={rootRef} className="space-y-4">
      {error && (
        <Callout
          tone="error"
          actions={
            <Button variant="ghost" size="sm" iconOnly onClick={() => setError(null)} aria-label="Dismiss error">
              <X className="h-4 w-4" />
            </Button>
          }
        >
          {error}
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
        {[...RANKED_LEVELS, 'Excluded' as const].map(level => {
          const tier = inLevel(level)
          const name = level === 'Excluded' ? 'No' : level
          const List = level === 'Excluded' ? 'ul' : 'ol'
          return (
            <section key={level} aria-labelledby={`tier-${level}`} className="flex min-w-0 flex-col gap-2">
              <h3 className="flex items-baseline justify-between gap-2">
                <span id={`tier-${level}`} className="text-sm font-semibold">{name}</span>
                <span data-count className="text-sm tabular-nums text-muted-foreground">{tier.length}</span>
              </h3>
              {tier.length === 0 ? (
                <p className="text-sm text-muted-foreground">{level === 'Excluded' ? 'No one is marked No.' : `No ${lower(level)} staff yet.`}</p>
              ) : (
                <List aria-busy={busy} className="space-y-2">{tier.map((row, i) => chip(row, i, tier.length))}</List>
              )}
              {canWrite && (
                <Button
                  variant="ghost"
                  className="min-h-11 w-full"
                  aria-label={level === 'Excluded' ? undefined : `Add to ${level}`}
                  onClick={() => (level === 'Excluded' ? onMarkNo(null) : setAdding(level))}
                >
                  {level === 'Excluded' ? '+ Mark No' : '+ Add'}
                </Button>
              )}
            </section>
          )
        })}
      </div>

      {adding && (
        <StaffChecklist
          tier={adding}
          participantId={participantId}
          participantName={participantName}
          candidates={addable}
          onClose={() => setAdding(null)}
          onDone={n => setAnnouncement(`Added ${n} as ${adding}.`)}
        />
      )}

      <p role="status" className="sr-only">{announcement}</p>
    </div>
  )
}
