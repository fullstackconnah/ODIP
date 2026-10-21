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

  it('is offered on the participant board as well as the staff board, so a link that asks for it can be answered on either', () => {
    const { unmount } = renderToolbar({ groupBy: 'participant' })
    expect(screen.getByRole('button', { name: 'Unfilled only' })).toBeInTheDocument()
    unmount()

    renderToolbar({ groupBy: 'staff' })
    expect(screen.getByRole('button', { name: 'Unfilled only' })).toBeInTheDocument()
  })

  it('gives the participant filter room for a full name instead of a fixed 160px box that wraps it', () => {
    const { container } = renderToolbar({ participantFilter: 'p-1', participantOptions: [{ value: 'p-1', label: 'Grace Palmer-Hughes' }] })

    expect(container.querySelector('.w-40')).toBeNull()
    expect(container.querySelector('.min-w-40')).not.toBeNull()
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

describe('WeekToolbar — the exceptions button', () => {
  it('is not drawn while there are no exceptions, and is drawn with its count when there are', () => {
    const { unmount } = renderToolbar({ exceptionsCount: 0 })
    expect(screen.queryByRole('button', { name: /exception/ })).not.toBeInTheDocument()
    unmount()
    renderToolbar({ exceptionsCount: 1 })
    expect(screen.getByRole('button', { name: '1 exception' })).toBeInTheDocument()
  })
})

describe('WeekToolbar: All published and the one primary (Start rostering, 2026-10-16)', () => {
  it('says "All published" when told, and has no drafts badge or Publish week any more', () => {
    renderToolbar({ allPublished: true })
    expect(screen.getByText('All published')).toBeInTheDocument()
    expect(screen.queryByText(/drafts/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish week' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New shift/ })).toHaveClass('bg-[var(--color-primary)]')
  })

  it('shows nothing beside the range by default', () => {
    renderToolbar()
    expect(screen.queryByText(/drafts|All published/)).not.toBeInTheDocument()
  })

  it("steps New shift back when the page's primary is elsewhere", () => {
    renderToolbar({ newShiftSecondary: true })
    expect(screen.getByRole('button', { name: /New shift/ })).not.toHaveClass('bg-[var(--color-primary)]')
  })

  it('the week heading can take focus from the page', () => {
    renderToolbar()
    const heading = screen.getByRole('heading', { name: /Aug/ })
    expect(heading).toHaveAttribute('id', 'roster-week-heading')
    expect(heading).toHaveAttribute('tabindex', '-1')
  })
})

describe('WeekToolbar at phone width (finish review)', () => {
  it('keeps the "All published" badge, the week range and "This week" each on one line, and wraps the row between them instead', () => {
    renderToolbar({ allPublished: true })
    const badge = screen.getByText('All published')
    expect(badge).toHaveClass('whitespace-nowrap', 'shrink-0')
    expect(screen.getByRole('heading', { name: /Aug/ })).toHaveClass('whitespace-nowrap')
    expect(screen.getByRole('button', { name: 'This week' })).toHaveClass('whitespace-nowrap')
    expect(badge.parentElement).toHaveClass('flex-wrap')
  })
})

describe('WeekToolbar at a 200 %-equivalent layout width (R-57 reflow)', () => {
  // The week navigation is three buttons whose min-content width (44 + 99 + 44 + two 4px gaps
  // = 195px) is wider than the page's content row at a 195 CSS px layout width (163px). With
  // `shrink-0` on that group the row could not shrink, so the WHOLE PAGE was wider than its
  // client width: a 16px document-level horizontal overflow, measured at 195 CSS px.
  //
  // The fix is that the group may shrink and wrap: the row breaks between the buttons, each of
  // which keeps its own words on one line. Nothing is clipped and no width is hidden.
  it('lets the week-navigation group shrink and wrap instead of forcing the page wider', () => {
    renderToolbar()
    const group = screen.getByRole('button', { name: 'Previous week' }).parentElement
    expect(group).toHaveClass('flex-wrap')
    expect(group).not.toHaveClass('shrink-0')
    expect(group).toHaveClass('min-w-0')
  })

  it('keeps each week-navigation control on one line, so no button\'s words break across two', () => {
    renderToolbar()
    expect(screen.getByRole('button', { name: 'This week' })).toHaveClass('whitespace-nowrap')
  })
})
