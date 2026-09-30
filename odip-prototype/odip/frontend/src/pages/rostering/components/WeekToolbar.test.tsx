import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WeekToolbar } from './WeekToolbar'

function renderToolbar(overrides: Partial<React.ComponentProps<typeof WeekToolbar>> = {}) {
  const props: React.ComponentProps<typeof WeekToolbar> = {
    days: ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'],
    onPrevWeek: vi.fn(),
    onThisWeek: vi.fn(),
    onNextWeek: vi.fn(),
    groupBy: 'staff',
    onGroupByChange: vi.fn(),
    participantOptions: [],
    participantFilter: '',
    onParticipantFilterChange: vi.fn(),
    regionOptions: [],
    regionFilter: '',
    onRegionFilterChange: vi.fn(),
    unfilledOnly: false,
    onUnfilledOnlyChange: vi.fn(),
    exceptionsCount: 0,
    onOpenExceptions: vi.fn(),
    canWrite: true,
    onNewShift: vi.fn(),
    ...overrides,
  }
  return { ...render(<WeekToolbar {...props} />), props }
}

describe('WeekToolbar "Unfilled only" filter', () => {
  // A single on/off filter is a plain toggle button (aria-pressed), not a one-option
  // ToggleGroup/radiogroup — the latter would (a) let the checked radio be unchecked by
  // clicking it again (non-standard radio behaviour) and (b) fire onChange on every arrow key
  // with only one option to rove between. Neither should happen here.
  it('renders as a toggle button (aria-pressed), not a radio', () => {
    renderToolbar()

    // The groupBy ToggleGroup ("By participant"/"By staff") is a legitimate multi-option
    // radiogroup and stays one — only "Unfilled only" (a single on/off filter) must not be.
    const toggle = screen.getByRole('button', { name: 'Unfilled only' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('radio', { name: 'Unfilled only' })).not.toBeInTheDocument()
    expect(toggle.closest('[role="radiogroup"]')).toBeNull()
  })

  it('reflects the checked state via aria-pressed', () => {
    renderToolbar({ unfilledOnly: true })

    expect(screen.getByRole('button', { name: 'Unfilled only' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('clicking calls onUnfilledOnlyChange with the inverted value', async () => {
    const user = userEvent.setup()
    const onUnfilledOnlyChange = vi.fn()
    renderToolbar({ unfilledOnly: false, onUnfilledOnlyChange })

    await user.click(screen.getByRole('button', { name: 'Unfilled only' }))

    expect(onUnfilledOnlyChange).toHaveBeenCalledWith(true)
    expect(onUnfilledOnlyChange).toHaveBeenCalledTimes(1)
  })

  it('clicking again while already on calls onUnfilledOnlyChange with false (does not silently no-op)', async () => {
    const user = userEvent.setup()
    const onUnfilledOnlyChange = vi.fn()
    renderToolbar({ unfilledOnly: true, onUnfilledOnlyChange })

    await user.click(screen.getByRole('button', { name: 'Unfilled only' }))

    expect(onUnfilledOnlyChange).toHaveBeenCalledWith(false)
  })

  it('arrow keys do NOT toggle the filter — it is a plain button, not a roving-tabindex radio group', async () => {
    const user = userEvent.setup()
    const onUnfilledOnlyChange = vi.fn()
    renderToolbar({ unfilledOnly: false, onUnfilledOnlyChange })

    screen.getByRole('button', { name: 'Unfilled only' }).focus()
    await user.keyboard('{ArrowLeft}{ArrowRight}{ArrowUp}{ArrowDown}{Home}{End}')

    expect(onUnfilledOnlyChange).not.toHaveBeenCalled()
  })
})

describe('WeekToolbar week navigation', () => {
  it('prev / this week / next are Button md (--control-h) controls wired to their handlers', async () => {
    const user = userEvent.setup()
    const { props } = renderToolbar()

    const prev = screen.getByRole('button', { name: 'Previous week' })
    const thisWeek = screen.getByRole('button', { name: 'This week' })
    const next = screen.getByRole('button', { name: 'Next week' })
    for (const button of [prev, thisWeek, next]) {
      expect(button).toHaveClass('h-[var(--control-h)]')
    }

    await user.click(prev)
    await user.click(thisWeek)
    await user.click(next)
    expect(props.onPrevWeek).toHaveBeenCalledTimes(1)
    expect(props.onThisWeek).toHaveBeenCalledTimes(1)
    expect(props.onNextWeek).toHaveBeenCalledTimes(1)
  })

  it('shows the week range beside the controls', () => {
    renderToolbar()
    expect(screen.getByRole('heading', { level: 2, name: '17 – 23 Aug 2026' })).toBeInTheDocument()
  })

  it('keeps the exceptions count and New shift buttons at --control-h too', () => {
    renderToolbar({ exceptionsCount: 2 })
    expect(screen.getByRole('button', { name: '2 exceptions' })).toHaveClass('h-[var(--control-h)]')
    expect(screen.getByRole('button', { name: 'New shift' })).toHaveClass('h-[var(--control-h)]')
  })
})
