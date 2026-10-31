import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureInstallEvents, readInstallRecord } from '@/lib/installPrompt'
import InstallPrompt from './InstallPrompt'

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

/** A phone: narrower than md, coarse pointer, secure context, browser tab (not standalone). */
function phone({ standalone = false } = {}) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('pointer: coarse') || (q.includes('display-mode') && standalone),
    addEventListener: () => {}, removeEventListener: () => {},
  }))
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
}

function offer(win: EventTarget, outcome: 'accepted' | 'dismissed' = 'accepted') {
  const prompt = vi.fn().mockResolvedValue(undefined)
  const evt = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome }) })
  act(() => { win.dispatchEvent(evt) })
  return prompt
}

const renderAt = (path = '/portal') => render(<MemoryRouter initialEntries={[path]}><main id="main" tabIndex={-1} /><InstallPrompt /></MemoryRouter>)
const stored = () => JSON.parse(localStorage.getItem('odip_install_prompt:u1') ?? 'null')

describe('InstallPrompt', () => {
  let win: EventTarget
  beforeEach(() => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1', role: 'SupportWorker' }))
    phone()
    win = new EventTarget()
    captureInstallEvents(win)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

  it('renders nothing, and no spacer, until there is an event or iOS Safari', () => {
    const { container } = renderAt()
    expect(screen.queryByRole('region')).toBeNull()
    expect(container.querySelector('[data-install-spacer]')).toBeNull()
  })

  it('Android: Install calls prompt once, accepted hides the card and stores installed', async () => {
    const user = userEvent.setup()
    renderAt()
    const prompt = offer(win)
    expect(screen.getByRole('region', { name: 'Install Bunya Support' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(prompt).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
    expect(stored()).toEqual({ installed: true })
  })

  it('Android: the worker sentence shows for a support worker', () => {
    renderAt()
    offer(win)
    expect(screen.getByText('Today’s shifts stay open even with no signal.')).toBeInTheDocument()
  })

  it('Android: a coordinator does not get the worker sentence', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1', role: 'Coordinator' }))
    renderAt()
    offer(win)
    expect(screen.getByRole('region', { name: 'Install Bunya Support' })).toBeInTheDocument()
    expect(screen.queryByText(/stay open even with no signal/)).toBeNull()
  })

  it('a declined native dialog counts as Not now: 30 days', async () => {
    const user = userEvent.setup()
    const before = Date.now()
    renderAt()
    offer(win, 'dismissed')
    await user.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
    expect(stored().dismissedUntil).toBeGreaterThanOrEqual(before + 30 * 86_400_000)
  })

  it('Not now stores 30 days, hides the card and moves focus to #main', async () => {
    const user = userEvent.setup()
    renderAt()
    offer(win)
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
    expect(readInstallRecord('u1').dismissedUntil).toBeGreaterThan(Date.now())
    expect(document.getElementById('main')).toHaveFocus()
  })

  it('iOS shows the steps and no Install button', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IOS_UA)
    renderAt()
    expect(screen.getByRole('region', { name: 'Add Bunya Support to your Home Screen' })).toBeInTheDocument()
    expect(screen.getByText(/Choose Add to Home Screen/)).toBeInTheDocument()
    expect(screen.getByText(/Tap Share/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
  })

  it('appinstalled hides it for good', () => {
    renderAt()
    offer(win)
    expect(screen.getByRole('region')).toBeInTheDocument()
    act(() => { win.dispatchEvent(new Event('appinstalled')) })
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('is not shown off the landing routes, standalone, or after a dismissal', () => {
    offer(win)
    renderAt('/portal/shifts/x').unmount()
    expect(screen.queryByRole('region')).toBeNull()
    phone({ standalone: true })
    renderAt().unmount()
    expect(screen.queryByRole('region')).toBeNull()
    phone()
    localStorage.setItem('odip_install_prompt:u1', JSON.stringify({ dismissedUntil: Date.now() + 1000 }))
    renderAt()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('the spacer renders only while the card does', async () => {
    const user = userEvent.setup()
    const { container } = renderAt()
    expect(container.querySelector('[data-install-spacer]')).toBeNull()
    offer(win)
    expect(container.querySelector('[data-install-spacer]')).toHaveAttribute('aria-hidden', 'true')
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(container.querySelector('[data-install-spacer]')).toBeNull())
  })

  it('stays off the printed page: neither the card nor its spacer prints', () => {
    const { container } = renderAt()
    offer(win)
    expect(container.querySelector('[data-install-spacer]')).toHaveClass('print:hidden')
    expect(screen.getByRole('region', { name: /Install Bunya Support/ })).toHaveClass('print:hidden')
  })

  it('names no offline promise to anyone but a support worker', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1', role: 'Coordinator' }))
    renderAt()
    offer(win)
    expect(screen.getByRole('region').textContent).not.toMatch(/offline|signal/i)
  })
})
