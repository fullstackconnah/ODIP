import type { ComponentProps } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { WizardNavFooter } from './WizardNavFooter'
import { __testHooks } from '@/hooks/useBackNavigation'

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

  it('is one wrapping row at every width (so a phone keeps Cancel or Back and Next on one line), with safe-area bottom clearance', () => {
    renderFooter({ showBack: true })
    const footer = screen.getByRole('button', { name: 'Next' }).closest('div[class*=sticky]')

    expect(footer).toHaveClass('w-full', 'min-w-0', 'flex-row', 'flex-wrap', 'justify-between')
    expect(footer).not.toHaveClass('flex-col')
    expect(footer).toHaveClass('pb-[max(0.75rem,env(safe-area-inset-bottom))]')
  })

  it('sticks above the fixed mobile bottom nav below lg and to the viewport edge from lg', () => {
    // jsdom cannot see that the footer clears the nav (the measured Playwright check does); this pins the mechanism.
    // Pinned at `bottom-0` the footer sits under the z-50 bottom nav on a phone or portrait tablet, so Next is neither
    // visible nor tappable until the very end of the page. The offset is the nav's own height var, so the two cannot drift.
    renderFooter({ showBack: true })
    const footer = screen.getByRole('button', { name: 'Next' }).closest('div[class*=sticky]')
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

  it('shows a summary between the actions, such as a running total, and leaves the footer alone without one', () => {
    renderFooter({ showBack: true, summary: <p>A week: 14 h</p> })
    expect(screen.getByText('A week: 14 h')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
  })
})

// V2-E: the first step has no Back, so it offers the way out in that slot: Cancel, to the same place as the review step's Cancel.
describe('WizardNavFooter — the first step', () => {
  it('offers Cancel where Back would be, and only on a step without Back', () => {
    const { unmount } = renderFooter({ showBack: false })
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/participants')
    unmount()
    renderFooter({ showBack: true })
    expect(screen.queryByRole('link', { name: 'Cancel' })).not.toBeInTheDocument()
  })
})

// NAV F3: the header Back is history-aware, so Cancel goes to the same place (the house rule: Cancel = Back).
describe('WizardNavFooter — Cancel goes where Back goes', () => {
  afterEach(() => __testHooks.reset())
  function fromChecklist() {
    __testHooks.recordCurrentPath('/onboarding/p1')
    __testHooks.recordCurrentPath('/wizard')
  }

  it('returns to the previous in-app screen, on the first step and on the review step', () => {
    fromChecklist()
    const { unmount } = renderFooter({ showBack: false })
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/onboarding/p1')
    unmount()
    renderFooter({ isReviewStep: true })
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/onboarding/p1')
  })

  it('stays on cancelTo with history={false}, for a wizard whose header Back is pinned', () => {
    fromChecklist()
    renderFooter({ showBack: false, history: false })
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/participants')
  })

  it('still trips the unsaved-changes blocker: Cancel is a router link, not a hard navigation', async () => {
    const { createMemoryRouter, RouterProvider, useBlocker } = await import('react-router-dom')
    fromChecklist()
    function Wizard() {
      const blocker = useBlocker(true)
      return (
        <>
          {blocker.state === 'blocked' && <p>Leave without saving?</p>}
          <WizardNavFooter showBack={false} onBack={vi.fn()} onNext={vi.fn()} isReviewStep={false} secondaryActions={[]} cancelTo="/participants" submitLabel="Save" isSubmitting={false} />
        </>
      )
    }
    const router = createMemoryRouter([{ path: '/wizard', element: <Wizard /> }, { path: '*', element: <p>Elsewhere</p> }], { initialEntries: ['/wizard'] })
    render(<RouterProvider router={router} />)
    await userEvent.setup().click(screen.getByRole('link', { name: 'Cancel' }))
    expect(screen.getByText('Leave without saving?')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/wizard')
  })
})
