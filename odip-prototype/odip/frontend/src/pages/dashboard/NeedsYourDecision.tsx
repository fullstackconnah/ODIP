import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { Tabs } from '@/components/Tabs'
import { AllClearRow } from './AttentionBand'
import { QuickGroup } from './QuickGroup'
import { isPresent, rowKey, shownCount, visibleRows, type GroupKey, type GroupModel } from './quickGroupModel'
import type { DecisionState } from './useDecisionState'

/** The open tab. `settled` once the viewer picked it, it had rows, or the one before it emptied: from then on only a pick or an emptying moves it. */
type Open = { key: GroupKey | null; settled: boolean }

/**
 * The tab's label (bolder, SHAPE §2): the title in semibold, then its count in the house tab-counter pill, solid olive on the open tab and Mist on the
 * others; a dash while waiting or failed. Drawn here, not through Tabs' `badge` (hidden, never drawn at 0, shared by every strip). The visible label is
 * hidden and ONE sr-only text node names the tab ("Leave (3)", "Leave, loading"): split around the pill, a name can gain a stray space.
 */
function tabLabel(group: GroupModel, count: number, open: boolean) {
  const ready = group.phase === 'ready'
  const name = ready ? `${group.title} (${count})` : `${group.title}${group.phase === 'loading' ? ', loading' : ", couldn't load"}`
  const pill = open ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'bg-[var(--color-surface-container)] text-[var(--color-foreground)]'
  // `relative`: the sr-only name is absolute, and must sit inside the strip's scroller, not stretch the page sideways from the last tab.
  return (
    <span className="relative inline-flex items-center">
      <span aria-hidden="true" className="inline-flex items-center gap-2">
        <span className="font-semibold">{group.title}</span>
        <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs font-bold tabular-nums ${pill}`}>{ready ? count : '–'}</span>
      </span>
      <span className="sr-only">{name}</span>
    </span>
  )
}

/**
 * "Needs your decision" (SHAPE §2, §3): one tab per group, in the order given, over that group's panel. A group at zero is a muted tab and is named in the
 * All clear row under the panel (muted tabs are skipped by the arrow keys, so a keyboard screen-reader user would otherwise never hear it). With every
 * group at zero, the heading and that row alone.
 */
export function NeedsYourDecision({ groups, state, onRecoveryPresenceChange }: { groups: GroupModel[]; state: DecisionState; onRecoveryPresenceChange?: (pending: boolean) => void }) {
  // A failed/uncertain action still needs a status check even if a later list is empty or its notice was dismissed.
  // IDs and retry guards stay in QuickGroup; the parent only keeps that recovery panel mounted.
  const [recovering, setRecovering] = useState<ReadonlySet<GroupKey>>(() => new Set())
  const onRecoveryChange = useCallback((key: GroupKey, pending: boolean) => setRecovering(previous => {
    if (previous.has(key) === pending) return previous
    const next = new Set(previous)
    if (pending) next.add(key)
    else next.delete(key)
    return next
  }), [])
  useLayoutEffect(() => { onRecoveryPresenceChange?.(recovering.size > 0) }, [recovering, onRecoveryPresenceChange])
  // A fresh read that lists a row marked decided here again says it was not decided after all: show it, and let the next read settle it. Here, not in
  // QuickGroup: a group with every row marked is absent from the page, so it could never see its own rows come back.
  const readStamp = groups.map((group) => group.readAt ?? 0).join()
  useEffect(() => {
    // Its own group's read, later than the mark: another group's read (or a failed refetch) says nothing about this row.
    const back = groups.flatMap((group) => group.rows.map((row) => rowKey(group.key, row.id)).filter((key) => (state.gone.get(key) ?? Infinity) < (group.readAt ?? 0)))
    if (back.length) state.unmarkGone(back)
    // Only a new read decides: `gone` itself changing (a row just marked) must not undo the mark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readStamp])
  const notices = (group: GroupModel) => state.notices.filter((notice) => notice.subject === group.key).length
  const present = groups.filter((group) => isPresent(group, state.gone, notices(group), state.running.has(group.key)) || recovering.has(group.key))
  const clear = groups.filter((group) => !present.includes(group)).map((group) => group.noun)
  const hasRows = (group: GroupModel) => group.phase === 'ready' && visibleRows(group, state.gone).length > 0

  // Adjusted while rendering (as Tabs does), never in an effect, so a row's leaving, the tab change and the focus move land in one commit.
  const [open, setOpen] = useState<Open>({ key: null, settled: false })
  const next = ((): Open => {
    const current = present.find((group) => group.key === open.key)
    if (current && open.settled) return open
    // Arrival: the first tab with rows, else the first present one (its loading line). It settles the moment its tab has rows: from then on nothing
    // switches under the viewer, even when an earlier group's rows land later (a switch there once hid a button mid-tap, e2e 2026-10-15).
    if (current || open.key === null) {
      const first = present.find(hasRows) ?? current ?? present[0]
      return { key: first?.key ?? null, settled: !!first && hasRows(first) }
    }
    // The open tab emptied: the next one after it, in order and wrapping, with rows; else the next present one; else none.
    const from = groups.findIndex((group) => group.key === open.key)
    const after = [...groups.slice(from + 1), ...groups.slice(0, from)].filter((group) => present.includes(group))
    return { key: (after.find(hasRows) ?? after[0])?.key ?? null, settled: true }
  })()
  if (next.key !== open.key || next.settled !== open.settled) setOpen(next)

  return (
    <div className="flex flex-col gap-2">
      {/* tabIndex -1: where focus goes when the last tab with anything empties (QuickGroup's afterTabLeft). */}
      <h2 id="dashboard-decisions" tabIndex={-1} className="text-sm font-semibold focus:outline-none">Needs your decision</h2>
      {present.length === 0 ? (
        <AllClearRow labels={clear} />
      ) : (
        <>
          <div>
            <Tabs
              ariaLabel="Needs your decision"
              idPrefix="decisions"
              overflow="scroll"
              active={next.key ?? ''}
              onChange={(key) => setOpen({ key: key as GroupKey, settled: true })}
              tabs={groups.map((group) => ({
                id: group.key,
                label: tabLabel(group, shownCount(group, state.gone), group.key === next.key),
                disabled: !present.includes(group),
                panelId: present.includes(group) ? `decisions-panel-${group.key}` : undefined,
              }))}
            />
            {/* Every present group's panel stays mounted, so a tab switch never drops a half-typed reason, strands a tap in flight or remounts a notice. */}
            {present.map((group) => (
              <div
                key={group.key}
                role="tabpanel"
                id={`decisions-panel-${group.key}`}
                aria-labelledby={`decisions-tab-${group.key}`}
                hidden={group.key !== next.key}
                className="mt-[var(--card-pad)]"
              >
                <QuickGroup model={group} state={state} onRecoveryChange={onRecoveryChange} />
              </div>
            ))}
          </div>
          {clear.length > 0 && <AllClearRow labels={clear} />}
        </>
      )}
    </div>
  )
}
