import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { NeedsYourDecision } from './NeedsYourDecision'
import { useDecisionState } from './useDecisionState'
import type { ActionOutcome, GroupKey, GroupModel, QuickRow, RowAction } from './quickGroupModel'

function Harness({ groups }: { groups: GroupModel[] }) {
  const state = useDecisionState()
  return (
    <MemoryRouter>
      <AnnouncementRegion message={state.announcement} />
      <NeedsYourDecision groups={groups} state={state} />
    </MemoryRouter>
  )
}

const TITLES: Record<GroupKey, [string, string]> = {
  completions: ['Completions', 'shift completions'], leave: ['Leave', 'leave requests'], incidents: ['Incidents', 'open incidents'],
  compliance: ['Credentials', 'staff credentials to update'], tasks: ['Tasks', 'tasks due'],
}
const tap = (id: string, run: () => Promise<ActionOutcome> = async () => ({ announce: `Approved Person ${id}.` })): RowAction =>
  ({ kind: 'tap', label: 'Approve', busyLabel: 'Approving…', name: `Approve: Person ${id}`, failText: "Couldn't approve. Try again.", run })
const decline = (id: string): RowAction => ({ kind: 'form', label: 'Decline', name: `Decline: Person ${id}`, form: {
  field: 'textarea', label: 'Reason (optional)', submitLabel: 'Decline request', busyLabel: 'Declining…', failText: "Couldn't decline it.", submit: vi.fn(async () => ({})),
} })
const row = (id: string, actions: RowAction[] = [tap(id)]): QuickRow => ({ id, subject: `Person ${id}`, facts: [], flags: [], actions })
const group = (key: GroupKey, o: Partial<GroupModel> = {}): GroupModel => ({
  key, title: TITLES[key][0], noun: TITLES[key][1], phase: 'ready', refetch: vi.fn(), count: o.rows?.length ?? 0, rows: [],
  subjectHeader: 'Staff', columns: [], link: { to: `/${key}`, openLabel: `Open ${TITLES[key][0]}` }, ...o,
})
const tabs = () => screen.getAllByRole('tab')
const selected = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')

