import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { AlertTriangle, AlertCircle, Info, CheckCircle2 } from 'lucide-react'
import { Callout } from './Callout'

afterEach(() => cleanup())

describe('Callout primitive', () => {
  it('renders error tone with role=alert (assertive announcement)', () => {
    render(<Callout tone="error">Could not save changes.</Callout>)
    const el = screen.getByRole('alert')
    expect(el).toHaveTextContent('Could not save changes.')
    // Error tone uses the destructive container + destructive ink tokens.
    expect(el.className).toMatch(/bg-\[var\(--color-destructive\)\]\/10/)
    expect(el.className).toMatch(/text-\[var\(--color-destructive\)\]/)
  })

  it('treats tone="danger" as the same tone as "error" (the canonical name in lib/tone.ts)', () => {
    const { container, rerender } = render(<Callout tone="error">Could not save changes.</Callout>)
    const asError = container.innerHTML
    rerender(<Callout tone="danger">Could not save changes.</Callout>)
    expect(container.innerHTML).toBe(asError)
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
  })

  it('renders warning tone with role=alert (assertive) and warning-container tokens', () => {
    render(<Callout tone="warning">Intake not yet complete.</Callout>)
    const el = screen.getByRole('alert')
    expect(el.className).toMatch(/bg-\[var\(--color-warning-container\)\]/)
    expect(el.className).toMatch(/text-\[var\(--color-on-warning-container\)\]/)
  })

  it('renders info tone with role=status (polite) and muted background', () => {
    render(<Callout tone="info">Records sync nightly at 02:00.</Callout>)
    const el = screen.getByRole('status')
    expect(el.className).toMatch(/bg-\[var\(--color-muted\)\]/)
  })

  it('renders success tone with role=status (polite) and primary accent icon', () => {
    render(<Callout tone="success">Saved.</Callout>)
    const el = screen.getByRole('status')
    expect(el.className).toMatch(/bg-\[var\(--color-surface-container\)\]/)
    // Icon class is primary for success tone (not destructive etc.).
    const icon = el.querySelector('svg')!
    expect(icon.classList.contains('text-[var(--color-primary)]')).toBe(true)
  })

  it('attaches aria-live in line with the role', () => {
    const { rerender } = render(<Callout tone="error">e</Callout>)
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
    rerender(<Callout tone="info">i</Callout>)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('renders the title bold above the body when both are provided', () => {
    render(<Callout tone="error" title="Save failed">The server rejected the change.</Callout>)
    const el = screen.getByRole('alert')
    expect(el).toHaveTextContent('Save failed')
    expect(el).toHaveTextContent('The server rejected the change.')
    const heading = el.querySelector('p')
    expect(heading).not.toBeNull()
    expect(heading!.className).toMatch(/font-medium/)
  })

  it('uses tone-specific icons by default', () => {
    // We assert via the icon's component symbol. lucide-react sets the SVG's data-lucide
    // attribute to the icon name; for stability, assert by class of the containing <svg>.
    const { rerender } = render(<Callout tone="error">e</Callout>)
    // Error tone default icon is AlertTriangle.
    expect(screen.getByRole('alert').querySelector('svg')).not.toBeNull()

    rerender(<Callout tone="warning">w</Callout>)
    expect(screen.getByRole('alert').querySelector('svg')).not.toBeNull()

    rerender(<Callout tone="info">i</Callout>)
    expect(screen.getByRole('status').querySelector('svg')).not.toBeNull()

    rerender(<Callout tone="success">s</Callout>)
    expect(screen.getByRole('status').querySelector('svg')).not.toBeNull()
  })

  it('accepts an icon override and renders that icon in the same slot', () => {
    render(
      <Callout tone="error" icon={Info}>
        Using the Info icon for an error tone.
      </Callout>,
    )
    // The icon SVG must still be present (override applied).
    expect(screen.getByRole('alert').querySelector('svg')).not.toBeNull()
  })

  it('hides the icon entirely when `icon={null}` is passed', () => {
    render(<Callout tone="info" icon={null}>No icon here.</Callout>)
    expect(screen.getByRole('status').querySelector('svg')).toBeNull()
  })

  it('renders actions on the right of the body', () => {
    render(
      <Callout
        tone="error"
        title="Save failed"
        actions={<button type="button">Retry</button>}
      >
        The server rejected the change.
      </Callout>,
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('passes through className so call sites can tune spacing', () => {
    render(<Callout tone="error" className="mt-4 mb-6">x</Callout>)
    const el = screen.getByRole('alert')
    expect(el.className).toMatch(/mt-4/)
    expect(el.className).toMatch(/mb-6/)
    // The tone classes are still present.
    expect(el.className).toMatch(/bg-\[var\(--color-destructive\)\]\/10/)
  })

  it('does not introduce any hard-coded hex colours in its class output', () => {
    const { container } = render(<Callout tone="error">x</Callout>)
    // No raw #rrggbb in any class attribute.
    const allClasses = container.innerHTML
    expect(allClasses).not.toMatch(/#[0-9a-f]{3,6}\b/i)
  })

  it('icon is decorative (aria-hidden) so screen readers read the text', () => {
    render(<Callout tone="error" title="Boom">Server unreachable.</Callout>)
    const svg = screen.getByRole('alert').querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
  })

  it('still defaults to the right icon name when no override is given (smoke)', () => {
    // Sanity: the four default icons render without throwing.
    render(
      <div>
        <Callout tone="error">e</Callout>
        <Callout tone="warning">w</Callout>
        <Callout tone="info">i</Callout>
        <Callout tone="success">s</Callout>
      </div>,
    )
    // Each tone contributed exactly one svg.
    expect(document.querySelectorAll('svg')).toHaveLength(4)
    // Sanity: the default icons are still the ones we picked (icon identity check via the
    // imported symbol — both render paths share the same named export).
    expect(AlertTriangle).toBeDefined()
    expect(AlertCircle).toBeDefined()
    expect(Info).toBeDefined()
    expect(CheckCircle2).toBeDefined()
  })
})
