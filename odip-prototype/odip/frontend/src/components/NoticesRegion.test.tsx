import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoticesRegion } from './NoticesRegion'
import type { Notice } from '@/hooks/useNotices'

const notices: Notice[] = [
  { id: 2, tone: 'success', title: 'Bob Two', message: "We've sent bob@example.com a link to set their password." },
  { id: 1, tone: 'danger', title: 'Ann One', message: 'No link was sent to ann@example.com. To try again, use Send set-password email on their row.' },
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

    expect(screen.getByText('Ann One').closest('[data-tone]')).toHaveAttribute('data-tone', 'danger')
    expect(screen.getByText('Bob Two').closest('[data-tone]')).toHaveAttribute('data-tone', 'success')
  })
})

describe('NoticesRegion: what assistive technology is told', () => {
  it('announces only what is ADDED, and only that notice, instead of re-reading the older ones each time', () => {
    render(<NoticesRegion notices={notices} onDismiss={vi.fn()} />)

    // role=status implies aria-atomic=true, which would make every new notice re-read the whole region.
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-atomic', 'false')
    expect(region).toHaveAttribute('aria-relevant', 'additions')
  })
})

describe('NoticesRegion: where focus goes when a notice is dismissed', () => {
  // The notice being dismissed holds focus (its Dismiss button) and is about to leave the page; focus must not fall to the top of the page.
  const three: Notice[] = [
    { id: 3, tone: 'success', title: 'Cat Three', message: 'Three.', subject: 'u3' },
    { id: 2, tone: 'danger', title: 'Bob Two', message: 'Two.', subject: 'u2' },
    { id: 1, tone: 'success', title: 'Ann One', message: 'One.', subject: 'u1' },
  ]

  function Harness({ initial, focusAfterDismiss }: { initial: Notice[]; focusAfterDismiss?: (notice: Notice) => HTMLElement | null }) {
    const [list, setList] = useState(initial)
    return (
      <>
        <NoticesRegion notices={list} onDismiss={id => setList(current => current.filter(n => n.id !== id))} focusAfterDismiss={focusAfterDismiss} />
        <button type="button">The row action</button>
      </>
    )
  }

  const dismissOf = (name: string) => screen.getByRole('button', { name: `Dismiss notice about ${name}` })

  it('goes to the Dismiss button of the next notice', async () => {
    const u = userEvent.setup()
    render(<Harness initial={three} />)

    await u.click(dismissOf('Cat Three'))

    expect(dismissOf('Bob Two')).toHaveFocus()
  })

  it('goes to the one before it when the dismissed notice was the last', async () => {
    const u = userEvent.setup()
    render(<Harness initial={three} />)

    await u.click(dismissOf('Ann One'))

    expect(dismissOf('Bob Two')).toHaveFocus()
  })

  it('goes to whatever the screen names, with the dismissed notice, when it was the only one', async () => {
    const u = userEvent.setup()
    const focusAfterDismiss = vi.fn(() => screen.getByRole('button', { name: 'The row action' }))
    render(<Harness initial={[three[1]]} focusAfterDismiss={focusAfterDismiss} />)

    await u.click(dismissOf('Bob Two'))

    expect(focusAfterDismiss).toHaveBeenCalledWith(expect.objectContaining({ id: 2, subject: 'u2' }))
    expect(screen.getByRole('button', { name: 'The row action' })).toHaveFocus()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('does not ask the screen while another notice can take focus', async () => {
    const u = userEvent.setup()
    const focusAfterDismiss = vi.fn(() => null)
    render(<Harness initial={three} focusAfterDismiss={focusAfterDismiss} />)

    await u.click(dismissOf('Bob Two'))

    expect(focusAfterDismiss).not.toHaveBeenCalled()
  })

  it('leaves focus alone, and breaks nothing, when the screen names nowhere to go', async () => {
    const u = userEvent.setup()
    render(<Harness initial={[three[0]]} />)

    await u.click(dismissOf('Cat Three'))

    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})
