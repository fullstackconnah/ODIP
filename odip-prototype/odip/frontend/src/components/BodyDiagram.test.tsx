import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BodyDiagram, type BodyDiagramInjury } from './BodyDiagram'
import { BODY_REGIONS, BODY_REGION_LABELS } from '@/api/types/enums'

// BodyDiagram is a controlled component (injuries/onAdd/onRemove) — this harness owns the
// injuries array the way a real wizard step (backed by useFieldArray) eventually will.
function Harness({ initial = [] as BodyDiagramInjury[] }) {
  const [injuries, setInjuries] = useState<BodyDiagramInjury[]>(initial)
  return (
    <BodyDiagram
      injuries={injuries}
      onAdd={(region, injuryType, description) =>
        setInjuries(prev => [...prev, { region, injuryType, description }])
      }
      onRemove={index => setInjuries(prev => prev.filter((_, i) => i !== index))}
    />
  )
}

async function fillDescriptionAndAdd(user: ReturnType<typeof userEvent.setup>, text: string) {
  const textarea = screen.getByLabelText(/Description/)
  await user.clear(textarea)
  await user.type(textarea, text)
  await user.click(screen.getByRole('button', { name: 'Add injury' }))
}

describe('BodyDiagram accessibility — the button list is the primary control', () => {
  it('renders one aria-pressed button per BodyRegion, and every one has an accessible name', () => {
    render(<Harness />)

    for (const region of BODY_REGIONS) {
      const button = screen.getByRole('button', { name: BODY_REGION_LABELS[region] })
      expect(button).toHaveAttribute('aria-pressed')
    }
  })

  it('both SVG diagrams are aria-hidden decoration', () => {
    render(<Harness />)

    expect(screen.getByTestId('body-svg-front')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('body-svg-back')).toHaveAttribute('aria-hidden', 'true')
  })

  it('is reachable by Tab alone — a region button becomes the focused element with no pointer input', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    let reachedRegionButton = false
    for (let i = 0; i < 80 && !reachedRegionButton; i++) {
      await user.tab()
      const active = document.activeElement
      reachedRegionButton = !!(active instanceof HTMLButtonElement && active.dataset.region)
    }

    expect(reachedRegionButton).toBe(true)
  })

  it('keyboard-only: focusing a region button and pressing Enter toggles aria-pressed', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const head = screen.getByRole('button', { name: 'Head' })
    head.focus()
    expect(head).toHaveFocus()
    expect(head).toHaveAttribute('aria-pressed', 'false')

    await user.keyboard('{Enter}')
    expect(head).toHaveAttribute('aria-pressed', 'true')

    await user.keyboard('{Enter}')
    expect(head).toHaveAttribute('aria-pressed', 'false')
  })
})

// Landing-spotted: the selected region pill and the Add injury button used --color-on-primary, which index.css never defines, so their
// text fell back to the inherited dark ink on the dark green primary. --color-primary-foreground is the defined white.
describe('BodyDiagram — legible on the primary fill', () => {
  it('sets the selected region pill and the Add injury button in the defined on-primary colour', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Chest' }))
    const pill = screen.getByRole('button', { name: 'Chest' })
    expect(pill).toHaveAttribute('aria-pressed', 'true')
    expect(pill).toHaveClass('bg-[var(--color-primary)]', 'text-[var(--color-primary-foreground)]')
    expect(screen.getByRole('button', { name: 'Add injury' })).toHaveClass('bg-[var(--color-primary)]', 'text-[var(--color-primary-foreground)]')
    expect(pill.className).not.toContain('--color-on-primary)')
  })

  it('marks a region that already has an injury in the light success pair, not dark ink on the dark green container', async () => {
    render(<Harness initial={[{ region: 'Head', injuryType: 'Bruise', description: 'Bumped head.' } as BodyDiagramInjury]} />)

    const marked = screen.getByRole('button', { name: 'Head' })
    expect(marked).toHaveClass('bg-[var(--color-primary-fixed)]', 'text-[var(--color-on-primary-fixed)]')
    expect(marked.className).not.toContain('--color-primary-container')
  })
})

