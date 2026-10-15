import { useState } from 'react'
import { Tabs } from '@/components/Tabs'
import { AllClearRow } from './AttentionBand'
import { QuickGroup } from './QuickGroup'
import { isPresent, shownCount, visibleRows, type GroupKey, type GroupModel } from './quickGroupModel'
import type { DecisionState } from './useDecisionState'

/** The open tab. `settled` once it was picked by the viewer, had rows, or was opened because the one before it emptied: from then on only those move it. */
type Open = { key: GroupKey | null; settled: boolean }

/** The tab's label carries its count in its text (the Qualifications way), so a screen reader hears it. A dash while waiting or failed, named for what it is. */
function tabLabel(group: GroupModel, count: number) {
  if (group.phase === 'ready') return <>{group.title} <span className="tabular-nums">({count})</span></>
  return (
    // One text node for the name ("Leave, loading"): split around the hidden dash, a name can gain a stray space before its comma.
    <>
      <span aria-hidden="true">{group.title} (–)</span>
      <span className="sr-only">{group.title}{group.phase === 'loading' ? ', loading' : ", couldn't load"}</span>
    </>
  )
}

/**
 * "Needs your decision" (SHAPE §2, §3): one tab per group, in the order given, over that group's panel. A group at zero is a muted tab and is named in the
 * All clear row under the panel (muted tabs are skipped by the arrow keys, so a keyboard screen-reader user would otherwise never hear it). With every
 * group at zero, the heading and that row alone.
 */
export function NeedsYourDecision({ groups, state }: { groups: GroupModel[]; state: DecisionState }) {
  const notices = (group: GroupModel) => state.notices.filter((notice) => notice.subject === group.key).length
  const present = groups.filter((group) => isPresent(group, state.gone, notices(group)))
  const clear = groups.filter((group) => !present.includes(group)).map((group) => group.noun)
  const hasRows = (group: GroupModel) => group.phase === 'ready' && visibleRows(group, state.gone).length > 0

  // Adjusted while rendering (as Tabs does), never in an effect, so a row's leaving, the tab change and the focus move land in one commit.
  const [open, setOpen] = useState<Open>({ key: null, settled: false })
  const next = ((): Open => {
    const current = present.find((group) => group.key === open.key)
    if (current) {
      if (open.settled) return open
      // Opened on arrival while nothing had rows: the first tab with rows takes over once one has them.
      const first = present.find(hasRows)
      return first ? { key: first.key, settled: true } : open
    }
    if (open.key === null) {
      const first = present.find(hasRows) ?? present[0]
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
                label: tabLabel(group, shownCount(group, state.gone)),
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
                <QuickGroup model={group} state={state} />
              </div>
            ))}
          </div>
          {clear.length > 0 && <AllClearRow labels={clear} />}
        </>
      )}
    </div>
  )
}
