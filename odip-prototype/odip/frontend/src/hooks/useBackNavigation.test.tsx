import { describe, it, expect, beforeEach } from 'vitest'
import type { ReactElement } from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate, useLocation } from 'react-router-dom'
import {
  __testHooks,
  useBackTarget,
  usePreviousAppPath,
  usePreviousAppPathTracker,
} from './useBackNavigation'

function TrackerHarness() {
  // Mount the tracker exactly once at the shell level so every subsequent hook instance in
  // the same MemoryRouter tree sees the same recorded path.
  usePreviousAppPathTracker()
  return null
}

function DisplayPreviousPath() {
  const value = usePreviousAppPath()
  return <span data-testid="prev">{value ?? ''}</span>
}

beforeEach(() => {
  __testHooks.reset()
})

describe('useBackNavigation — tracker', () => {
  it('starts with no previous path on a fresh mount', () => {
    render(
      <MemoryRouter initialEntries={['/somewhere']}>
        <TrackerHarness />
        <DisplayPreviousPath />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('prev').textContent).toBe('')
  })

  it('records the previous path after a route change', () => {
    function Harness() {
      const navigate = useNavigate()
      return (
        <>
          <TrackerHarness />
          <button type="button" onClick={() => navigate('/participants/7')}>
            go
          </button>
          <DisplayPreviousPath />
        </>
      )
    }
    render(
      <MemoryRouter initialEntries={['/participants']}>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('prev').textContent).toBe('')
    act(() => {
      screen.getByRole('button', { name: /go/ }).click()
    })
    expect(screen.getByTestId('prev').textContent).toBe('/participants')
  })
})

describe('useBackNavigation — useBackTarget', () => {
  function withRouter(initialEntries: string[], ui: () => React.ReactElement) {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <TrackerHarness />
        <Routes>
          <Route path="*" element={ui()} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('returns the fallback when there is no recorded previous path (deep link)', () => {
    function Page() {
      const back = useBackTarget('/participants/5')
      return (
        <>
          <button type="button" onClick={back.onBack} aria-label={back.ariaLabel}>
            back
          </button>
          <span data-testid="to">{back.to}</span>
        </>
      )
    }
    withRouter(['/participants/5/profile'], () => <Page />)
    expect(screen.getByTestId('to').textContent).toBe('/participants/5')
    expect(screen.getByRole('button', { name: /back to participant/i })).toBeInTheDocument()
  })

  it('returns the previous path when there is one, and navigates there when clicked', async () => {
    function Page(): ReactElement {
      const back = useBackTarget('/participants/5')
      const location = useLocation()
      return (
        <>
          <button type="button" onClick={back.onBack} aria-label={back.ariaLabel}>
            back
          </button>
          <span data-testid="to">{back.to}</span>
          <span data-testid="here">{location.pathname}</span>
        </>
      )
    }
    // Seed module state the same way two real route changes would: first /onboarding/5 then
    // /participants/5/profile. The MemoryRouter can only land us on one entry at a time, so
    // this is the simplest way to simulate the user arriving from another screen.
    __testHooks.recordCurrentPath('/onboarding/5')
    __testHooks.recordCurrentPath('/participants/5/profile')
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/participants/5/profile']}>
        <TrackerHarness />
        <Routes>
          <Route path="/participants/:id/profile" element={<Page />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('to').textContent).toBe('/onboarding/5')
    expect(screen.getByRole('button', { name: /back to onboarding/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /back to onboarding/i }))
    // The MemoryRouter routed to /onboarding/5 — /participants/:id/profile no longer matches, so
    // the Page component unmounts.
    expect(screen.queryByTestId('to')).not.toBeInTheDocument()
  })

  it('falls back to the supplied fallback when the previous path equals the current path', () => {
    function Page() {
      const back = useBackTarget('/participants')
      return <span data-testid="to">{back.to}</span>
    }
    // Force the recorded previous to equal the current pathname via the test hook.
    __testHooks.recordCurrentPath('/participants/new')
    __testHooks.recordCurrentPath('/participants/new')
    withRouter(['/participants/new'], () => <Page />)
    expect(screen.getByTestId('to').textContent).toBe('/participants')
  })

  it('falls back to "Go back" ariaLabel when the target has no known screen name', () => {
    function Page() {
      const back = useBackTarget('/mystery')
      return <span data-testid="aria">{back.ariaLabel}</span>
    }
    __testHooks.recordCurrentPath('/foo')
    __testHooks.recordCurrentPath('/bar')
    withRouter(['/bar'], () => <Page />)
    expect(screen.getByTestId('aria').textContent).toBe('Go back')
  })

  it('builds a screen-name ariaLabel for known index screens', () => {
    function Page() {
      const back = useBackTarget('/participants')
      return <span data-testid="aria">{back.ariaLabel}</span>
    }
    __testHooks.recordCurrentPath('/participants')
    __testHooks.recordCurrentPath('/participants/new')
    withRouter(['/participants/new'], () => <Page />)
    expect(screen.getByTestId('aria').textContent).toBe('Back to Participants')
  })
})

describe('usePreviousAppPath — renderHook', () => {
  it('returns null when the tracker has not recorded anything', () => {
    const { result } = renderHook(() => usePreviousAppPath(), {
      wrapper: ({ children }) => <MemoryRouter initialEntries={['/x']}>{children}</MemoryRouter>,
    })
    expect(result.current).toBeNull()
  })

  it('returns the recorded previous path after a recordCurrentPath call', () => {
    const { result } = renderHook(() => usePreviousAppPath(), {
      wrapper: ({ children }) => <MemoryRouter initialEntries={['/y']}>{children}</MemoryRouter>,
    })
    act(() => {
      __testHooks.recordCurrentPath('/first')
      __testHooks.recordCurrentPath('/second')
    })
    expect(result.current).toBe('/first')
  })
})

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="at">{location.pathname + location.search}</span>
}

function HubTabLink() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate('/onboarding/5')}>
      View checklist
    </button>
  )
}

function BackProbe() {
  const { onBack, ariaLabel } = useBackTarget('/participants?tab=onboarding')
  return (
    <button type="button" onClick={onBack} aria-label={ariaLabel}>
      back
    </button>
  )
}

describe('useBackNavigation — query-string preservation', () => {
  it('Back from a detail page returns to the hub tab it was opened from, not the default tab', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/participants?tab=onboarding']}>
        <TrackerHarness />
        <Routes>
          <Route path="/participants" element={<><HubTabLink /><LocationProbe /></>} />
          <Route path="/onboarding/:id" element={<><BackProbe /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )
    // Start on the hub's Onboarding tab, then open a checklist row.
    await user.click(screen.getByRole('button', { name: /view checklist/i }))
    expect(screen.getByTestId('at')).toHaveTextContent('/onboarding/5')
    await user.click(screen.getByRole('button', { name: /back to onboarding/i }))
    // Regression guard: this used to land on /participants with no ?tab=, i.e. the default
    // "Active participants" tab, because the tracker stored pathname without search.
    expect(screen.getByTestId('at')).toHaveTextContent('/participants?tab=onboarding')
  })
})
