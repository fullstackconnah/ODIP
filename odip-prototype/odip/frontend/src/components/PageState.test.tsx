import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PageState } from './PageState'

const renderState = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('PageState: loading', () => {
  it('is a polite status that names what is loading', () => {
    renderState(<PageState kind="loading" noun="trip" />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Loading trip…')
  })

  it('keeps the placeholder the pages used: centred in a 16rem band, muted', () => {
    renderState(<PageState kind="loading" noun="staff member" />)
    expect(screen.getByRole('status')).toHaveClass('flex', 'items-center', 'justify-center', 'h-64', 'text-[var(--color-muted-foreground)]')
  })
})

describe('PageState: error', () => {
  it('is an assertive alert in the danger tone, and says it is a failure, not a missing record', () => {
    renderState(<PageState kind="error" noun="property" />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load this property. Check your connection and try again.")
    expect(alert).toHaveClass('text-[var(--color-destructive)]')
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument()
  })

  it('offers "Try again" only when there is something to retry, and calls it', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const { rerender } = renderState(<PageState kind="error" noun="trip" onRetry={onRetry} />)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    rerender(<MemoryRouter><PageState kind="error" noun="trip" /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})

describe('PageState: not found', () => {
  it('says the record is missing, with the noun capitalised', () => {
    renderState(<PageState kind="not-found" noun="staff member" />)
    expect(screen.getByText('Staff member not found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument()
  })

  it('a whole page offers the way out: a real Back link that names where it goes', () => {
    renderState(<PageState kind="not-found" noun="trip" backTo="/trips" backLabel="trips" />)
    const back = screen.getByRole('link', { name: 'Back to trips' })
    expect(back).toHaveAttribute('href', '/trips')
    expect(back).toHaveTextContent('Back')
  })

  it('a tab inside a page that is still on screen has no Back', () => {
    renderState(<PageState kind="not-found" noun="participant" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('PageState: no heading', () => {
  it.each(['loading', 'error', 'not-found'] as const)('%s adds no heading (the one h1 comes from PageHeader)', (kind) => {
    renderState(<PageState kind={kind} noun="trip" />)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
