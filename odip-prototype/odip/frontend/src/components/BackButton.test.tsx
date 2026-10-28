import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { BackActionButton, BackButton } from './BackButton'
import { __testHooks, usePreviousAppPathTracker } from '@/hooks/useBackNavigation'

beforeEach(() => {
  __testHooks.reset()
})

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname + loc.search}</p>
}

function Tracker() {
  usePreviousAppPathTracker()
  return null
}

function renderAt(ui: React.ReactNode, at = '/staff/s-1') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Tracker />
      <Routes>
        <Route path="*" element={<>{ui}<Where /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('BackButton: the routed forms', () => {
  it('is a real link to `to`, with the visible text "Back" and a name that says where it goes', () => {
    renderAt(<BackButton to="/staff" label="staff" />)
    const back = screen.getByRole('link', { name: 'Back to staff' })
    expect(back).toHaveAttribute('href', '/staff')
    expect(back).toHaveTextContent(/^Back$/)
  })

  it('button (the default) is the secondary Button, 32px with a 44px floor from the density tokens', () => {
    renderAt(<BackButton to="/staff" label="staff" />)
    const back = screen.getByRole('link', { name: 'Back to staff' })
    expect(back).toHaveClass('border', 'h-[var(--control-h)]')
    expect(back.querySelector('svg')).toBeInTheDocument()
  })

  it('icon is a ghost icon-only Button with the --tap-min floor, no visible text, and a tooltip that names the destination', () => {
    renderAt(<BackButton to="/participants" label="participants" variant="icon" className="mt-1" />)
    const back = screen.getByRole('link', { name: 'Back to participants' })
    expect(back).toHaveAttribute('href', '/participants')
    expect(back).toHaveAttribute('title', 'Back to participants')
    expect(back).toHaveClass('min-h-[var(--tap-min)]', 'min-w-[var(--tap-min)]', 'shrink-0', 'mt-1')
    expect(back).toHaveTextContent('')
  })

  it('link is a primary text link with a --tap-min floor and a keyboard-only focus ring', () => {
    renderAt(<BackButton to="/portal" label="my shifts" variant="link" />)
    const back = screen.getByRole('link', { name: 'Back to my shifts' })
    expect(back).toHaveAttribute('href', '/portal')
    expect(back).toHaveTextContent(/^Back$/)
    expect(back).toHaveClass('min-h-[var(--tap-min)]', 'text-[var(--color-primary)]', 'focus-visible:ring-2')
  })

  it('forwards data-testid on every variant', () => {
    renderAt(
      <>
        <BackButton to="/a" label="a" data-testid="b-button" />
        <BackButton to="/a" label="a" variant="icon" data-testid="b-icon" />
        <BackButton to="/a" label="a" variant="link" data-testid="b-link" />
      </>,
    )
    for (const id of ['b-button', 'b-icon', 'b-link']) expect(screen.getByTestId(id)).toHaveAttribute('href', '/a')
  })

  it('navigates to `to` on click', async () => {
    const user = userEvent.setup()
    renderAt(<BackButton to="/staff" label="staff" />)
    await user.click(screen.getByRole('link', { name: 'Back to staff' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/staff')
  })

  it('is reachable by keyboard and activates with Enter', async () => {
    const user = userEvent.setup()
    renderAt(<BackButton to="/staff" label="staff" />)
    await user.tab()
    expect(screen.getByRole('link', { name: 'Back to staff' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent('/staff')
  })
})

describe('BackButton: history', () => {
  // MemoryRouter writes no history.state.idx, so the test seam stands in for it: entries /dash, /staff/s-1 with the second current.
  function renderWithHistory(ui: React.ReactNode, entries = ['/', '/staff/s-1']) {
    entries.slice(0, -1).forEach((p, i) => __testHooks.recordAt(i, p))
    __testHooks.setIdx(entries.length - 1)
    return render(
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Tracker />
        <Routes>
          <Route path="*" element={<>{ui}<Where /></>} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('keeps href = the fallback and the caller label when nothing is before this page (a deep link)', () => {
    renderAt(<BackButton to="/staff" label="staff" />)
    expect(screen.getByRole('link', { name: 'Back to staff' })).toHaveAttribute('href', '/staff')
  })

  it('a click with nothing before this page goes to the fallback', async () => {
    const user = userEvent.setup()
    renderAt(<BackButton to="/staff" label="staff" />)
    await user.click(screen.getByRole('link', { name: 'Back to staff' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/staff')
  })

  it('with a page before this one, a plain click goes back there, the name says so, and the href stays the fallback', async () => {
    const user = userEvent.setup()
    renderWithHistory(<BackButton to="/staff" label="staff" />)
    const back = screen.getByRole('link', { name: 'Back to Dashboard' })
    expect(back).toHaveAttribute('href', '/staff')
    await user.click(back)
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })

  it('goes back to the previous page even when it is not the fallback (a hub tab keeps its query)', async () => {
    const user = userEvent.setup()
    renderWithHistory(<BackButton to="/participants" label="participants" />, ['/participants?tab=onboarding', '/staff/s-1'])
    await user.click(screen.getByRole('link', { name: 'Back to Onboarding' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/participants?tab=onboarding')
  })

  it('keeps the caller label when the previous page IS the fallback', () => {
    renderWithHistory(<BackButton to="/staff" label="staff" />, ['/staff', '/staff/s-1'])
    expect(screen.getByRole('link', { name: 'Back to staff' })).toBeInTheDocument()
  })

  it('says "Go back", not the caller label, when history exists but the page before is unknown (after a reload)', () => {
    __testHooks.setIdx(2)
    render(
      <MemoryRouter initialEntries={['/staff/s-1']}>
        <Tracker />
        <BackButton to="/staff" label="staff" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Go back' })).toBeInTheDocument()
  })

  it('idx 3 with an empty map is "Go back" (a click runs navigate(-1), so the name cannot claim the fallback)', () => {
    __testHooks.setIdx(3)
    render(
      <MemoryRouter initialEntries={['/trips/t-1']}>
        <Tracker />
        <BackButton to="/trips" label="trips" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Go back' })).toBeInTheDocument()
  })

  it('a ctrl-click is left to the browser: the link opens its href (the fallback) and Back does not run', () => {
    renderWithHistory(<BackButton to="/staff" label="staff" />)
    const back = screen.getByRole('link', { name: 'Back to Dashboard' })
    let prevented: boolean | null = null
    const spy = (e: Event) => { prevented = e.defaultPrevented; e.preventDefault() }
    document.addEventListener('click', spy)
    back.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }))
    document.removeEventListener('click', spy)
    // A modified click is left to the browser (the router's own Link does the same).
    expect(prevented).toBe(false)
    expect(screen.getByTestId('where')).toHaveTextContent('/staff/s-1')
  })

  it('can be rendered after an early return without changing the page hook order (the #155 class of bug)', async () => {
    const user = userEvent.setup()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Page() {
      const [loaded, setLoaded] = useState(false)
      if (!loaded) return <button type="button" onClick={() => setLoaded(true)}>load</button>
      return <BackButton to="/staff" label="staff" />
    }
    renderAt(<Page />)
    await user.click(screen.getByRole('button', { name: 'load' }))
    expect(screen.getByRole('link', { name: 'Back to staff' })).toBeInTheDocument()
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})

describe('BackButton: in-page back (no route to link to)', () => {
  it('renders a real button that calls onBack, never a link', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    renderAt(<BackButton onBack={onBack} label="tenants" variant="link" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    const back = screen.getByRole('button', { name: 'Back to tenants' })
    expect(back).toHaveTextContent(/^Back$/)
    expect(back).toHaveClass('min-h-[var(--tap-min)]')
    await user.click(back)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('supports the button and icon variants too', () => {
    renderAt(
      <>
        <BackButton onBack={() => {}} label="a" />
        <BackButton onBack={() => {}} label="b" variant="icon" />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Back to a' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to b' })).toHaveAttribute('title', 'Back to b')
  })
})

describe('BackActionButton: a Cancel that follows Back', () => {
  it('is a link whose href is the fallback, and a plain click goes back when there is history', async () => {
    const user = userEvent.setup()
    __testHooks.seedHistory('/trips', '/trips/new')
    render(
      <MemoryRouter initialEntries={['/trips', '/trips/new']} initialIndex={1}>
        <Routes>
          <Route path="*" element={<><BackActionButton to="/dashboard" /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    )
    const cancel = screen.getByRole('link', { name: 'Cancel' })
    expect(cancel).toHaveAttribute('href', '/dashboard')
    await user.click(cancel)
    expect(screen.getByTestId('where')).toHaveTextContent('/trips')
  })

  it('goes to the fallback when nothing precedes the page', async () => {
    const user = userEvent.setup()
    renderAt(<BackActionButton to="/dashboard" />, '/trips/new')
    await user.click(screen.getByRole('link', { name: 'Cancel' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard')
  })
})
