import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PageState } from './PageState'

const renderState = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

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
  it.each(['resolve', 'reject'] as const)('holds one retry until the request settles: %s', async (outcome) => {
    const request = deferred()
    const onRetry: () => unknown = vi.fn(() => request.promise)
    renderState(<PageState kind="error" noun="trip" onRetry={onRetry} />)
    const retry = screen.getByRole('button', { name: 'Try again' })
    fireEvent.click(retry)
    expect(retry).toHaveAttribute('aria-disabled', 'true')
    expect(retry).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Trying again')
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
    await act(async () => {
      if (outcome === 'resolve') request.resolve()
      else request.reject(new Error('private transport detail'))
    })
    expect(retry).not.toHaveAttribute('aria-disabled', 'true')
    expect(retry).not.toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this trip.")
    expect(screen.queryByText('private transport detail')).not.toBeInTheDocument()
    if (outcome === 'reject') expect(screen.getByRole('status')).toHaveTextContent("Couldn't load it again.")
    await act(async () => { fireEvent.click(retry) })
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it.each([{ isError: true }, { status: 'error' }])('counts a request that resolves with a failed result as failed: %o', async (result) => {
    const request = deferred()
    renderState(<PageState kind="error" noun="trip" onRetry={() => request.promise.then(() => result)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await act(async () => { request.resolve() })
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't load it again.")
  })

  it('treats a resolved success result as success', async () => {
    const request = deferred()
    renderState(<PageState kind="error" noun="trip" onRetry={() => request.promise.then(() => ({ isError: false, status: 'success' }))} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await act(async () => { request.resolve() })
    expect(screen.queryByText("Couldn't load it again.")).not.toBeInTheDocument()
  })

  it('does not invent a pending request for a synchronous callback', () => {
    const onRetry = vi.fn()
    renderState(<PageState kind="error" noun="trip" onRetry={onRetry} />)
    const retry = screen.getByRole('button', { name: 'Try again' })
    fireEvent.click(retry)
    expect(retry).not.toHaveAttribute('aria-disabled', 'true')
    expect(retry).not.toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('Trying again…')).not.toBeInTheDocument()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('keeps keyboard focus while held and after settling, without taking it from another control', async () => {
    const first = deferred()
    const second = deferred()
    const onRetry = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    renderState(<><PageState kind="error" noun="trip" onRetry={onRetry} /><button>Another action</button></>)
    const retry = screen.getByRole('button', { name: 'Try again' })
    retry.focus()
    fireEvent.click(retry)
    expect(retry).toHaveFocus()
    await act(async () => { first.resolve() })
    expect(retry).toHaveFocus()
    fireEvent.click(retry)
    screen.getByRole('button', { name: 'Another action' }).focus()
    await act(async () => { second.reject(new Error('offline')) })
    expect(screen.getByRole('button', { name: 'Another action' })).toHaveFocus()
    expect(retry).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('recovers when the callback throws before returning a request', () => {
    const onRetry = vi.fn(() => { throw new Error('private transport detail') })
    renderState(<PageState kind="error" noun="trip" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't load it again.")
    expect(screen.queryByText('private transport detail')).not.toBeInTheDocument()
  })

  it('does not take focus back after the user moves away and blurs another control', async () => {
    const request = deferred()
    renderState(<><PageState kind="error" noun="trip" onRetry={() => request.promise} /><button>Another action</button></>)
    const retry = screen.getByRole('button', { name: 'Try again' })
    retry.focus()
    fireEvent.click(retry)
    const other = screen.getByRole('button', { name: 'Another action' })
    other.focus()
    other.blur()
    await act(async () => { request.reject(new Error('offline')) })
    expect(document.body).toHaveFocus()
    expect(retry).not.toHaveFocus()
  })

  it.each(['resolve', 'reject'] as const)('can leave while retry is pending: %s', async (outcome) => {
    const request = deferred()
    const { unmount } = renderState(<PageState kind="error" noun="trip" onRetry={() => request.promise} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    unmount()
    await act(async () => {
      if (outcome === 'resolve') request.resolve()
      else request.reject(new Error('request failed after leaving'))
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is an assertive alert in the danger tone, and says it is a failure, not a missing record', () => {
    renderState(<PageState kind="error" noun="property" />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load this property. Check your connection and try again.")
    expect(alert).toHaveClass('text-[var(--color-destructive)]')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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

describe('PageState: error detail', () => {
  it('shows the given detail as one line under the title, and nothing extra without it', () => {
    const { rerender } = renderState(<PageState kind="error" noun="payroll" detail="Employment Hero refused the API key." />)
    expect(screen.getByText('Employment Hero refused the API key.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this payroll.")
    rerender(<MemoryRouter><PageState kind="error" noun="payroll" /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent(/^Couldn't load this payroll\. Check your connection and try again\.$/)
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
