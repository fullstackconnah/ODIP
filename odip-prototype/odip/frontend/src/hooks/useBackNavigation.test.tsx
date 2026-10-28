import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, renderHook, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  MemoryRouter,
  Outlet,
  RouterProvider,
  Route,
  Routes,
  createBrowserRouter,
  createMemoryRouter,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import {
  __testHooks,
  useBackTarget,
  usePreviousAppPath,
  usePreviousAppPathTracker,
} from './useBackNavigation'
import { useUnsavedChangesWarning } from './useUnsavedChangesWarning'

function Tracker() {
  usePreviousAppPathTracker()
  return null
}

beforeEach(() => {
  __testHooks.reset()
  // A fresh document: no router state, so react-router starts this entry at idx 0.
  window.history.replaceState(null, '', '/')
})

/** A page with Back (the hook's own handler) and buttons that push the next screens. */
function Page({ fallback = '/home' }: { fallback?: string }) {
  const back = useBackTarget(fallback)
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <>
      <span data-testid="here">{location.pathname + location.search}</span>
      <button type="button" onClick={back.onBack} aria-label={back.ariaLabel}>
        back
      </button>
      <span data-testid="prev">{back.previousPath ?? ''}</span>
      <button type="button" onClick={() => navigate('/b')}>to b</button>
      <button type="button" onClick={() => navigate('/c')}>to c</button>
    </>
  )
}

function mountBrowser(start: string, page: ReactNode = <Page />) {
  window.history.replaceState(window.history.state, '', start)
  const router = createBrowserRouter([
    {
      element: (
        <>
          <Tracker />
          <Outlet />
        </>
      ),
      children: [{ path: '*', element: page }],
    },
  ])
  render(<RouterProvider router={router} />)
  return router
}

describe('history.state.idx', () => {
  it('react-router writes idx into window.history.state: 0 on load, +1 per push, unchanged by replace', async () => {
    const router = mountBrowser('/a')
    expect(window.history.state.idx).toBe(0)
    await act(() => router.navigate('/b'))
    expect(window.history.state.idx).toBe(1)
    await act(() => router.navigate('/c'))
    expect(window.history.state.idx).toBe(2)
    await act(() => router.navigate('/d', { replace: true }))
    expect(window.history.state.idx).toBe(2)
  })
})

