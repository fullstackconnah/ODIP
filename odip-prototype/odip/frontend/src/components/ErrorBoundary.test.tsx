import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ErrorBoundary from './ErrorBoundary'

// A page that throws while `broken.on` is set, standing in for one whose data arrived in a shape it cannot render.
const broken = { on: true }
function Page({ name = 'The page' }: { name?: string }) {
  if (broken.on) throw new Error('alertsAggregate.filter is not a function')
  return <div>{name} is fine</div>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    broken.on = true
    // React logs every caught render error, and the boundary logs it again: keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders its children when nothing throws', () => {
    broken.on = false
    render(<ErrorBoundary><Page /></ErrorBoundary>)
    expect(screen.getByText('The page is fine')).toBeInTheDocument()
  })

  it('replaces a page that throws with the error and a Try again button, and recovers when the page stops throwing', () => {
    render(<ErrorBoundary><Page /></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByText('alertsAggregate.filter is not a function')).toBeInTheDocument()
    broken.on = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('The page is fine')).toBeInTheDocument()
  })

  it('fills the viewport by default, and only the area it sits in with `inline` (the shell keeps its nav)', () => {
    const { container, unmount } = render(<ErrorBoundary><Page /></ErrorBoundary>)
    expect(container.firstElementChild).toHaveClass('min-h-screen')
    unmount()
    const inline = render(<ErrorBoundary inline><Page /></ErrorBoundary>)
    expect(inline.container.firstElementChild).not.toHaveClass('min-h-screen')
  })

  it('shows a custom fallback instead of the default card', () => {
    render(<ErrorBoundary fallback={<p>Custom fallback</p>}><Page /></ErrorBoundary>)
    expect(screen.getByText('Custom fallback')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  describe('resetKey', () => {
    it('clears the error when the key changes, so navigating away from a broken page lands on a working one', () => {
      const { rerender } = render(<ErrorBoundary resetKey="/broken"><Page /></ErrorBoundary>)
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
      broken.on = false
      rerender(<ErrorBoundary resetKey="/fine"><Page name="Next page" /></ErrorBoundary>)
      expect(screen.getByText('Next page is fine')).toBeInTheDocument()
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    })

    it('keeps the error while the key is the same, even across re-renders', () => {
      const { rerender } = render(<ErrorBoundary resetKey="/broken"><Page /></ErrorBoundary>)
      broken.on = false
      rerender(<ErrorBoundary resetKey="/broken"><Page /></ErrorBoundary>)
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })

    it('shows the error again when the page it navigated to throws as well', () => {
      const { rerender } = render(<ErrorBoundary resetKey="/a"><Page /></ErrorBoundary>)
      rerender(<ErrorBoundary resetKey="/b"><Page /></ErrorBoundary>)
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })

    it('does not remount a healthy page when the key changes (a detail page that only changes its :id keeps its state)', () => {
      broken.on = false
      const { rerender } = render(<ErrorBoundary resetKey="/trips/1"><input aria-label="draft" /></ErrorBoundary>)
      const input = screen.getByLabelText('draft')
      rerender(<ErrorBoundary resetKey="/trips/2"><input aria-label="draft" /></ErrorBoundary>)
      expect(screen.getByLabelText('draft')).toBe(input)
    })
  })
})
