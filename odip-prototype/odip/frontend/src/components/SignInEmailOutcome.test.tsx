import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignInEmailOutcome } from './SignInEmailOutcome'
import type { EmailOutcome } from '@/lib/signInEmail'

const EMAIL = 'ann@example.com'
const sent: EmailOutcome = { ok: true, email: EMAIL, account: 'created' }
const failed: EmailOutcome = { ok: false, email: EMAIL, reason: 'network' }

describe('SignInEmailOutcome', () => {
  it('announces itself by default: good news is a polite status, a failure is an alert', () => {
    const { rerender } = render(<SignInEmailOutcome outcome={sent} retry="use Send again" />)
    expect(screen.getByRole('status')).toHaveTextContent(`We've sent ${EMAIL} a link to set their password.`)

    rerender(<SignInEmailOutcome outcome={failed} retry="use Send again" />)
    expect(screen.getByRole('alert')).toHaveTextContent(`No link was sent to ${EMAIL}.`)
  })

  it('does not announce itself when something else announces it (a region that was there first), so nothing is said twice', () => {
    const { rerender } = render(<SignInEmailOutcome outcome={sent} retry="use Send again" announce={false} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText(`We've sent ${EMAIL} a link to set their password. It can take a few minutes, so ask them to check spam.`)).toBeInTheDocument()

    rerender(<SignInEmailOutcome outcome={failed} retry="use Send again" announce={false} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/No link was sent to ann@example.com/)).toBeInTheDocument()
  })

  it('offers Send again beside a failure, never beside good news', () => {
    const { rerender } = render(<SignInEmailOutcome outcome={failed} retry="use Send again" onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Send again' })).toBeInTheDocument()

    rerender(<SignInEmailOutcome outcome={sent} retry="use Send again" onRetry={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument()
  })

  it('switches Send again off with aria-disabled, not `disabled`, while it retries: the button that was clicked keeps keyboard focus', async () => {
    const u = userEvent.setup()
    const onRetry = vi.fn()
    const { rerender } = render(<SignInEmailOutcome outcome={failed} retry="use Send again" onRetry={onRetry} />)
    await u.click(screen.getByRole('button', { name: 'Send again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<SignInEmailOutcome outcome={failed} retry="use Send again" onRetry={onRetry} retrying />)

    const busy = screen.getByRole('button', { name: 'Sending...' })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).not.toBeDisabled()
    expect(busy).toHaveClass('aria-disabled:opacity-50', 'aria-disabled:cursor-not-allowed')
  })

  it('does nothing when clicked while it retries (aria-disabled does not stop the click, so the guard does)', async () => {
    const u = userEvent.setup()
    const onRetry = vi.fn()
    render(<SignInEmailOutcome outcome={failed} retry="use Send again" onRetry={onRetry} retrying />)

    await u.click(screen.getByRole('button', { name: 'Sending...' }))

    expect(onRetry).not.toHaveBeenCalled()
  })
})
