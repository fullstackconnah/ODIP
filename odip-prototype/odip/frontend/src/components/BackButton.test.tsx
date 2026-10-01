import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { BackButton } from './BackButton'
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
  it('uses `to` as the fallback when the user did not come from another in-app screen (a deep link or a reload)', () => {
    renderAt(<BackButton to="/staff" label="staff" />)
    expect(screen.getByRole('link', { name: 'Back to staff' })).toHaveAttribute('href', '/staff')
  })

  it('returns to the previous in-app screen when there is one (history is on by default), and its name says so', () => {
    __testHooks.recordCurrentPath('/')
    __testHooks.recordCurrentPath('/staff/s-1')
    renderAt(<BackButton to="/staff" label="staff" />)
    const back = screen.getByRole('link', { name: 'Back to Dashboard' })
    expect(back).toHaveAttribute('href', '/')
  })

  it('keeps the caller\'s label when the previous screen IS the fallback', () => {
    __testHooks.recordCurrentPath('/staff')
    __testHooks.recordCurrentPath('/staff/s-1')
    renderAt(<BackButton to="/staff" label="staff" />)
    expect(screen.getByRole('link', { name: 'Back to staff' })).toHaveAttribute('href', '/staff')
  })

  it('history={false} pins Back to `to` whatever the previous screen was', () => {
    __testHooks.recordCurrentPath('/')
    __testHooks.recordCurrentPath('/staff/s-1')
    renderAt(<BackButton to="/staff" label="staff" history={false} />)
    expect(screen.getByRole('link', { name: 'Back to staff' })).toHaveAttribute('href', '/staff')
  })

  it('returns to the previous screen with its query (a hub tab) when that is where the user came from', async () => {
    const user = userEvent.setup()
    __testHooks.recordCurrentPath('/participants?tab=onboarding')
    __testHooks.recordCurrentPath('/staff/s-1')
    renderAt(<BackButton to="/participants" label="participants" />)
    await user.click(screen.getByRole('link', { name: 'Back to Onboarding' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/participants?tab=onboarding')
  })

  it('can be rendered after an early return without changing the page\'s hook order (the #155 class of bug)', async () => {
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
