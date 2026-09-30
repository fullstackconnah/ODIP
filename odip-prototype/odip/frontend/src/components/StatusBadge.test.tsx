import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'
import { STATUS_TONE, TONE, TRIP_STATUS_LABELS } from '@/lib/tone'
import { TRIP_STATUSES } from '@/api/types/enums'

describe('StatusBadge — size', () => {
  it('renders the 12px pill exactly as before when `size` is omitted', () => {
    render(<StatusBadge status="Confirmed" />)
    const badge = screen.getByText('Confirmed')
    // The complete class string, so any drift in the default (used by every table in the app) fails here.
    expect(badge.className.replace(/\s+/g, ' ').trim()).toBe(
      'text-xs px-2 py-0.5 rounded-full bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
    )
  })

  it('treats size="sm" as the default', () => {
    const omitted = render(<StatusBadge status="Draft" />)
    const html = omitted.container.innerHTML
    omitted.unmount()
    const explicit = render(<StatusBadge status="Draft" size="sm" />)
    expect(explicit.container.innerHTML).toBe(html)
  })

  it('renders the md pill (13px, semibold, 24px tall) that leads a detail meta row', () => {
    render(<StatusBadge status="Confirmed" size="md" />)
    const badge = screen.getByText('Confirmed')
    expect(badge).toHaveClass('text-[13px]', 'leading-5', 'font-semibold', 'px-2.5', 'py-0.5', 'rounded-full')
    expect(badge).not.toHaveClass('text-xs')
  })

  it('keeps the same colour at both sizes (only the size is opt-in)', () => {
    for (const size of ['sm', 'md'] as const) {
      const { unmount } = render(<StatusBadge status="Cancelled" size={size} />)
      expect(screen.getByText('Cancelled')).toHaveClass('bg-[var(--color-error-container)]', 'text-[var(--color-on-error-container)]')
      unmount()
    }
  })

  it('still honours label, pulse and className at md', () => {
    render(<StatusBadge status="pending" label="Awaiting" size="md" pulse className="ml-2" />)
    expect(screen.getByText('Awaiting')).toHaveClass('animate-pulse', 'ml-2', 'bg-[var(--color-warning-container)]')
  })
})

// The trip detail header renders `<StatusBadge status={trip.status} size="md" />`, and StatusBadge had no entries for four of the nine trip
// statuses (Planning, OpenForBookings, WaitlistOnly, InProgress): they fell to the amber warning fallback (the wrong signal, per DESIGN.md's
// Semantic Colour Rule) and showed the raw enum text ("OpenForBookings").
describe('StatusBadge — every trip status', () => {
  const FALLBACK = 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]'
  const toneOf = (badge: HTMLElement) => badge.className.replace(/\s+/g, ' ').replace(/^text-xs px-2 py-0.5 rounded-full /, '').trim()

  it('has a colour for every value in TRIP_STATUSES: none is left to the fallback by omission', () => {
    // Statuses that were already covered, plus the four added: each must resolve to a real entry, not the unknown-status fallback.
    const unknown = render(<StatusBadge status="NotAStatus" />)
    const fallback = toneOf(screen.getByText('NotAStatus'))
    unknown.unmount()
    expect(fallback).toBe(FALLBACK)

    for (const status of TRIP_STATUSES) {
      const { unmount } = render(<StatusBadge status={status} />)
      const tone = toneOf(screen.getByText(status))
      // WaitlistOnly is amber on the dashboard and the schedule too, so its explicit entry equals the fallback pair by design.
      if (status !== 'WaitlistOnly') expect(tone, status).not.toBe(FALLBACK)
      unmount()
    }
    // ...and every one of the four that had no entry is now an explicit one.
    for (const key of ['planning', 'openforbookings', 'waitlistonly', 'inprogress']) expect(STATUS_TONE[key], key).toBeTruthy()
  })

  it('uses the tones the dashboard and schedule give them (closest existing StatusBadge pairs), not amber for all four', () => {
    const tones: Record<string, string> = {
      Planning: 'bg-[var(--color-secondary-container)] text-[var(--color-info)]',
      OpenForBookings: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
      WaitlistOnly: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
      InProgress: 'bg-[var(--color-accessible-container)] text-[var(--color-on-accessible-container)]',
    }
    for (const [status, expected] of Object.entries(tones)) {
      const { unmount } = render(<StatusBadge status={status} />)
      expect(toneOf(screen.getByText(status)), status).toBe(expected)
      unmount()
    }
  })

  it('gives every value in TRIP_STATUSES a human label (sentence case, words separated), never the raw enum text', () => {
    expect(Object.keys(TRIP_STATUS_LABELS).sort()).toEqual([...TRIP_STATUSES].sort())
    for (const status of TRIP_STATUSES) {
      const label = TRIP_STATUS_LABELS[status]
      expect(label, status).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/) // "Open for bookings", not "OpenForBookings" or "Open For Bookings"
      const { unmount } = render(<StatusBadge status={status} label={label} />)
      expect(screen.getByText(label)).toBeInTheDocument()
      if (/[A-Z].*[A-Z]/.test(status)) expect(screen.queryByText(status)).not.toBeInTheDocument()
      unmount()
    }
    expect(TRIP_STATUS_LABELS.OpenForBookings).toBe('Open for bookings')
    expect(TRIP_STATUS_LABELS.WaitlistOnly).toBe('Waitlist only')
    expect(TRIP_STATUS_LABELS.InProgress).toBe('In progress')
  })

  it('leaves StatusBadge\'s own text alone: without a label it still shows what it is given (other callers are unchanged)', () => {
    render(<StatusBadge status="InProgress" />)
    expect(screen.getByText('InProgress')).toBeInTheDocument()
  })
})

