import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { MoreHorizontal, X } from 'lucide-react'
import { useCompatibilityWriter } from '@/api/hooks'
import type { CompatibilityLevel, CompatibilityRowDto, UpsertCompatibilityDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { SearchInput } from '@/components/SearchInput'
import { ToggleGroup } from '@/components/ToggleGroup'
import { TONE } from '@/lib/tone'
import { cn, extractErrorMessage, formatDateAu } from '@/lib/utils'
import { RANKED_LEVELS } from '@/pages/rostering/lib/compatibilityOrder'

type RankedLevel = (typeof RANKED_LEVELS)[number]
type Person = { id: string; fullName: string }
type Cell = { level: CompatibilityLevel; rank: number }
type Write = UpsertCompatibilityDto & { reason: string | null }
type Bulk = { axis: 'row' | 'column'; level: RankedLevel | 'Allowed'; name: string; writes: Write[]; skippedNo: number; same: number; preferredLost: number }

// shortcut: no virtualisation, revisit past ~100 x 100 cells
const PAGE = 50
const LETTER: Record<RankedLevel, string> = { Preferred: 'P', Backup: 'B', Emergency: 'E' }
const KEY_LEVEL: Record<string, RankedLevel> = { p: 'Preferred', b: 'Backup', e: 'Emergency' }
const ALLOWED: Cell = { level: 'Allowed', rank: 0 }
const MSG_FAILED = 'Couldn’t save that change. Please try again.'

// Small on a mouse, 44px under a coarse pointer (the header ⋯ sits in a 56px column).
const KEBAB = 'inline-flex h-7 w-7 pointer-coarse:h-11 pointer-coarse:w-11 shrink-0 items-center justify-center rounded-lg text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-40'

const keyOf = (participantId: string, staffId: string) => `${participantId}:${staffId}`
const ranked = (level: CompatibilityLevel): level is RankedLevel => (RANKED_LEVELS as readonly string[]).includes(level)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function shortName(full: string): [string, string] {
  const [first, ...rest] = full.trim().split(/\s+/)
  const last = rest[rest.length - 1]
  return [first, last ? `${last[0]}.` : '']
}

function cellText(c: Cell) {
  if (c.level === 'Allowed') return '·'
  if (c.level === 'Excluded') return 'No'
  return `${LETTER[c.level as RankedLevel]}${c.rank || ''}`
}

const cellTone = (c: Cell) =>
  c.level === 'Preferred' ? `font-semibold ${TONE.success.ink}`
    : c.level === 'Excluded' ? `font-semibold ${TONE.danger.ink}`
      : c.level === 'Allowed' ? 'text-[var(--color-muted-foreground)]' : 'text-[var(--color-foreground)]'

/**
 * Every pairing of the shown participants and staff as one editable grid. A cell is set in place with a key or a menu; each write goes
 * through ONE serial queue (the server renumbers a tier with no lock, so two parallel writes could land on the same rank). A No is never
 * set or cleared here without the page's dialog. A bulk set skips No cells and refetches once at its end.
 */
export function CompatibilityMatrix({ rows, participants, staff, canWrite, participantQuery, onParticipantQuery, staffQuery, onStaffQuery, onMarkNo, onRemoveNo }: {
  rows: CompatibilityRowDto[]
  participants: Person[]
  staff: Person[]
  canWrite: boolean
  participantQuery: string
  onParticipantQuery: (q: string) => void
  staffQuery: string
  onStaffQuery: (q: string) => void
  /** Opens the Mark as No dialog for a pair that is not No yet, or the Edit reason one for a pair that is. */
  onMarkNo: (staffId: string, participantId: string) => void
  onRemoveNo: (row: CompatibilityRowDto) => void
}) {
  const writer = useCompatibilityWriter()
  const gridRef = useRef<HTMLTableElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const overlayRef = useRef<Record<string, Cell>>({})
  const refocus = useRef(false)
  const wantMenu = useRef(false)

  const [active, setActive] = useState({ r: 0, c: 0 })
  const [hover, setHover] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ index: number; top: number; left: number } | null>(null)
  const [overlay, setOverlay] = useState<Record<string, Cell>>({})
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [status, setStatus] = useState('')
  const [undo, setUndo] = useState<Write[] | null>(null)
  const [error, setError] = useState<{ message: string; retry: () => void; label: string } | null>(null)
  const [bulk, setBulk] = useState<Bulk | null>(null)
  const [noPreferredOnly, setNoPreferredOnly] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const byKey = useMemo(() => new Map(rows.map(r => [keyOf(r.participantId, r.staffId), r])), [rows])
  const hasPreferred = useMemo(() => new Set(rows.filter(r => r.level === 'Preferred').map(r => r.participantId)), [rows])
  const nothingSet = !rows.some(r => r.level !== 'Allowed')

  const sortedParticipants = useMemo(() => [...participants].sort((a, b) => a.fullName.localeCompare(b.fullName)), [participants])
  const filteredParticipants = useMemo(() => {
    const q = participantQuery.trim().toLowerCase()
    return sortedParticipants.filter(p => (!q || p.fullName.toLowerCase().includes(q)) && (!noPreferredOnly || !hasPreferred.has(p.id)))
  }, [sortedParticipants, participantQuery, noPreferredOnly, hasPreferred])
  const cols = useMemo(() => {
    const q = staffQuery.trim().toLowerCase()
    return q ? staff.filter(s => s.fullName.toLowerCase().includes(q)) : staff
  }, [staff, staffQuery])
  const pageRows = showAll ? filteredParticipants : filteredParticipants.slice(0, PAGE)

  const busy = progress !== null || pendingCount > 0
  const R = pageRows.length, C = cols.length
  const at = Math.min(active.r, Math.max(R - 1, 0)), ac = Math.min(active.c, Math.max(C - 1, 0))

  function cellAt(participantId: string, staffId: string, ov: Record<string, Cell> = overlayRef.current): Cell {
    const k = keyOf(participantId, staffId)
    const o = ov[k]
    if (o) return o
    const row = byKey.get(k)
    return row ? { level: row.level, rank: row.rank } : ALLOWED
  }

  /** The place a pair would take at the end of a tier, counting writes still in flight. */
  function nextRank(participantId: string, level: RankedLevel, ov: Record<string, Cell>) {
    const ids = new Set(rows.filter(r => r.participantId === participantId).map(r => r.staffId))
    for (const k of Object.keys(ov)) if (k.startsWith(`${participantId}:`)) ids.add(k.slice(participantId.length + 1))
    let n = 0
    for (const id of ids) if (cellAt(participantId, id, ov).level === level) n++
    return n + 1
  }

  function setOv(next: Record<string, Cell>) {
    overlayRef.current = next
    setOverlay(next)
  }

  /** Puts the writes on the serial queue, shows them at once, and refetches once after the last. */
  function run(writes: Write[], announce: string, restore: Write[] | null, labelOf: (w: Write) => string) {
    const ov = { ...overlayRef.current }
    for (const w of writes) ov[keyOf(w.participantId, w.staffId)] = { level: w.level, rank: ranked(w.level) ? w.rank ?? nextRank(w.participantId, w.level, ov) : 0 }
    setOv(ov)
    setPendingCount(c => c + writes.length)
    setError(null)
    chain.current = chain.current.then(async () => {
      const failed: Write[] = []
      let why = ''
      for (const [i, w] of writes.entries()) {
        if (writes.length > 1) setProgress({ i: i + 1, n: writes.length })
        try {
          await writer.put(w)
        } catch (err) {
          failed.push(w)
          why ||= extractErrorMessage(err, MSG_FAILED)
        }
      }
      await writer.refresh().catch(() => {})
      const left = { ...overlayRef.current }
      for (const w of writes) delete left[keyOf(w.participantId, w.staffId)]
      setOv(left)
      setProgress(null)
      setPendingCount(c => c - writes.length)
      refocus.current = true
      if (failed.length) {
        const retry = () => run(failed, announce, restore, labelOf)
        setError({
          message: writes.length === 1 ? why : `${announce.split(' ')[0]} ${writes.length - failed.length} of ${writes.length}. Couldn’t set ${failed.map(labelOf).join(', ')}: ${why}`,
          retry,
          label: writes.length === 1 ? 'Try again' : `Try ${failed.length} again`,
        })
        if (writes.length > 1) setStatus('')
      } else {
        setStatus(announce)
        setUndo(restore)
      }
    })
  }

  const restoreOf = (w: Write): Write => {
    const prev = cellAt(w.participantId, w.staffId)
    return { staffId: w.staffId, participantId: w.participantId, level: prev.level, rank: ranked(prev.level) && prev.rank > 0 ? prev.rank : null, reason: byKey.get(keyOf(w.participantId, w.staffId))?.reason ?? null }
  }
  const nameOf = (list: Person[], id: string) => list.find(x => x.id === id)?.fullName ?? ''

  function setTier(participantId: string, staffId: string, level: RankedLevel | 'Allowed') {
    const cur = cellAt(participantId, staffId)
    const p = nameOf(participants, participantId), s = nameOf(staff, staffId)
    if (cur.level === 'Excluded') return setStatus(`${s} is marked No for ${p}. Remove No first.`)
    if (cur.level === level) return
    // Clearing sends no reason, as the board's "Remove from list" does; every other write keeps the row's reason (the save overwrites it).
    const w: Write = { staffId, participantId, level, rank: null, reason: level === 'Allowed' ? null : byKey.get(keyOf(participantId, staffId))?.reason ?? null }
    const place = level === 'Allowed' ? 0 : nextRank(participantId, level, overlayRef.current)
    const lost = cur.level === 'Preferred' && level !== 'Preferred' ? ` ${s} is no longer ${p}’s preferred worker.` : ''
    run([w], `${p}: ${s} ${level === 'Allowed' ? 'is no longer listed' : `is now ${level} #${place}`}.${lost}`, [restoreOf(w)], () => s)
  }

  function openBulk(axis: 'row' | 'column', id: string, level: RankedLevel | 'Allowed') {
    const pairs = axis === 'row' ? cols.map(s => [id, s.id]) : pageRows.map(p => [p.id, id])
    const writes: Write[] = []
    const lost = new Set<string>()
    let skippedNo = 0, same = 0
    for (const [pid, sid] of pairs) {
      const cur = cellAt(pid, sid)
      if (cur.level === 'Excluded') skippedNo++
      else if (cur.level === level) same++
      else {
        writes.push({ staffId: sid, participantId: pid, level, rank: null, reason: level === 'Allowed' ? null : byKey.get(keyOf(pid, sid))?.reason ?? null })
        if (cur.level === 'Preferred' && level !== 'Preferred') lost.add(pid)
      }
    }
    setBulk({ axis, level, name: nameOf(axis === 'row' ? participants : staff, id), writes, skippedNo, same, preferredLost: lost.size })
  }

  function confirmBulk() {
    if (!bulk) return
    const { axis, level, writes } = bulk
    const verb = level === 'Allowed' ? 'Cleared' : 'Set'
    const labelOf = (w: Write) => (axis === 'row' ? nameOf(staff, w.staffId) : nameOf(participants, w.participantId))
    run(writes, `${verb} ${plural(writes.length, 'pairing')}${level === 'Allowed' ? '' : ` to ${level}`} for ${bulk.name}.`, writes.map(restoreOf), labelOf)
    setBulk(null)
  }

  function doUndo() {
    if (!undo) return
    const ps = (w: Write) => nameOf(participants, w.participantId)
    run(undo, 'Undone.', null, w => `${ps(w)} and ${nameOf(staff, w.staffId)}`)
    setUndo(null)
  }

  const cur = (r: number, c: number) => (pageRows[r] && cols[c] ? { p: pageRows[r], s: cols[c] } : null)

  function menuItems(c: Cell): DropdownItem[] {
    const no = c.level === 'Excluded'
    return [
      ...RANKED_LEVELS.map(l => ({ value: l, label: l, disabled: no })),
      { value: 'no', label: no ? 'Edit reason…' : 'No…' },
      { value: 'clear', label: no ? 'Remove No…' : 'Clear', disabled: c.level === 'Allowed' },
    ]
  }

  function choose(value: string) {
    const x = cur(at, ac)
    setMenu(null)
    refocus.current = true
    if (!x) return
    if (value === 'no') return onMarkNo(x.s.id, x.p.id)
    if (value === 'clear') {
      const row = byKey.get(keyOf(x.p.id, x.s.id))
      return cellAt(x.p.id, x.s.id).level === 'Excluded' ? row && onRemoveNo(row) : setTier(x.p.id, x.s.id, 'Allowed')
    }
    setTier(x.p.id, x.s.id, value as RankedLevel)
  }

  function openMenu() {
    const el = gridRef.current?.querySelector<HTMLElement>('td[tabindex="0"]')
    const box = el?.getBoundingClientRect()
    if (!box || !x0) return
    const items = menuItems(cellAt(x0.p.id, x0.s.id))
    setMenu({ index: Math.max(0, items.findIndex(i => !i.disabled)), top: box.bottom + 4, left: Math.max(8, Math.min(box.left, window.innerWidth - 184)) })
  }

  const x0 = cur(at, ac)

  function moveTo(r: number, c: number) {
    setMenu(null)
    setActive({ r: Math.min(Math.max(r, 0), R - 1), c: Math.min(Math.max(c, 0), C - 1) })
    refocus.current = true
  }

  function onKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    if (R === 0 || C === 0) return
    const k = e.key
    if (menu) {
      const items = menuItems(cellAt(x0!.p.id, x0!.s.id))
      const step = (d: number) => {
        let i = menu.index
        do i = (i + d + items.length) % items.length; while (items[i].disabled)
        setMenu({ ...menu, index: i })
      }
      if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); step(k === 'ArrowDown' ? 1 : -1) }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(items[menu.index].value) }
      else if (k === 'Escape' || k === 'Tab') { if (k === 'Escape') e.preventDefault(); setMenu(null); refocus.current = true }
      return
    }
    const ctrl = e.ctrlKey || e.metaKey
    const nav: Record<string, [number, number]> = {
      ArrowLeft: [at, ac - 1], ArrowRight: [at, ac + 1], ArrowUp: [at - 1, ac], ArrowDown: [at + 1, ac],
      Home: ctrl ? [0, 0] : [at, 0], End: ctrl ? [R - 1, C - 1] : [at, C - 1], PageUp: [at - 10, ac], PageDown: [at + 10, ac],
    }
    if (nav[k]) { e.preventDefault(); return moveTo(...nav[k]) }
    if (!canWrite) return
    if (ctrl && k.toLowerCase() === 'z') { e.preventDefault(); return doUndo() }
    if (ctrl || e.altKey) return
    const lower = k.toLowerCase()
    if (KEY_LEVEL[lower]) { e.preventDefault(); setTier(x0!.p.id, x0!.s.id, KEY_LEVEL[lower]) }
    else if (lower === 'n') { e.preventDefault(); onMarkNo(x0!.s.id, x0!.p.id) }
    else if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault()
      const row = byKey.get(keyOf(x0!.p.id, x0!.s.id))
      if (cellAt(x0!.p.id, x0!.s.id).level === 'Excluded') { if (row) onRemoveNo(row) }
      else setTier(x0!.p.id, x0!.s.id, 'Allowed')
    } else if (k === 'Enter' || k === ' ') { e.preventDefault(); openMenu() }
  }

  // Focus follows the roving cell after a key move, a menu close or a settled write.
  useEffect(() => {
    if (wantMenu.current) { wantMenu.current = false; openMenu() }
    if (!refocus.current || menu) return
    refocus.current = false
    gridRef.current?.querySelector<HTMLElement>('td[tabindex="0"]')?.focus()
  })

  // The menu closes on an outside press and when the grid scrolls out from under it.
  useEffect(() => {
    if (!menu) return
    const away = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('td[role="gridcell"]')) setMenu(null) }
    const close = () => setMenu(null)
    document.addEventListener('mousedown', away)
    window.addEventListener('resize', close)
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('resize', close) }
  }, [menu])
  useLayoutEffect(() => { if (menu) menuRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' }) }, [menu])

  const hoverCell = hover ? (() => { const [pid, sid] = hover.split(':'); return { p: nameOf(participants, pid), s: nameOf(staff, sid), pid, sid } })() : null
  const info = hoverCell ?? (x0 ? { p: x0.p.fullName, s: x0.s.fullName, pid: x0.p.id, sid: x0.s.id } : null)
  const infoCell = info ? cellAt(info.pid, info.sid) : null
  const infoRow = info ? byKey.get(keyOf(info.pid, info.sid)) : undefined
  const tierText = (c: Cell) => (c.level === 'Excluded' ? 'No' : c.level === 'Allowed' ? 'Allowed' : `${c.level} #${c.rank}`)

  function bulkMenu(axis: 'row' | 'column', id: string, name: string) {
    if (!canWrite) return null
    const items: DropdownItem[] = [...RANKED_LEVELS.map(l => ({ value: l, label: `Set all shown to ${l}` })), { value: 'Allowed', label: 'Clear all shown' }]
    return (
      <Dropdown variant="icon" label={`Options for ${name}`} icon={<MoreHorizontal className="h-5 w-5" aria-hidden="true" />} items={items}
        onSelect={v => openBulk(axis, id, v as RankedLevel | 'Allowed')} disabled={busy} triggerClassName={KEBAB} />
    )
  }

  const headBase = 'sticky bg-card border-b border-border font-normal'
  const levelWord = bulk?.level === 'Allowed' ? 'Clear' : `Set`
  const bulkMessage = bulk && (
    bulk.writes.length === 0
      ? `Nothing to change for ${bulk.name}.${bulk.skippedNo ? ` ${bulk.skippedNo} marked No are skipped.` : ''}${bulk.same ? ` ${bulk.same} already ${bulk.level === 'Allowed' ? 'Allowed' : bulk.level}.` : ''}`
      : [
        `${levelWord} ${plural(bulk.writes.length, 'pairing')}${bulk.level === 'Allowed' ? '' : ` to ${bulk.level}`} for ${bulk.name}?`,
        bulk.skippedNo ? `${bulk.skippedNo} marked No ${bulk.skippedNo === 1 ? 'is' : 'are'} skipped.` : '',
        bulk.same ? `${bulk.same} already ${bulk.level === 'Allowed' ? 'Allowed' : bulk.level} stay as they are.` : '',
        bulk.preferredLost ? `This also clears the preferred worker for ${plural(bulk.preferredLost, 'participant')}.` : '',
      ].filter(Boolean).join(' ')
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={participantQuery} onChange={onParticipantQuery} placeholder="Search participants" className="w-full sm:w-64" />
        <SearchInput value={staffQuery} onChange={onStaffQuery} placeholder="Search staff" className="w-full sm:w-64" />
        <ToggleGroup ariaLabel="Participants" value={noPreferredOnly ? 'none' : 'all'} onChange={k => setNoPreferredOnly(k === 'none')}
          options={[{ key: 'all', label: 'Everyone' }, { key: 'none', label: 'No Preferred yet' }]} />
      </div>

      <div className="rounded-[var(--radius-sm)] border border-border bg-card px-3 py-2 text-sm">
        <p className="min-h-5 truncate">
          {info && infoCell ? (
            <>
              <span className="font-medium">{info.s} · {info.p}</span>
              {'  '}{tierText(infoCell)}{infoRow?.reason ? ` · “${infoRow.reason}”` : ''}{infoRow && infoCell.level !== 'Allowed' ? ` · Updated ${formatDateAu(infoRow.updatedAt)}` : ''}
            </>
          ) : 'Pick a cell.'}
        </p>
        <p role="status" className="flex min-h-5 flex-wrap items-center gap-2 text-muted-foreground">
          <span>{progress ? `Setting ${progress.i} of ${progress.n}…` : status}</span>
          {undo && !busy && canWrite && <Button variant="ghost" size="sm" onClick={doUndo}>Undo</Button>}
        </p>
      </div>

      {error && (
        <Callout
          tone="error"
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={error.retry}>{error.label}</Button>
              <Button variant="ghost" size="sm" iconOnly onClick={() => setError(null)} aria-label="Dismiss error"><X className="h-4 w-4" /></Button>
            </>
          }
        >
          {error.message}
        </Callout>
      )}

      {nothingSet && <p className="text-sm text-muted-foreground">No pairings set yet. Pick a cell to set one.</p>}
      {R === 0 && <p className="text-sm text-muted-foreground">{noPreferredOnly && !participantQuery.trim() ? 'Every participant has a Preferred worker.' : `No participants match “${participantQuery.trim()}”.`}</p>}
      {C === 0 && <p className="text-sm text-muted-foreground">No staff match “{staffQuery.trim()}”.</p>}

      {R > 0 && C > 0 && (
        <div className="max-h-[70dvh] overflow-auto rounded-[var(--radius-sm)] border border-border" onScroll={() => setMenu(null)}>
          <table ref={gridRef} role="grid" aria-label="Compatibility, participants by staff" aria-busy={busy} className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th scope="col" className={cn(headBase, 'left-0 top-0 z-30 min-w-40 px-3 py-2 text-left text-xs font-medium text-muted-foreground md:min-w-[12.5rem]')}>Participant</th>
                {cols.map((s, ci) => {
                  const [first, last] = shortName(s.fullName)
                  return (
                    <th key={s.id} scope="col" title={s.fullName} className={cn(headBase, 'top-0 z-20 w-14 min-w-14 px-0 py-1 text-xs', ci === ac && 'bg-[var(--color-accent)]')}>
                      <span className="flex flex-col items-center leading-tight"><span className="font-medium">{first}</span><span className="text-muted-foreground">{last || ' '}</span></span>
                      <span className="flex justify-center">{bulkMenu('column', s.id, s.fullName)}</span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody onKeyDown={onKeyDown} onMouseOver={e => { const k = (e.target as HTMLElement).closest('td')?.dataset.key; setHover(k ?? null) }} onMouseLeave={() => setHover(null)}>
              {pageRows.map((p, ri) => (
                <tr key={p.id}>
                  <th scope="row" className={cn('sticky left-0 z-10 border-b border-border bg-card px-3 text-left text-sm font-medium', ri === at && 'bg-[var(--color-accent)]')}>
                    <span className="flex items-center justify-between gap-1">
                      <span className="min-w-0 [overflow-wrap:anywhere]">{p.fullName}</span>
                      {bulkMenu('row', p.id, p.fullName)}
                    </span>
                  </th>
                  {cols.map((s, ci) => {
                    const k = keyOf(p.id, s.id)
                    const c = cellAt(p.id, s.id, overlay)
                    const row = byKey.get(k)
                    const isActive = ri === at && ci === ac
                    const reason = row?.reason ? `, ${row.reason}` : ''
                    return (
                      <td
                        key={s.id}
                        role="gridcell"
                        data-key={k}
                        data-r={ri}
                        data-c={ci}
                        tabIndex={isActive ? 0 : -1}
                        aria-label={`${p.fullName} and ${s.fullName}: ${c.level === 'Excluded' ? 'marked No' : tierText(c)}${reason}`}
                        aria-haspopup={canWrite ? 'menu' : undefined}
                        aria-expanded={canWrite && isActive ? menu !== null : undefined}
                        onFocus={() => setActive({ r: ri, c: ci })}
                        onClick={() => { setActive({ r: ri, c: ci }); if (canWrite) { if (menu && isActive) setMenu(null); else wantMenu.current = true } }}
                        className={cn(
                          'h-11 w-14 min-w-14 cursor-default select-none border-b border-r border-border/50 p-0 text-center tabular-nums',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]',
                          canWrite && 'cursor-pointer hover:bg-[var(--color-accent)]',
                          cellTone(c),
                          overlay[k] && 'shadow-[inset_0_2px_0_var(--color-primary)] motion-safe:transition-shadow',
                        )}
                      >
                        {cellText(c)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!showAll && filteredParticipants.length > PAGE && (
        <Button variant="ghost" size="sm" className="min-h-[var(--tap-min)]" onClick={() => setShowAll(true)}>Show all {filteredParticipants.length}</Button>
      )}

      {menu && x0 && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Set ${x0.s.fullName} for ${x0.p.fullName}`}
          style={{ position: 'fixed', top: menu.top, left: menu.left, zIndex: 9999 }}
          className="w-44 rounded-md bg-[var(--color-popover)] shadow-[var(--shadow-float)]"
        >
          {menuItems(cellAt(x0.p.id, x0.s.id)).map((item, i) => {
            const current = cellAt(x0.p.id, x0.s.id).level === item.value
            return (
              <div
                key={item.value}
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                aria-current={current || undefined}
                data-active={i === menu.index}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => !item.disabled && setMenu(m => m && { ...m, index: i })}
                onClick={() => !item.disabled && choose(item.value)}
                className={cn(
                  'flex min-h-[var(--tap-min)] items-center justify-between px-3 py-1.5 text-sm',
                  item.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                  i === menu.index && !item.disabled && 'bg-[var(--color-surface-container-low)]',
                )}
              >
                {item.label}
                {current && <span aria-hidden="true">✓</span>}
              </div>
            )
          })}
        </div>,
        document.body,
      )}

      <ConfirmDialog
        open={bulk !== null}
        onCancel={() => setBulk(null)}
        onConfirm={confirmBulk}
        title={bulk?.level === 'Allowed' ? 'Clear pairings?' : `Set to ${bulk?.level ?? ''}?`}
        message={bulkMessage}
        confirmLabel={bulk ? `${levelWord} ${bulk.writes.length}` : 'Confirm'}
        confirmDisabled={!bulk || bulk.writes.length === 0}
      />
    </div>
  )
}
