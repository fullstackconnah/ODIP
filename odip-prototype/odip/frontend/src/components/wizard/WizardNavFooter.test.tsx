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
})
