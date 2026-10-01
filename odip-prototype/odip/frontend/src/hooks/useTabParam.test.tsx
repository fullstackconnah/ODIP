import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import { useTabParam } from './useTabParam'

const KEYS = ['overview', 'bookings', 'history'] as const

function Harness({ defaultKey = 'overview' as (typeof KEYS)[number] }) {
  const [tab, setTab] = useTabParam(KEYS, defaultKey)
  const loc = useLocation()
  return (
    <>
      <p data-testid="tab">{tab}</p>
      <p data-testid="url">{loc.pathname + loc.search}</p>
      <button type="button" onClick={() => setTab('bookings')}>bookings</button>
      <button type="button" onClick={() => setTab('overview')}>overview</button>
      <button type="button" onClick={() => setTab('nope')}>nope</button>
    </>
  )
}

const renderAt = (url: string, ui = <Harness />) => render(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>)

describe('useTabParam', () => {
  it('reads the tab from ?tab=', () => {
    renderAt('/x?tab=bookings')
    expect(screen.getByTestId('tab')).toHaveTextContent('bookings')
  })

  it('falls back to the default when the param is missing, empty or not one of the keys', () => {
    for (const url of ['/x', '/x?tab=', '/x?tab=bogus', '/x?tab=BOOKINGS']) {
      const { unmount } = renderAt(url)
      expect(screen.getByTestId('tab')).toHaveTextContent('overview')
      unmount()
    }
  })

  it('writes ?tab= when a non-default tab is chosen, and the new tab is read back', async () => {
    const user = userEvent.setup()
    renderAt('/x')
    await user.click(screen.getByRole('button', { name: 'bookings' }))
    expect(screen.getByTestId('url')).toHaveTextContent('/x?tab=bookings')
    expect(screen.getByTestId('tab')).toHaveTextContent('bookings')
  })

  it('deletes the param when the default tab is chosen, so the default has the clean URL', async () => {
    const user = userEvent.setup()
    renderAt('/x?tab=bookings')
    await user.click(screen.getByRole('button', { name: 'overview' }))
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/x$/)
    expect(screen.getByTestId('tab')).toHaveTextContent('overview')
  })

  it('honours the default it was given (a page whose first tab is not "overview")', async () => {
    const user = userEvent.setup()
    renderAt('/x?tab=overview', <Harness defaultKey="bookings" />)
    expect(screen.getByTestId('tab')).toHaveTextContent('overview')
    await user.click(screen.getByRole('button', { name: 'bookings' }))
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/x$/)
  })

  it('keeps every other query param, in both directions', async () => {
    const user = userEvent.setup()
    renderAt('/x?userId=7&tab=bookings&from=dash')
    await user.click(screen.getByRole('button', { name: 'overview' }))
    expect(screen.getByTestId('url')).toHaveTextContent('/x?userId=7&from=dash')
    await user.click(screen.getByRole('button', { name: 'bookings' }))
    expect(screen.getByTestId('url')).toHaveTextContent('/x?userId=7&from=dash&tab=bookings')
  })

  it('ignores a key that is not in the list instead of writing a URL the page cannot read', async () => {
    const user = userEvent.setup()
    renderAt('/x?tab=bookings')
    await user.click(screen.getByRole('button', { name: 'nope' }))
    expect(screen.getByTestId('url')).toHaveTextContent('/x?tab=bookings')
    expect(screen.getByTestId('tab')).toHaveTextContent('bookings')
  })

  it('replaces the history entry, so Back leaves the page rather than stepping through tabs', async () => {
    const user = userEvent.setup()
    function Pages() {
      const [, setTab] = useTabParam(KEYS, 'overview')
      const navType = useNavigationType()
      return (
        <>
          <p data-testid="nav">{navType}</p>
          <button type="button" onClick={() => setTab('history')}>switch</button>
        </>
      )
    }
    render(<MemoryRouter initialEntries={['/x']}><Pages /></MemoryRouter>)
    expect(screen.getByTestId('nav')).toHaveTextContent('POP')
    await user.click(screen.getByRole('button', { name: 'switch' }))
    expect(screen.getByTestId('nav')).toHaveTextContent('REPLACE')
  })
})
