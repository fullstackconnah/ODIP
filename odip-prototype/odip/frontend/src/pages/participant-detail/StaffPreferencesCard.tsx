import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, Users, X } from 'lucide-react'
import { useCompatibility, useStaff, useUpsertCompatibility } from '@/api/hooks'
import type { CompatibilityRowDto, UpsertCompatibilityDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { TAP_FLOOR } from '@/components/tapArea'
import { usePermissions } from '@/lib/permissions'
import { queryPhase } from '@/lib/queryPhase'
import { extractErrorMessage } from '@/lib/utils'
import { RANKED_LEVELS, compareCompatibility } from '@/pages/rostering/lib/compatibilityOrder'

type RankedLevel = (typeof RANKED_LEVELS)[number]
type MoveTarget = { staffId: string; dir: 'up' | 'down' }

const lower = (level: string) => level.toLowerCase()

// The house select look (as on the compatibility matrix): --control-h is 32px on a mouse and 44px on touch.
const SELECT_CLASS = 'h-[var(--control-h)] w-auto rounded-[var(--radius-sm)] border border-border bg-card px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * R8b: who this participant works best with, in order. Preferred, Backup and Emergency are each a ranked list; the shift
 * panel's staff picker and (later) auto-rostering read the same order. Moving, re-tiering and adding all go through the
 * matrix's own write (useUpsertCompatibility); the server places the row and renumbers the tier. "No" stays read-only
 * here, because marking it needs the reason dialog on the compatibility matrix.
 */
export function StaffPreferencesCard({ participantId }: { participantId: string }) {
  const { canWrite } = usePermissions()
  const compat = useCompatibility(participantId)
  const { data: staff = [] } = useStaff()
  const upsert = useUpsertCompatibility()
  const rootRef = useRef<HTMLDivElement>(null)
  const [busyStaffId, setBusyStaffId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const focusTarget = useRef<MoveTarget | null>(null)
  const [addStaffId, setAddStaffId] = useState('')
  const [addTier, setAddTier] = useState<RankedLevel>('Backup')

  // After a reorder the moved row keeps keyboard focus on the button that was pressed, or on its enabled sibling when the row
  // reached an end (the pressed button is disabled by then). Runs after the save settles and the list has refetched.
  useEffect(() => {
    const target = focusTarget.current
    if (!target || busyStaffId) return
    focusTarget.current = null
    const find = (dir: 'up' | 'down') =>
      rootRef.current?.querySelector<HTMLButtonElement>(`button[data-move="${target.staffId}:${dir}"]:not(:disabled)`)
    ;(find(target.dir) ?? find(target.dir === 'up' ? 'down' : 'up'))?.focus()
  })

  const phase = queryPhase(compat)
  if (phase === 'loading') return <Card title="Staff preferences"><PageState kind="loading" noun="staff preferences" /></Card>
  if (phase === 'error') return <Card title="Staff preferences"><PageState kind="error" noun="staff preferences" onRetry={() => compat.refetch()} /></Card>

  const rows = compat.data ?? []
  const byName = (a: CompatibilityRowDto, b: CompatibilityRowDto) =>
    compareCompatibility({ level: a.level, rank: a.rank, name: a.staffName }, { level: b.level, rank: b.rank, name: b.staffName })
  const groups = RANKED_LEVELS.map(level => ({ level, rows: rows.filter(r => r.level === level).sort(byName) }))
  const noneListed = groups.every(g => g.rows.length === 0)
  const markedNo = rows.filter(r => r.level === 'Excluded').sort(byName)
  const listedOrNo = new Set(rows.filter(r => r.level === 'Preferred' || r.level === 'Backup' || r.level === 'Emergency' || r.level === 'Excluded').map(r => r.staffId))
  const addable = staff.filter(s => s.isActive && !listedOrNo.has(s.id)).sort((a, b) => a.fullName.localeCompare(b.fullName))
  const busy = busyStaffId !== null

  function save(dto: UpsertCompatibilityDto, announce: string, move?: MoveTarget) {
    setBusyStaffId(dto.staffId)
    setError(null)
    upsert.mutate(dto, {
      onSuccess: () => {
        setBusyStaffId(null)
        setAnnouncement(announce)
        focusTarget.current = move ?? null
      },
      onError: err => {
        setBusyStaffId(null)
        setError(extractErrorMessage(err, 'Couldn’t save this change. Try again.'))
      },
    })
  }

  function move(row: CompatibilityRowDto, place: number, dir: 'up' | 'down') {
    const rank = dir === 'up' ? place - 1 : place + 1
    save({ staffId: row.staffId, participantId, level: row.level, reason: row.reason, rank }, `${row.staffName} is now ${lower(row.level)} #${rank}.`, { staffId: row.staffId, dir })
  }

  function retier(row: CompatibilityRowDto, level: CompatibilityRowDto['level']) {
    if (level === row.level) return
    if (level === 'Allowed') return save({ staffId: row.staffId, participantId, level, reason: null }, `${row.staffName} is no longer listed.`)
    const place = rows.filter(r => r.level === level).length + 1
    save({ staffId: row.staffId, participantId, level, reason: row.reason }, `${row.staffName} is now ${lower(level)} #${place}.`)
  }

  function add() {
    const person = addable.find(s => s.id === addStaffId)
    if (!person) return
    const place = rows.filter(r => r.level === addTier).length + 1
    save({ staffId: person.id, participantId, level: addTier, reason: null }, `${person.fullName} is now ${lower(addTier)} #${place}.`)
    setAddStaffId('')
  }

  return (
    <Card title="Staff preferences">
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

        {noneListed ? (
          <EmptyState
            icon={Users}
            size="inline"
            title="No staff preferences yet"
            description={canWrite ? 'Add the staff this participant works best with, in order.' : 'No preferred, backup or emergency staff have been listed.'}
          />
        ) : (
          groups.map(({ level, rows: tier }) => (
            <div key={level}>
              <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{level}</h4>
              {tier.length === 0 ? (
                <p className="text-sm text-muted-foreground">No {lower(level)} staff yet.</p>
              ) : (
                <ol aria-busy={busy} className="divide-y divide-border">
                  {tier.map((row, i) => (
                    <li key={row.staffId} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2">
                      <span data-rank className="w-5 shrink-0 pt-0.5 text-sm tabular-nums text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1 basis-40">
                        <p data-name className="text-sm font-medium [overflow-wrap:anywhere]">{row.staffName}</p>
                        {row.reason && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{row.reason}</p>}
                      </div>
                      {canWrite && (
                        <div className="flex items-center gap-2 pointer-coarse:gap-4">
                          <Button
                            variant="ghost" size="sm" iconOnly data-move={`${row.staffId}:up`}
                            aria-label={`Move ${row.staffName} up in ${level}`}
                            disabled={busy || i === 0}
                            onClick={() => move(row, i + 1, 'up')}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="sm" iconOnly data-move={`${row.staffId}:down`}
                            aria-label={`Move ${row.staffName} down in ${level}`}
                            disabled={busy || i === tier.length - 1}
                            onClick={() => move(row, i + 1, 'down')}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                          <select
                            aria-label={`Tier for ${row.staffName}`}
                            value={row.level}
                            disabled={busy}
                            onChange={e => retier(row, e.target.value as CompatibilityRowDto['level'])}
                            className={SELECT_CLASS}
                          >
                            {RANKED_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                            <option value="Allowed">Remove from list</option>
                          </select>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))
        )}

        {canWrite && (
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Add staff</p>
            <div className="flex flex-wrap items-center gap-2 pointer-coarse:gap-3">
              <select aria-label="Staff to add" value={addStaffId} disabled={busy} onChange={e => setAddStaffId(e.target.value)} className={`${SELECT_CLASS} min-w-0 max-w-full`}>
                <option value="">Choose staff</option>
                {addable.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </select>
              <select aria-label="Tier to add to" value={addTier} disabled={busy} onChange={e => setAddTier(e.target.value as RankedLevel)} className={SELECT_CLASS}>
                {RANKED_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <Button variant="secondary" disabled={busy || !addStaffId} onClick={add}>Add</Button>
            </div>
          </div>
        )}

        {markedNo.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {`No: ${markedNo.map(r => r.staffName).join(', ')}.`}{' '}
            <Link to="/rostering/compatibility" className={`${TAP_FLOOR} text-[var(--color-primary)] hover:underline`}>Change in the compatibility matrix</Link>
          </p>
        )}

        <p role="status" className="sr-only">{announcement}</p>
      </div>
    </Card>
  )
}
