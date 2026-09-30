import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { WizardNavFooter } from './WizardNavFooter'

function renderFooter(overrides: Partial<ComponentProps<typeof WizardNavFooter>> = {}) {
  return render(
    <MemoryRouter>
      <WizardNavFooter
        showBack={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
        isReviewStep={false}
        secondaryActions={[]}
        cancelTo="/participants"
        submitLabel="Create Participant"
        isSubmitting={false}
        {...overrides}
      />
    </MemoryRouter>,
  )
}

describe('WizardNavFooter', () => {
  it('shows Next (not Cancel/Submit) on a non-review step', () => {
    renderFooter({ isReviewStep: false })
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create participant/i })).not.toBeInTheDocument()
  })

  it('shows Cancel + Submit (not Next) on the review step', () => {
    renderFooter({ isReviewStep: true })
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/participants')
    expect(screen.getByRole('button', { name: 'Create Participant' })).toBeInTheDocument()
  })

  it('hides Back when showBack is false', () => {
    renderFooter({ showBack: false })
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('renders each secondary action and wires its onClick/disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    renderFooter({ secondaryActions: [{ key: 'save-draft', label: 'Save as draft', onClick, disabled: false }] })
    const btn = screen.getByRole('button', { name: 'Save as draft' })
    await user.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('uses a full-width, wrapping mobile layout with safe-area bottom clearance', () => {
    renderFooter({ showBack: true })
    const footer = screen.getByRole('button', { name: 'Next' }).closest('div[class*=flex-col]')

    expect(footer).toHaveClass('w-full', 'min-w-0', 'flex-col', 'sm:flex-row')
    expect(footer).toHaveClass('pb-[max(0.75rem,env(safe-area-inset-bottom))]')
  })

  it('sticks above the fixed mobile bottom nav below lg and to the viewport edge from lg', () => {
    // jsdom cannot see that the footer clears the nav (the measured Playwright check does); this pins the mechanism.
    // Pinned at `bottom-0` the footer sits under the z-50 bottom nav on a phone or portrait tablet, so Next is neither
    // visible nor tappable until the very end of the page. The offset is the nav's own height var, so the two cannot drift.
    renderFooter({ showBack: true })
    const footer = screen.getByRole('button', { name: 'Next' }).closest('div[class*=flex-col]')
    expect(footer).toHaveClass('sticky', 'bottom-[var(--mobile-nav-h)]', 'lg:bottom-0')
    expect(footer).not.toHaveClass('bottom-0')
  })

  it('keeps the primary action keyboard-operable in the responsive footer', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    renderFooter({ showBack: true, onNext })

    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})