describe('StatusBadge — tones', () => {
  const pair = (badge: HTMLElement) => badge.className.replace(/\s+/g, ' ').replace(/^text-xs px-2 py-0\.5 rounded-full /, '').trim()

  it('colours every built-in status with the solid pair of its tone in STATUS_TONE', () => {
    for (const [key, tone] of Object.entries(STATUS_TONE)) {
      if (key === 'new') continue // the one quiet pill, below
      const { unmount } = render(<StatusBadge status={key} label={key} />)
      expect(pair(screen.getByText(key)), key).toBe(TONE[tone].solid)
      unmount()
    }
  })

  it('takes a tone prop that wins over the status word', () => {
    render(<StatusBadge status="Confirmed" tone="danger" />)
    expect(pair(screen.getByText('Confirmed'))).toBe(TONE.danger.solid)
  })

  it('is a tone and a word when it has no status: <StatusBadge tone="danger" label="Refused" />', () => {
    render(<StatusBadge tone="danger" label="Refused" size="md" />)
    const badge = screen.getByText('Refused')
    expect(badge).toHaveClass('text-[13px]', 'rounded-full', ...TONE.danger.solid.split(' '))
  })

  it('takes Tone values in colorMap, and class strings too (back-compat), and a colorMap entry wins over the built-in map', () => {
    render(
      <>
        <StatusBadge status="Cancelled" colorMap={{ cancelled: 'neutral' }} />
        <StatusBadge status="Sent" colorMap={{ sent: 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' }} />
        <StatusBadge status="Pending" colorMap={{ other: 'danger' }} />
      </>,
    )
    expect(pair(screen.getByText('Cancelled'))).toBe(TONE.neutral.solid)
    expect(pair(screen.getByText('Sent'))).toBe('bg-[var(--color-primary)]/10 text-[var(--color-primary)]')
    // A colorMap with no entry for this status leaves the built-in tone alone.
    expect(pair(screen.getByText('Pending'))).toBe(TONE.warning.solid)
  })

  it('falls back to the warning tone for a status no map knows', () => {
    render(<StatusBadge status="Totally New Thing" />)
    expect(pair(screen.getByText('Totally New Thing'))).toBe(TONE.warning.solid)
  })

  it('keeps "new" on the lighter neutral surface, a step below draft (the one quiet pill)', () => {
    render(
      <>
        <StatusBadge status="New" />
        <StatusBadge status="Draft" />
      </>,
    )
    expect(pair(screen.getByText('New'))).toBe('bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]')
    expect(pair(screen.getByText('Draft'))).toBe(TONE.neutral.solid)
  })

  it('does not trip over a status that is an Object.prototype name', () => {
    render(<StatusBadge status="constructor" />)
    expect(pair(screen.getByText('constructor'))).toBe(TONE.warning.solid)
  })
})