describe('useBackTarget: Back returns to the previous page visited', () => {
  it('A to B to C: Back lands on B, then on A (no ping-pong between B and C)', async () => {
    const user = userEvent.setup()
    mountBrowser('/a')
    await user.click(screen.getByRole('button', { name: 'to b' }))
    await user.click(screen.getByRole('button', { name: 'to c' }))
    expect(screen.getByTestId('here')).toHaveTextContent('/c')
    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByTestId('here')).toHaveTextContent('/b'))
    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByTestId('here')).toHaveTextContent('/a'))
  })

  it('names the previous screen once it is known', async () => {
    const user = userEvent.setup()
    mountBrowser('/trips')
    await user.click(screen.getByRole('button', { name: 'to b' }))
    expect(screen.getByRole('button', { name: 'Back to Trips' })).toBeInTheDocument()
    expect(screen.getByTestId('prev')).toHaveTextContent('/trips')
  })

  it('a deep link (nothing before this page) goes to the fallback, as a push', async () => {
    const user = userEvent.setup()
    mountBrowser('/c')
    expect(screen.getByTestId('prev')).toHaveTextContent('')
    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByTestId('here')).toHaveTextContent('/home'))
    expect(window.history.state.idx).toBe(1)
  })

  it('after a reload the history survives: Back still runs navigate(-1), but the name falls back (the path map is gone)', async () => {
    const user = userEvent.setup()
    window.history.replaceState({ usr: null, key: 'k', idx: 3 }, '', '/c')
    const router = mountBrowser('/c')
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(undefined)
    expect(screen.getByTestId('prev')).toHaveTextContent('')
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(navigate).toHaveBeenCalledWith(-1)
  })

  it('a replaced entry is not a place to come back to', async () => {
    const user = userEvent.setup()
    const router = mountBrowser('/a')
    await user.click(screen.getByRole('button', { name: 'to b' }))
    await act(() => router.navigate('/c', { replace: true }))
    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByTestId('here')).toHaveTextContent('/a'))
  })

  it('leave() goes back when there is history, otherwise replaces with the fallback', async () => {
    const user = userEvent.setup()
    function Leaver() {
      const back = useBackTarget('/home')
      return <button type="button" onClick={back.leave}>leave</button>
    }
    const router = mountBrowser('/a', <><Leaver /><Page /></>)
    await user.click(screen.getAllByRole('button', { name: 'to b' })[0])
    await user.click(screen.getByRole('button', { name: 'leave' }))
    await waitFor(() => expect(screen.getByTestId('here')).toHaveTextContent('/a'))
    // At idx 0 now: leave replaces with the fallback.
    await user.click(screen.getByRole('button', { name: 'leave' }))
    await waitFor(() => expect(screen.getByTestId('here')).toHaveTextContent('/home'))
    expect(window.history.state.idx).toBe(0)
    expect(router.state.location.pathname).toBe('/home')
  })

  it('still trips the unsaved-changes blocker on a dirty form', async () => {
    const user = userEvent.setup()
    function DirtyForm() {
      const { dialog } = useUnsavedChangesWarning(true)
      return <>{dialog}<Page /></>
    }
    // A memory router: its blocked POP is deterministic. The seam stands in for history.state.idx.
    __testHooks.seedHistory('/a', '/b')
    const router = createMemoryRouter([{ path: '*', element: <DirtyForm /> }], { initialEntries: ['/a', '/b'], initialIndex: 1 })
    render(<RouterProvider router={router} />)
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/b')
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(router.state.location.pathname).toBe('/b')
    await user.click(screen.getByRole('button', { name: /back/i }))
    await user.click(await screen.findByRole('button', { name: 'Leave page' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/a'))
  })
})

describe('useBackTarget: onLinkClick', () => {
  function Anchor() {
    const back = useBackTarget('/home')
    return <a href="/home" onClick={back.onLinkClick}>link</a>
  }
  function renderAnchor() {
    __testHooks.setIdx(1)
    return render(
      <MemoryRouter initialEntries={['/a', '/b']} initialIndex={1}>
        <Routes>
          <Route path="*" element={<><Anchor /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    )
  }
  function Where() {
    return <span data-testid="at">{useLocation().pathname}</span>
  }

  it('a plain left click is handled (default prevented) and goes back', async () => {
    const user = userEvent.setup()
    renderAnchor()
    await user.click(screen.getByRole('link', { name: 'link' }))
    expect(screen.getByTestId('at')).toHaveTextContent('/a')
  })

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['middle button', { button: 1 }],
  ])('a %s click is left to the browser (the href is used)', (_name, init) => {
    renderAnchor()
    const link = screen.getByRole('link', { name: 'link' })
    let prevented: boolean | null = null
    const spy = (e: Event) => { prevented = e.defaultPrevented; e.preventDefault() }
    document.addEventListener('click', spy)
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
    document.removeEventListener('click', spy)
    expect(prevented).toBe(false)
    expect(screen.getByTestId('at')).toHaveTextContent('/b')
  })
})

describe('useBackTarget: the accessible name', () => {
  // MemoryRouter writes no idx, so the seam stands in for the browser's history.state.idx.
  function withPrevious(prev: string, here: string, ui: ReactNode) {
    __testHooks.recordAt(0, prev)
    __testHooks.setIdx(1)
    return render(
      <MemoryRouter initialEntries={[prev, here]} initialIndex={1}>
        <Tracker />
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>,
    )
  }
  function Name({ fallback = '/participants' }: { fallback?: string }) {
    const back = useBackTarget(fallback)
    return <span data-testid="aria">{back.ariaLabel}</span>
  }

  it('is "Go back" when the previous screen has no known name', () => {
    withPrevious('/foo', '/bar', <Name />)
    expect(screen.getByTestId('aria').textContent).toBe('Go back')
  })

  it('names a known index screen', () => {
    withPrevious('/participants', '/participants/new', <Name />)
    expect(screen.getByTestId('aria').textContent).toBe('Back to Participants')
  })

  it('names a known screen on one of its tabs too', () => {
    withPrevious('/medications?tab=register', '/medications/m-1/edit', <Name />)
    expect(screen.getByTestId('aria').textContent).toBe('Back to Medications')
  })

  it('names a hub lifecycle tab by its stage', () => {
    withPrevious('/participants?tab=onboarding', '/onboarding/5', <Name />)
    expect(screen.getByTestId('aria').textContent).toBe('Back to Onboarding')
  })
})

describe('usePreviousAppPath', () => {
  it('is null when nothing earlier is recorded', () => {
    const { result } = renderHook(() => usePreviousAppPath(), {
      wrapper: ({ children }) => <MemoryRouter initialEntries={['/x']}>{children}</MemoryRouter>,
    })
    expect(result.current).toBeNull()
  })

  it('reads the path recorded one entry earlier', () => {
    __testHooks.recordAt(0, '/first')
    __testHooks.setIdx(1)
    const { result } = renderHook(() => usePreviousAppPath(), {
      wrapper: ({ children }) => <MemoryRouter initialEntries={['/y']}>{children}</MemoryRouter>,
    })
    expect(result.current).toBe('/first')
  })
})
