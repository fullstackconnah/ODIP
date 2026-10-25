import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { JumpPanel } from './JumpTo'

function Hash() {
  return <p data-testid="hash">{useLocation().hash}</p>
}

function renderPanel(ids: string[]) {
  return render(
    <MemoryRouter initialEntries={['/p/1?tab=health']}>
      <JumpPanel>
        {ids.map(id => <section key={id} id={id} data-jump aria-label={id.toUpperCase()}><h2>{id}</h2></section>)}
      </JumpPanel>
      <Hash />
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('JumpPanel (T12)', () => {
  it('lists the sections in page order and goes to the picked one through the hash, every time', async () => {
    const user = userEvent.setup()
    renderPanel(['allergies', 'risks', 'medications'])
    await user.click(screen.getByRole('button', { name: /Jump to/ }))
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['ALLERGIES', 'RISKS', 'MEDICATIONS'])
    await user.click(screen.getByRole('option', { name: 'RISKS' }))
    expect(screen.getByTestId('hash')).toHaveTextContent('#risks')

    await user.click(screen.getByRole('button', { name: /Jump to/ }))
    await user.click(screen.getByRole('option', { name: 'RISKS' }))
    expect(screen.getByTestId('hash')).toHaveTextContent('#risks')
  })

  it('shows nothing under three sections', () => {
    renderPanel(['a', 'b'])
    expect(screen.queryByRole('button', { name: /Jump to/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'On this page' })).not.toBeInTheDocument()
  })

  it('marks the observed section in the rail with aria-current="location"', () => {
    let callback: IntersectionObserverCallback = () => {}
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: IntersectionObserverCallback) { callback = cb }
      observe() {}
      disconnect() {}
    })
    renderPanel(['allergies', 'risks', 'medications'])
    act(() => callback([{ isIntersecting: true, target: document.getElementById('risks')! } as unknown as IntersectionObserverEntry], {} as IntersectionObserver))
    const rail = screen.getByRole('navigation', { name: 'On this page', hidden: true })
    expect(rail.querySelector('[aria-current="location"]')).toHaveTextContent('RISKS')
  })
})
