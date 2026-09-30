import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ActionButtons } from './ActionButtons'
import { TAP_AREA } from './tapArea'

function renderButtons(props: React.ComponentProps<typeof ActionButtons>) {
  return render(
    <MemoryRouter>
      <ActionButtons {...props} />
    </MemoryRouter>,
  )
}

/** All four controls at once: Edit as a link, Edit as a button, Restore and Archive can't coexist, so two renders. */
function allControls() {
  const { unmount } = renderButtons({ editTo: '/things/1/edit', onEdit: vi.fn(), onDelete: vi.fn() })
  const active = [screen.getByRole('link', { name: 'Edit' }), screen.getByRole('button', { name: 'Edit' }), screen.getByRole('button', { name: 'Archive' })]
  unmount()
  renderButtons({ onRestore: vi.fn(), showArchived: true })
  return [...active, screen.getByRole('button', { name: 'Restore' })]
}

describe('ActionButtons — what it renders', () => {
  it('renders an Edit link, an Edit button and an Archive button with their names and tooltips', () => {
    renderButtons({ editTo: '/things/1/edit', onEdit: vi.fn(), onDelete: vi.fn() })

    const link = screen.getByRole('link', { name: 'Edit' })
    expect(link).toHaveAttribute('href', '/things/1/edit')
    expect(link).toHaveAttribute('title', 'Edit')
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('title', 'Edit')
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveAttribute('title', 'Archive')
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
  })

  it('swaps Archive for Restore on the archived view', () => {
    renderButtons({ onDelete: vi.fn(), onRestore: vi.fn(), showArchived: true })

    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
  })

  it('runs the handler and stops the click from reaching the table row behind it', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const onRowClick = vi.fn()
    render(
      <MemoryRouter>
        <div onClick={onRowClick}>
          <ActionButtons onDelete={onDelete} />
        </div>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Archive' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onRowClick).not.toHaveBeenCalled()
  })
})

// Density polish (touch): Edit / Archive were 36px in a table row and 28px elsewhere, both under 44. jsdom applies no
// CSS, so this pins the class contract: TAP_AREA for the 44px hit area, the --control-h-sm square for the coarse size,
// and 8px between the buttons so the pads touch and never overlap.
describe('ActionButtons — 44px hit areas on a coarse pointer', () => {
  it('gives every icon control the TAP_AREA pad, so a tap within 44px lands on it', () => {
    for (const control of allControls()) {
      expect(control).toHaveClass(...TAP_AREA.split(' '))
    }
  })

  it('sizes each one the --control-h-sm square under a coarse pointer (36px), the size Button iconOnly is there', () => {
    for (const control of allControls()) {
      expect(control).toHaveClass(
        'pointer-coarse:inline-flex', 'pointer-coarse:size-[var(--control-h-sm)]', 'pointer-coarse:items-center',
        'pointer-coarse:justify-center', 'pointer-coarse:p-0',
      )
    }
  })

  it('keeps the mouse look: p-1.5 around the 16px icon, rounded, the same hover colours', () => {
    const [link, edit, archive, restore] = allControls()

    for (const control of [link, edit, archive, restore]) {
      expect(control).toHaveClass('p-1.5', 'rounded', 'text-[var(--color-muted-foreground)]', 'transition-colors')
      expect(control.querySelector('svg')).toHaveClass('w-4', 'h-4')
    }
    expect(link).toHaveClass('inline-block', 'hover:bg-[var(--color-accent)]', 'hover:text-[var(--color-primary)]')
    expect(edit).toHaveClass('hover:bg-[var(--color-accent)]', 'hover:text-[var(--color-primary)]')
    expect(archive).toHaveClass('hover:bg-red-500/20', 'hover:text-red-400')
    expect(restore).toHaveClass('hover:bg-green-500/20', 'hover:text-green-400')
  })

  it('opens the gap from 4px to 8px on touch: two 36px buttons with 4px pads each touch, never overlap', () => {
    renderButtons({ editTo: '/x', onDelete: vi.fn() })

    const cluster = screen.getByRole('link', { name: 'Edit' }).parentElement as HTMLElement
    expect(cluster).toHaveClass('flex', 'items-center', 'gap-1', 'pointer-coarse:gap-2')
  })

  it('never hard-codes a size: the coarse square comes from the token, the pad from --tap-min', () => {
    for (const control of allControls()) {
      expect(control.className).not.toMatch(/(^|\s)[a-z:-]*(?:size|h|w|min-h|min-w)-\[?\d/)
      expect(control.className).not.toMatch(/44px/)
    }
  })
})
