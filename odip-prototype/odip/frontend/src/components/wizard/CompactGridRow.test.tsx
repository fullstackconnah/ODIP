import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompactGridRow } from './CompactGridRow'

/**
 * Mimics the real call sites' shape (a YesNoToggleField/AdlLevelToggleField in `hideLabel` mode):
 * a single focusable control whose accessible name IS the row's label (real usage passes
 * `ariaLabel ?? label`), and whose own activation is what drives the row's expand/collapse —
 * CompactGridRow itself owns no independent disclosure trigger of its own, it only reflects the
 * resulting state via `aria-expanded` on its wrapping group.
 */
function AnswerToggle({ label, expanded, onToggle }: { label: string; expanded: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-pressed={expanded} onClick={onToggle}>
      {label}
    </button>
  )
}

function ExpandableRowHarness({ label = 'Widget Consent', initiallyExpanded = false }: { label?: string; initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  return (
    <CompactGridRow
      label={label}
      control={<AnswerToggle label={label} expanded={expanded} onToggle={() => setExpanded((e) => !e)} />}
      expanded={expanded ? <p>Detail for {label}</p> : undefined}
    />
  )
}

describe('CompactGridRow', () => {
  it('renders the label and control; expanded content is absent when collapsed', () => {
    render(<ExpandableRowHarness initiallyExpanded={false} />)

    // The row's own group carries the label as its accessible name (see CompactGridRow's doc:
    // `label` is decorative text, not a `<label htmlFor>`); the row's answer control renders
    // alongside it with its own, separately-verified accessible name (see the dedicated test
    // below) — both happen to render the same text here, so this asserts on role, not text.
    expect(screen.getByRole('group', { name: 'Widget Consent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Widget Consent' })).toBeInTheDocument()
    expect(screen.queryByText('Detail for Widget Consent')).not.toBeInTheDocument()
  })

  it('renders the expanded content when the initial state is already expanded', () => {
    render(<ExpandableRowHarness initiallyExpanded />)

    expect(screen.getByText('Detail for Widget Consent')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Widget Consent' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('keyboard: Enter on the row control expands the row and flips aria-expanded to true, Enter again collapses it back', async () => {
    const user = userEvent.setup()
    render(<ExpandableRowHarness />)

    const group = screen.getByRole('group', { name: 'Widget Consent' })
    expect(group).toHaveAttribute('aria-expanded', 'false')

    await user.tab()
    expect(screen.getByRole('button', { name: 'Widget Consent' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Detail for Widget Consent')).toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Detail for Widget Consent')).not.toBeInTheDocument()
  })

  it('keyboard: Space on the row control expands the row and flips aria-expanded to true, Space again collapses it back', async () => {
    const user = userEvent.setup()
    render(<ExpandableRowHarness />)

    const group = screen.getByRole('group', { name: 'Widget Consent' })

    await user.tab()
    await user.keyboard(' ')
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Detail for Widget Consent')).toBeInTheDocument()

    await user.keyboard(' ')
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Detail for Widget Consent')).not.toBeInTheDocument()
  })

  it('the row control has an accessible name that includes the row label, so a screen-reader user knows which row they are expanding', () => {
    render(<ExpandableRowHarness label="Privacy and Confidentiality Consent" />)

    expect(screen.getByRole('button', { name: 'Privacy and Confidentiality Consent' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Privacy and Confidentiality Consent' })).toBeInTheDocument()
  })

  it('a row with no `expanded` prop at all renders no disclosure semantics — no aria-expanded attribute, nothing beyond the label/control it was given', () => {
    render(
      <CompactGridRow
        label="Static Row"
        control={<span>Just a control, never expands</span>}
      />,
    )

    const group = screen.getByRole('group', { name: 'Static Row' })
    expect(group).not.toHaveAttribute('aria-expanded')
    // No extra toggle/disclosure affordance is introduced by CompactGridRow itself — only
    // what was explicitly passed as `control` renders.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
