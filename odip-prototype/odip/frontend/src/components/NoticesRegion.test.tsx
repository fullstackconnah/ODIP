import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoticesRegion } from './NoticesRegion'
import type { Notice } from '@/hooks/useNotices'

const notices: Notice[] = [
  { id: 2, tone: 'success', title: 'Bob Two', message: "We've sent bob@example.com a link to set their password." },
  { id: 1, tone: 'error', title: 'Ann One', message: 'No link was sent to ann@example.com. To try again, use Send set-password email on their row.' },
]

describe('NoticesRegion', () => {
  it('is a live region that is there before the first message, and empty when idle', () => {
    render(<NoticesRegion notices={[]} onDismiss={vi.fn()} />)

    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('puts a notice INTO the same live region, rather than mounting a new one around it', () => {
    const { rerender } = render(<NoticesRegion notices={[]} onDismiss={vi.fn()} />)
    const before = screen.getByRole('status')

    rerender(<NoticesRegion notices={notices} onDismiss={vi.fn()} />)

    expect(screen.getByRole('status')).toBe(before)
    expect(within(before).getByText("We've sent bob@example.com a link to set their password.")).toBeInTheDocument()
  })

  it('names the person on each notice, and shows its message', () => {
    render(<NoticesRegion notices={notices} onDismiss={vi.fn()} />)

    const region = screen.getByRole('status')
    expect(within(region).getByText('Bob Two')).toBeInTheDocument()
    expect(within(region).getByText('Ann One')).toBeInTheDocument()
    expect(within(region).getByText(/No link was sent to ann@example.com/)).toBeInTheDocument()
  })

  it('is ONE live region: its notices do not announce themselves a second time as alerts or statuses', () => {
    render(<NoticesRegion notices={notices} onDismiss={vi.fn()} />)

    const region = screen.getByRole('status')
    expect(within(region).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(region).queryAllByRole('status')).toHaveLength(0)
  })

  it('lets the text break, so a long address cannot push the notice wider than its container', () => {
    render(<NoticesRegion notices={notices} onDismiss={vi.fn()} />)

    expect(screen.getByText(/No link was sent to ann@example.com/)).toHaveClass('break-words')
  })

  it('gives each notice a real Dismiss button that names who it is about, and dismisses that one', async () => {
    const onDismiss = vi.fn()
    const u = userEvent.setup()
    render(<NoticesRegion notices={notices} onDismiss={onDismiss} />)

    const dismiss = screen.getByRole('button', { name: 'Dismiss notice about Ann One' })
    expect(dismiss.tagName).toBe('BUTTON')
    await u.click(dismiss)

    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledWith(1)
    expect(screen.getByRole('button', { name: 'Dismiss notice about Bob Two' })).toBeInTheDocument()
  })

  it('marks a failure so it is not mistaken for good news', () => {
    render(<NoticesRegion notices={notices} onDismiss={vi.fn()} />)

    expect(screen.getByText('Ann One').closest('[data-tone]')).toHaveAttribute('data-tone', 'error')
    expect(screen.getByText('Bob Two').closest('[data-tone]')).toHaveAttribute('data-tone', 'success')
  })
})