describe('BodyDiagram — recording injuries', () => {
  it('selecting a region via the button list, then adding, records it', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Chest' }))
    await fillDescriptionAndAdd(user, 'Bruising across the chest.')

    const table = screen.getByRole('table')
    expect(within(table).getByText('Chest')).toBeInTheDocument()
    expect(within(table).getByText('Bruising across the chest.')).toBeInTheDocument()
  })

  it('selecting a region via its SVG path, then adding, records the identical state as via the button', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByTestId('svg-region-front-Chest'))
    await fillDescriptionAndAdd(user, 'Bruising across the chest.')

    const table = screen.getByRole('table')
    expect(within(table).getByText('Chest')).toBeInTheDocument()
    expect(within(table).getByText('Bruising across the chest.')).toBeInTheDocument()
  })

  it('clicking an SVG path activates its list-button twin (identical aria-pressed state either way)', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const chestButton = screen.getByRole('button', { name: 'Chest' })
    expect(chestButton).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByTestId('svg-region-front-Chest'))
    expect(chestButton).toHaveAttribute('aria-pressed', 'true')

    // Toggling off via the SVG also reaches the same handler.
    await user.click(screen.getByTestId('svg-region-front-Chest'))
    expect(chestButton).toHaveAttribute('aria-pressed', 'false')

    // And the reverse: selecting via the button is reflected on the SVG's own selection state
    // (same underlying draftRegion), producing the same eventual injury row either way.
    await user.click(chestButton)
    expect(chestButton).toHaveAttribute('aria-pressed', 'true')
    await fillDescriptionAndAdd(user, 'Via button.')

    const table = screen.getByRole('table')
    expect(within(table).getByText('Chest')).toBeInTheDocument()
  })

  it('supports multiple injuries, each with independent region/type/description', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Head' }))
    await fillDescriptionAndAdd(user, 'Bumped head.')

    await user.click(screen.getByRole('button', { name: 'Left ankle' }))
    const typeTrigger = screen.getByRole('button', { name: /Injury type/ })
    await user.click(typeTrigger)
    await user.click(screen.getByRole('option', { name: 'Sprain or strain' }))
    await fillDescriptionAndAdd(user, 'Twisted ankle.')

    const rows = screen.getAllByRole('row')
    // Header row + 2 data rows.
    expect(rows).toHaveLength(3)
    const table = screen.getByRole('table')
    expect(within(table).getByText('Head')).toBeInTheDocument()
    expect(within(table).getByText('Bumped head.')).toBeInTheDocument()
    expect(within(table).getByText('Left ankle')).toBeInTheDocument()
    expect(within(table).getByText('Sprain or strain')).toBeInTheDocument()
    expect(within(table).getByText('Twisted ankle.')).toBeInTheDocument()
  })

  it('removing one injury leaves the others intact', async () => {
    const initial: BodyDiagramInjury[] = [
      { region: 'Head', injuryType: 'Bruise', description: 'Bumped head.' },
      { region: 'LeftHand', injuryType: 'Abrasion', description: 'Grazed hand.' },
      { region: 'RightKnee', injuryType: 'Swelling', description: 'Knee swelling.' },
    ]
    render(<Harness initial={initial} />)

    const table = screen.getByRole('table')
    const removeButtons = within(table).getAllByRole('button', { name: 'Remove' })
    expect(removeButtons).toHaveLength(3)

    await userEvent.setup().click(removeButtons[1])

    expect(within(table).getByText('Bumped head.')).toBeInTheDocument()
    expect(within(table).getByText('Knee swelling.')).toBeInTheDocument()
    expect(within(table).queryByText('Grazed hand.')).not.toBeInTheDocument()
    expect(within(table).getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
  })

  it('shows an error and does not add when no region has been selected', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByLabelText(/Description/), 'Something happened.')
    await user.click(screen.getByRole('button', { name: 'Add injury' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/select where on the body/i)
    // Header row + DataTable's own "No injuries recorded yet." empty-state row — nothing added.
    expect(within(screen.getByRole('table')).getByText('No injuries recorded yet.')).toBeInTheDocument()
  })
})