describe('NeedsYourDecision — the tabs (SHAPE §3)', () => {
  it('gives each group a tab in the order given, its count in the label, a dash while waiting or failed, and mutes a group at zero', () => {
    render(<Harness groups={[
      group('completions', { rows: [row('a'), row('b')] }), group('leave'), group('incidents', { phase: 'loading' }), group('compliance', { phase: 'error' }), group('tasks', { count: 7, rows: [row('c')] }),
    ]} />)

    expect(screen.getByRole('tablist', { name: 'Needs your decision' })).toBeInTheDocument()
    // One sr-only text node names each tab; the visible title and count pill are hidden from the name (bolder, SHAPE §2).
    expect(tabs().map((tab) => tab.querySelector('.sr-only')!.textContent)).toEqual(['Completions (2)', 'Leave (0)', 'Incidents, loading', "Credentials, couldn't load", 'Tasks (7)'])
    expect(tabs().map((tab) => tab.querySelector('[aria-hidden="true"]')!.textContent)).toEqual(['Completions2', 'Leave0', 'Incidents–', 'Credentials–', 'Tasks7'])
    expect(screen.getByRole('tab', { name: 'Incidents, loading' })).toBeEnabled()
    expect(screen.getByRole('tab', { name: "Credentials, couldn't load" })).toBeEnabled()
    expect(screen.getByRole('tab', { name: 'Leave (0)' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Completions (2)' })).toBeEnabled()
  })

  it('opens the first tab with rows, even when an earlier one is still waiting', () => {
    render(<Harness groups={[group('completions', { phase: 'loading' }), group('leave', { rows: [row('a')] })]} />)

    expect(selected()).toHaveTextContent('Leave (1)')
  })

  it('opens the first present tab (its loading line) when no tab has rows yet', () => {
    render(<Harness groups={[group('completions'), group('leave', { phase: 'loading' }), group('tasks', { phase: 'error' })]} />)

    expect(selected()).toHaveAccessibleName('Leave, loading')
    expect(screen.getByText('Loading leave requests…')).toBeVisible()
  })

  it('mounts one panel per present group, every one but the open one hidden, each labelled by its tab; a muted tab has none', () => {
    render(<Harness groups={[group('completions', { rows: [row('a')] }), group('leave'), group('tasks', { rows: [row('b')] })]} />)

    const panels = screen.getAllByRole('tabpanel', { hidden: true })
    expect(panels.map((panel) => panel.id)).toEqual(['decisions-panel-completions', 'decisions-panel-tasks'])
    expect(panels[0]).not.toHaveAttribute('hidden')
    expect(panels[1]).toHaveAttribute('hidden')
    expect(panels[1]).toHaveAttribute('aria-labelledby', 'decisions-tab-tasks')
    expect(screen.getByRole('tab', { name: 'Tasks (1)' })).toHaveAttribute('aria-controls', 'decisions-panel-tasks')
    expect(screen.getByRole('tab', { name: 'Leave (0)' })).not.toHaveAttribute('aria-controls')
  })

  it('switches on a click and keeps a half-typed reason in the tab it left', () => {
    render(<Harness groups={[group('completions', { rows: [row('a', [decline('a')])] }), group('tasks', { rows: [row('b')] })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline: Person a' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Short-staffed' } })

    fireEvent.click(screen.getByRole('tab', { name: 'Tasks (1)' }))
    expect(screen.getByText('Person b')).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Completions (1)' }))

    expect(screen.getByRole('textbox')).toHaveValue('Short-staffed')
  })

  it('names the groups at zero in the foot All clear row, beside their muted tabs', () => {
    render(<Harness groups={[group('completions', { rows: [row('a')] }), group('leave'), group('compliance')]} />)

    expect(screen.getByText(/^All clear/).closest('p')).toHaveTextContent('All clear on leave requests and staff credentials to update')
  })

  it('draws no strip when every group is at zero: the heading and the All clear row alone', () => {
    render(<Harness groups={[group('completions'), group('leave')]} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Needs your decision' })).toHaveAttribute('id', 'dashboard-decisions')
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByText(/^All clear/).closest('p')).toHaveTextContent('All clear on shift completions and leave requests')
  })
})

describe('NeedsYourDecision — when the open tab empties (SHAPE §3, §5)', () => {
  it('opens the next tab with rows after it, wrapping, and puts focus on that tab', async () => {
    render(<Harness groups={[group('completions', { rows: [row('a')] }), group('leave', { phase: 'loading' }), group('tasks', { rows: [row('c')] })]} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks (1)' }))
    const button = screen.getByRole('button', { name: 'Approve: Person c' })
    button.focus()

    fireEvent.click(button)

    await waitFor(() => expect(selected()).toHaveTextContent('Completions (1)'))
    expect(document.activeElement).toBe(selected())
    expect(screen.getByText('Person a')).toBeVisible()
  })

  it('opens the next present tab when no other has rows', async () => {
    render(<Harness groups={[group('completions', { rows: [row('a')] }), group('leave'), group('tasks', { phase: 'error' })]} />)
    const button = screen.getByRole('button', { name: 'Approve: Person a' })
    button.focus()

    fireEvent.click(button)

    await waitFor(() => expect(selected()).toHaveAccessibleName("Tasks, couldn't load"))
    expect(document.activeElement).toBe(selected())
  })

  it('moves focus to the heading when the last group with anything empties', async () => {
    render(<Harness groups={[group('completions', { rows: [row('a')] }), group('leave')]} />)
    const button = screen.getByRole('button', { name: 'Approve: Person a' })
    button.focus()

    fireEvent.click(button)

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Needs your decision' })))
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  // A switch there hid a leave row's Approve under the click in e2e (2026-10-15): rows on screen are never taken away by a later arrival.
  it('never switches because an earlier tab gained rows, even while the page is still loading', () => {
    const { rerender } = render(<Harness groups={[group('completions', { phase: 'loading' }), group('leave', { rows: [row('a')] })]} />)
    expect(selected()).toHaveTextContent('Leave (1)')

    rerender(<Harness groups={[group('completions', { rows: [row('b')] }), group('leave', { rows: [row('a')] })]} />)

    expect(selected()).toHaveTextContent('Leave (1)')
  })

  it('moves an arrival tab still on its loading line to the first tab with rows once one has them', () => {
    const { rerender } = render(<Harness groups={[group('completions', { phase: 'loading' }), group('leave', { phase: 'loading' })]} />)
    expect(selected()).toHaveAccessibleName('Completions, loading')

    rerender(<Harness groups={[group('completions', { phase: 'loading' }), group('leave', { rows: [row('a')] })]} />)

    expect(selected()).toHaveTextContent('Leave (1)')
  })

  it('keeps the tab the viewer picked while other groups are still loading', () => {
    const { rerender } = render(<Harness groups={[group('completions', { phase: 'loading' }), group('leave', { rows: [row('a')] }), group('tasks', { rows: [row('c')] })]} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks (1)' }))

    rerender(<Harness groups={[group('completions', { rows: [row('b')] }), group('leave', { rows: [row('a')] }), group('tasks', { rows: [row('c')] })]} />)

    expect(selected()).toHaveTextContent('Tasks (1)')
  })

  it('keeps a tab whose last row left while it holds a notice: "(0)", enabled, open', async () => {
    const notice = { title: 'Person a', message: 'Leave approved. It overlaps 1 shift, and it has a cover task.', link: { label: 'Open roster', to: '/rostering' } }
    render(<Harness groups={[group('leave', { rows: [row('a', [tap('a', async () => ({ notice }))])] }), group('tasks', { rows: [row('b')] })]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve: Person a' }))

    expect(await screen.findByText(notice.message)).toBeVisible()
    expect(selected()).toHaveTextContent('Leave (0)')
    expect(selected()).toBeEnabled()
  })

  it('puts focus on the newly opened tab when dismissing the last notice empties the tab', async () => {
    const notice = { title: 'Person a', message: 'Leave approved. It overlaps 1 shift, and it has a cover task.', link: { label: 'Open roster', to: '/rostering' } }
    render(<Harness groups={[group('leave', { rows: [row('a', [tap('a', async () => ({ notice }))])] }), group('tasks', { rows: [row('b')] })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve: Person a' }))
    await screen.findByText(notice.message)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice about Person a' }))

    await waitFor(() => expect(selected()).toHaveTextContent('Tasks (1)'))
    expect(document.activeElement).toBe(selected())
  })

  it('finishes a tap left in flight by a tab switch in its hidden panel, without moving focus', async () => {
    let resolve!: (o: ActionOutcome) => void
    const run = () => new Promise<ActionOutcome>((res) => { resolve = res })
    render(<Harness groups={[group('completions', { rows: [row('a', [tap('a', run)]), row('x')] }), group('tasks', { rows: [row('b')] })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve: Person a' }))
    const tasksTab = screen.getByRole('tab', { name: 'Tasks (1)' })
    fireEvent.click(tasksTab)
    tasksTab.focus()

    resolve({ announce: 'Approved Person a.' })

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Completions (1)' })).toBeInTheDocument())
    expect(document.activeElement).toBe(tasksTab)
    expect(within(screen.getByRole('tabpanel')).getByText('Person b')).toBeVisible()
  })
})

describe('NeedsYourDecision — bolder and bulk runs (decision-bulk SHAPE §2, §6)', () => {
  it('draws each count as the tab-counter pill: solid olive on the open tab, Mist on the others', () => {
    render(<Harness groups={[group('completions', { rows: [row('a')] }), group('tasks', { rows: [row('b')] })]} />)
    const pill = (name: string) => screen.getByRole('tab', { name }).querySelector('[aria-hidden="true"] > span:last-child')!

    expect(pill('Completions (1)')).toHaveClass('bg-[var(--color-primary)]', 'text-[var(--color-primary-foreground)]', 'rounded-full', 'text-xs', 'font-bold')
    expect(pill('Tasks (1)')).toHaveClass('bg-[var(--color-surface-container)]', 'text-[var(--color-foreground)]')
  })

  it('keeps the tab open while a run is in flight though the refetch empties it mid-run, and lands the notice in its panel', async () => {
    function Live() {
      const [emptied, setEmptied] = useState(false)
      const rows = emptied ? [] : ['a', 'b', 'c'].map((id) => row(id, [tap(id, async () => {
        // The real server: each approval invalidates the list, and the refetch after the second comes back empty.
        if (id === 'b') setEmptied(true)
        return { announce: `Approved Person ${id}.` }
      })]))
      return <Harness groups={[group('leave', { rows, count: rows.length }), group('tasks', { rows: [row('t')] })]} />
    }
    render(<Live />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve all 3 leave requests' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Approve 3' }))

    await waitFor(() => expect(screen.getByText('Approved 3 leave requests')).toBeInTheDocument())
    expect(selected()).toHaveAccessibleName('Leave (0)')
    expect(within(screen.getByRole('tabpanel')).getByText('Approved 3 leave requests')).toBeVisible()
  })
})

describe('NeedsYourDecision — a decided row stays gone until its own group reads again (deep review R3, S-R3-1)', () => {
  const later = (ms: number) => Date.now() + ms
  const groupsAt = (leave: { rows: QuickRow[]; readAt: number }, tasksReadAt: number) => [
    group('leave', { ...leave, count: leave.rows.length }),
    group('tasks', { rows: [row('t')], readAt: tasksReadAt }),
  ]
  const approveL1 = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Approve: Person l1' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve: Person l1' })).not.toBeInTheDocument())
  }

  it('keeps an approved leave row gone when the tasks refetch lands first, and after the leave refetch that no longer lists it', async () => {
    const { rerender } = render(<Harness groups={groupsAt({ rows: [row('l1'), row('l2')], readAt: 1 }, 1)} />)
    await approveL1()

    rerender(<Harness groups={groupsAt({ rows: [row('l1'), row('l2')], readAt: 1 }, later(60_000))} />)
    expect(screen.queryByRole('button', { name: 'Approve: Person l1' })).not.toBeInTheDocument()

    rerender(<Harness groups={groupsAt({ rows: [row('l2')], readAt: later(120_000) }, later(60_000))} />)
    expect(screen.queryByRole('button', { name: 'Approve: Person l1' })).not.toBeInTheDocument()
  })

  it('keeps the row gone while the leave refetch fails: the cached pre-approval data never gets a live Approve', async () => {
    const { rerender } = render(<Harness groups={groupsAt({ rows: [row('l1'), row('l2')], readAt: 1 }, 1)} />)
    await approveL1()

    // Tasks read again; Leave's read rejected, so its readAt never moved.
    rerender(<Harness groups={groupsAt({ rows: [row('l1'), row('l2')], readAt: 1 }, later(60_000))} />)
    rerender(<Harness groups={groupsAt({ rows: [row('l1'), row('l2')], readAt: 1 }, later(120_000))} />)

    expect(screen.queryByRole('button', { name: 'Approve: Person l1' })).not.toBeInTheDocument()
  })

  it('shows the row again when its own group reads later and still lists it', async () => {
    const { rerender } = render(<Harness groups={groupsAt({ rows: [row('l1'), row('l2')], readAt: 1 }, 1)} />)
    await approveL1()

    rerender(<Harness groups={groupsAt({ rows: [row('l1'), row('l2')], readAt: later(60_000) }, 1)} />)

    expect(await screen.findByRole('button', { name: 'Approve: Person l1' })).toBeInTheDocument()
  })
})
