import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ParticipantRow } from './ParticipantRow'
import { makeParticipantRow, makeShift, makeUnfilledShift, WEEK_DAYS } from '../test-fixtures'
import { TONE } from '@/lib/tone'
import type { PendingAgreementDto } from '@/api/types'

function noop() {}

/** Renders one row (its header cell and week strip are a fragment, so no grid is needed to inspect the header). */
function renderRow(
  overrides: Parameters<typeof makeParticipantRow>[0] = {},
  { hideCoverageBadge = false }: { hideCoverageBadge?: boolean } = {},
) {
  const shifts = overrides.shifts ?? Array.from(
    { length: overrides.daysWithoutCover ?? 0 },
    (_, index) => makeUnfilledShift({ id: `unassigned-${index}`, serviceDate: WEEK_DAYS[index % WEEK_DAYS.length] }),
  )
  return render(
    <MemoryRouter>
      <ParticipantRow
        row={makeParticipantRow({ ...overrides, shifts })}
        days={WEEK_DAYS}
        canWrite
        onOpen={noop}
        onAssignTo={noop}
        onUnassign={noop}
        onDelete={noop}
        onAddShift={noop}
        hideCoverageBadge={hideCoverageBadge}
      />
    </MemoryRouter>,
  )
}

/** The sticky row-header cell that hosts a row's name link. */
function headerOf(name: string): HTMLElement {
  return screen.getByRole('link', { name }).closest('.sticky') as HTMLElement
}

function isBefore(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

describe('ParticipantRow header — two lines: the name above the readiness chip, ratio chip and coverage badge', () => {
  it('puts the name (with its markers) on line 1 and the ratio and coverage on line 2, in a flex-col --row-h header', () => {
    renderRow({ fullName: 'Grace Palmer-Hughes', hasRestrictivePractice: true, supportRatio: 'TwoToOne', daysWithoutCover: 6, readinessIssues: ['Intake not complete'] })

    const head = headerOf('Grace Palmer-Hughes')
    const name = screen.getByRole('link', { name: 'Grace Palmer-Hughes' })
    const line1 = name.parentElement as HTMLElement
    const ratio = screen.getByRole('img', { name: '2:1 support' })
    const line2 = ratio.parentElement!.parentElement as HTMLElement
    const readiness = screen.getByText(/Intake not complete/).closest('[title]') as HTMLElement

    expect(head).toHaveClass('flex', 'flex-col', 'justify-center', 'min-h-[var(--row-h)]')
    expect(line1).not.toBe(line2)
    expect(line1.parentElement).toBe(head)
    expect(line2.parentElement).toBe(head)
    expect(isBefore(line1, line2)).toBe(true)
    // Line 1 holds the name and its safety marker; line 2 the readiness chip then the right-hand group.
    expect(line1).toContainElement(screen.getByRole('img', { name: 'Restrictive practice authorised' }))
    expect(line1).not.toContainElement(readiness)
    expect(line2).toContainElement(readiness)
    expect(isBefore(readiness, ratio)).toBe(true)
    expect(line2).toContainElement(screen.getByRole('img', { name: '6 unassigned shifts' }))
  })
})

describe('ParticipantRow header — name, ratio chip, coverage badge', () => {
  it('keeps the three in reading order: name, then ratio chip, then coverage badge', () => {
    renderRow({ fullName: 'Grace Palmer-Hughes', supportRatio: 'TwoToOne', daysWithoutCover: 6 })

    const head = headerOf('Grace Palmer-Hughes')
    const name = screen.getByRole('link', { name: 'Grace Palmer-Hughes' })
    const chip = screen.getByRole('img', { name: '2:1 support' })
    const badge = screen.getByRole('img', { name: '6 unassigned shifts' })

    // Two stacked lines, vertically centred, still --row-h tall.
    expect(head).toHaveClass('flex', 'flex-col', 'justify-center', 'min-h-[var(--row-h)]')
    // DOM order is visual order.
    expect(isBefore(name, chip)).toBe(true)
    expect(isBefore(chip, badge)).toBe(true)
  })

  it('never squeezes or cuts the ratio chip or the badge, and keeps gap-2 between them', () => {
    renderRow({ fullName: 'Grace Palmer-Hughes', supportRatio: 'TwoToOne', daysWithoutCover: 6 })

    const name = screen.getByRole('link', { name: 'Grace Palmer-Hughes' })
    const chip = screen.getByRole('img', { name: '2:1 support' })
    const badge = screen.getByRole('img', { name: '6 unassigned shifts' })

    // gap-2 (8px) is the floor between the readiness chip and the right-hand group.
    expect(chip.parentElement!.parentElement).toHaveClass('gap-2')
    // Chip and badge share a group pushed to the right edge; each is shrink-0, so neither can be squeezed.
    const tail = chip.parentElement as HTMLElement
    expect(tail).toHaveClass('ml-auto', 'gap-2')
    expect(chip).toHaveClass('shrink-0')
    expect(badge).toHaveClass('shrink-0')
    expect(tail).toContainElement(badge)
    expect(chip.className).not.toMatch(/truncate|overflow-hidden/)
    expect(badge.className).not.toMatch(/truncate|overflow-hidden/)
    // The name is what yields: it truncates, with a title carrying the whole name.
    expect(name.parentElement).toHaveClass('min-w-0')
    expect(name).toHaveClass('min-w-0', 'truncate')
    expect(name).toHaveAttribute('title', 'Grace Palmer-Hughes')
  })

  it('draws the ratio as a small chip: just the label, with the support wording in its name and title', () => {
    renderRow({ supportRatio: 'OneToTwo' })

    const chip = screen.getByRole('img', { name: '1:2 support' })
    expect(chip).toHaveTextContent(/^1:2$/)
    expect(chip).toHaveAttribute('title', '1:2 support')
    expect(chip).toHaveClass('h-4', 'rounded-sm', 'tabular-nums')
  })

  it('falls back to the raw value for a ratio with no label, and spells a shared one out', () => {
    const { unmount } = renderRow({ supportRatio: 'SharedSupport' })
    expect(screen.getByRole('img', { name: 'Shared support' })).toHaveTextContent('Shared')
    unmount()

    renderRow({ supportRatio: 'SomethingNew' as never })
    expect(screen.getByRole('img', { name: 'SomethingNew support' })).toHaveTextContent('SomethingNew')
  })

  it('keeps the restrictive-practice marker with the name, ahead of the chips', () => {
    renderRow({ fullName: 'Grace Palmer-Hughes', hasRestrictivePractice: true, daysWithoutCover: 3 })

    const name = screen.getByRole('link', { name: 'Grace Palmer-Hughes' })
    const marker = screen.getByRole('img', { name: 'Restrictive practice authorised' })
    const chip = screen.getByRole('img', { name: '1:1 support' })

    expect(name.parentElement).toContainElement(marker)
    expect(marker).toHaveClass('shrink-0')
    expect(isBefore(marker, chip)).toBe(true)
  })

  it('does not switch its wording by column width: no container query, so the name gets the room at every width', () => {
    renderRow({ fullName: 'Mia Chen', daysWithoutCover: 6 })

    // The old design spelled the coverage count out in a 15rem-wide header (@container), and those 110px
    // are what truncated "Grace Palmer-Hughes" to "Grace Pa…" at 1920. One compact badge, always.
    expect(headerOf('Mia Chen')).not.toHaveClass('@container')
    const badge = screen.getByRole('img', { name: '6 unassigned shifts' })
    expect(badge.outerHTML).not.toMatch(/@\[|@container/)
    expect(headerOf('Mia Chen').innerHTML).not.toMatch(/@\[|@container/)
  })
})

describe('ParticipantRow header — coverage badge (a compact count; the words are its name and title)', () => {
  it('counts actual unassigned shifts, not empty days or cells', () => {
    renderRow({
      daysWithoutCover: 7,
      shifts: [
        makeUnfilledShift({ id: 'open-morning', serviceDate: '2026-08-18' }),
        makeUnfilledShift({ id: 'open-afternoon', serviceDate: '2026-08-18' }),
        makeShift({ id: 'assigned', serviceDate: '2026-08-18', staffId: 'staff-1', staffName: 'Alex Rivera' }),
      ],
    })

    const badge = screen.getByRole('img', { name: '2 unassigned shifts' })
    expect(badge).toHaveTextContent(/^2$/)
    expect(screen.queryByRole('img', { name: /days uncovered/ })).not.toBeInTheDocument()
  })

  it('reports zero unassigned shifts for an otherwise empty week', () => {
    renderRow({ daysWithoutCover: 7, shifts: [] })

    expect(screen.getByRole('img', { name: 'Fully covered' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /unassigned shift/ })).not.toBeInTheDocument()
  })

  it('shows "6 unassigned shifts" as a warning icon + the count, with the full wording as its title and accessible name', () => {
    renderRow({ daysWithoutCover: 6 })

    const badge = screen.getByRole('img', { name: '6 unassigned shifts' })
    expect(badge).toHaveAttribute('title', '6 unassigned shifts')
    // Only the count is text in the row; the words are not rendered at all (they cost the name 110px).
    expect(badge).toHaveTextContent(/^6$/)
    expect(within(badge).getByText('6')).toHaveClass('tabular-nums')
    expect(screen.queryByText('6 unassigned shifts')).not.toBeInTheDocument()
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // The amber warning-container tint is the colour meaning; it is unchanged.
    expect(badge).toHaveClass('bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]', 'h-4', 'rounded-sm')
  })

  it('pluralises the title and name: one shift is "1 unassigned shift"', () => {
    renderRow({ daysWithoutCover: 1 })

    const badge = screen.getByRole('img', { name: '1 unassigned shift' })
    expect(badge).toHaveAttribute('title', '1 unassigned shift')
    expect(badge).toHaveTextContent(/^1$/)
  })

  it('shows "Fully covered" as a check, with the words as its title and accessible name', () => {
    renderRow({ daysWithoutCover: 0 })

    const badge = screen.getByRole('img', { name: 'Fully covered' })
    expect(badge).toHaveAttribute('title', 'Fully covered')
    expect(badge).toHaveTextContent('')
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByText('Fully covered')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /unassigned shift/ })).not.toBeInTheDocument()
  })

  it('leaves the name the room the badge used to take: the badge is the compact size, not a 110px pill', () => {
    renderRow({ fullName: 'Grace Palmer-Hughes', hasRestrictivePractice: true, daysWithoutCover: 6 })

    const badge = screen.getByRole('img', { name: '6 unassigned shifts' })
    // A count is one glyph wide (a week has at most 7 uncovered days): icon + gap + digit inside px-1.5.
    expect(badge).toHaveClass('px-1.5', 'gap-1')
    expect(badge.className).not.toMatch(/(^|\s)(w-|min-w-|max-w-)/)
    // The name group is the flexible part; badge and chip are shrink-0 (asserted above), so the freed
    // room goes to the name.
    expect(screen.getByRole('link', { name: 'Grace Palmer-Hughes' }).parentElement).toHaveClass('min-w-0')
  })

  it('shows no coverage state at all on a week with no shifts anywhere, but still the ratio chip', () => {
    renderRow({ daysWithoutCover: 7 }, { hideCoverageBadge: true })

    expect(screen.queryByRole('img', { name: /unassigned shift|Fully covered/ })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '1:1 support' })).toBeInTheDocument()
  })

  it('draws no visually-hidden text: an sr-only span is a 1px clip box, i.e. text clipped without an ellipsis', () => {
    const { container } = renderRow({ hasRestrictivePractice: true, daysWithoutCover: 6 })

    expect(container.querySelector('.sr-only')).toBeNull()
  })
})

// A participant who is not fully ready carries a quiet warning chip in the name group. It is informational (WARN mode never blocks),
// and it must not cost the row its one --row-h line or its name; a participant with nothing missing must render exactly as before.
describe('ParticipantRow header — readiness chip', () => {
  const ISSUES = ['Intake not complete', 'No signed service agreement']
  const WARNING = 'Not ready: Intake not complete · No signed service agreement'

  it('draws no chip, and leaves the header markup exactly as it was, for a participant with nothing missing', () => {
    const { unmount } = renderRow({ fullName: 'Mia Chen', hasRestrictivePractice: true, daysWithoutCover: 3 })
    const before = headerOf('Mia Chen').innerHTML
    unmount()

    for (const readinessIssues of [undefined, [] as string[]]) {
      const { unmount: unmountThis } = renderRow({ fullName: 'Mia Chen', hasRestrictivePractice: true, daysWithoutCover: 3, readinessIssues })
      expect(headerOf('Mia Chen').innerHTML).toBe(before)
      expect(screen.queryByText(/not ready/i)).not.toBeInTheDocument()
      unmountThis()
    }
  })

  it('puts the chip on line 2, after the name and the restrictive-practice marker and ahead of the ratio chip and coverage badge', () => {
    renderRow({ fullName: 'Grace Palmer-Hughes', hasRestrictivePractice: true, daysWithoutCover: 6, readinessIssues: ISSUES })

    const name = screen.getByRole('link', { name: 'Grace Palmer-Hughes' })
    const marker = screen.getByRole('img', { name: 'Restrictive practice authorised' })
    const chip = screen.getByText(WARNING).closest('[title]') as HTMLElement
    const ratio = screen.getByRole('img', { name: '1:1 support' })
    const badge = screen.getByRole('img', { name: '6 unassigned shifts' })

    expect(name.parentElement).not.toContainElement(chip)
    expect(ratio.parentElement!.parentElement).toContainElement(chip)
    expect(isBefore(name, marker)).toBe(true)
    expect(isBefore(marker, chip)).toBe(true)
    expect(isBefore(chip, ratio)).toBe(true)
    expect(isBefore(chip, badge)).toBe(true)
  })

  it('carries the whole text in its title and wears the warning tone, nothing else', () => {
    renderRow({ readinessIssues: ISSUES })

    const chip = screen.getByText(WARNING).closest('[title]') as HTMLElement
    expect(chip).toHaveAttribute('title', WARNING)
    for (const cls of TONE.warning.solid.split(' ')) expect(chip).toHaveClass(cls)
    // Informational: no alert, nothing to press.
    expect(chip).not.toHaveAttribute('role')
    expect(chip.closest('[role="alert"]')).toBeNull()
    expect(chip.querySelector('button, input, a')).toBeNull()
  })

  it('stays inside the --row-h header on line 2: it takes what is left (never stretched past its text), shrinks to its icon, and truncates', () => {
    renderRow({ fullName: 'Grace Palmer-Hughes', hasRestrictivePractice: true, daysWithoutCover: 6, readinessIssues: ISSUES })

    const head = headerOf('Grace Palmer-Hughes')
    const chip = screen.getByText(WARNING).closest('[title]') as HTMLElement
    // Not taller than its token.
    expect(head).toHaveClass('flex', 'flex-col', 'min-h-[var(--row-h)]')
    // Sized like the row's other chips (h-4, rounded-sm, px-1.5), so name + chips stay within a 34px row.
    expect(chip).toHaveClass('h-4', 'rounded-sm', 'px-1.5')
    expect(chip).not.toHaveClass('rounded-full')
    // The room it takes: the leftover after the name (flex-1), up to its own text width (max-w-max), never below its icon (min-w-6).
    expect(chip).toHaveClass('flex-1', 'min-w-6', 'max-w-max')
    expect(screen.getByText(WARNING)).toHaveClass('min-w-0', 'truncate')
  })

  it('does not change what the name does: it still truncates with its title, in a group that can shrink', () => {
    renderRow({ fullName: 'Grace Palmer-Hughes', readinessIssues: ISSUES })

    const name = screen.getByRole('link', { name: 'Grace Palmer-Hughes' })
    expect(name).toHaveClass('min-w-0', 'truncate')
    expect(name).toHaveAttribute('title', 'Grace Palmer-Hughes')
    expect(name.parentElement).toHaveClass('min-w-0')
  })

  it('leaves the ratio chip and coverage badge as they were: shrink-0 and in the right-hand group', () => {
    renderRow({ daysWithoutCover: 6, readinessIssues: ISSUES })

    const ratio = screen.getByRole('img', { name: '1:1 support' })
    const badge = screen.getByRole('img', { name: '6 unassigned shifts' })
    const tail = ratio.parentElement as HTMLElement
    expect(tail).toHaveClass('min-w-0', 'ml-auto', 'gap-2')
    expect(ratio).toHaveClass('shrink-0')
    expect(badge).toHaveClass('shrink-0')
    expect(tail).toContainElement(badge)
    expect(tail.textContent).not.toMatch(/not ready/i)
  })
})

describe('ParticipantRow: a participant whose services have started but who is still onboarding', () => {
  it('carries a small "Onboarding" tag beside the ratio chip, and none for an active participant', () => {
    renderRow({ fullName: 'Sam Started', inOnboarding: true })
    const tag = within(headerOf('Sam Started')).getByText('Onboarding')
    expect(tag).toHaveAttribute('title', 'Services started; onboarding is still open')
    // The tag is what yields when onboarding, readiness, ratio and coverage meet in a narrow column: it truncates, the ratio and badge do not.
    expect(tag).toHaveClass('min-w-0', 'truncate')
  })

  it('shows no tag for a participant who has been made active', () => {
    renderRow({ fullName: 'Amy Active' })
    expect(within(headerOf('Amy Active')).queryByText('Onboarding')).not.toBeInTheDocument()
  })
})

describe('ParticipantRow: an agreement waiting for approval, and the Enforce row (spec 2026-10-15, decision A)', () => {
  const words = "Agreement v2 not approved: its shifts appear once it's approved for rostering"
  const waiting: PendingAgreementDto = { participantId: 'participant-1', displayName: 'Daniel Osei', draftId: 'd-2', version: 2, canReceiveServices: true }
  const renderWith = (pendingAgreement?: PendingAgreementDto, overrides: Parameters<typeof makeParticipantRow>[0] = {}) => render(
    <MemoryRouter>
      <ParticipantRow row={makeParticipantRow({ fullName: 'Daniel Osei', ...overrides })} days={WEEK_DAYS} canWrite pendingAgreement={pendingAgreement}
        onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} onAddShift={noop} hideCoverageBadge={false} />
    </MemoryRouter>,
  )

  it('marks the row with a muted Hourglass after the name, its words in its name and title', () => {
    renderWith(waiting)
    const marker = screen.getByRole('img', { name: words })
    expect(marker).toHaveAttribute('title', words)
    expect(marker).toHaveClass('shrink-0', 'text-muted-foreground')
    expect(isBefore(screen.getByRole('link', { name: 'Daniel Osei' }), marker)).toBe(true)
  })

  it('has no marker when nothing waits', () => {
    renderWith(undefined)
    expect(screen.queryByRole('img', { name: /not approved/ })).not.toBeInTheDocument()
  })

  it('says "Not ready for rostering" on a row the organisation refuses, even with no reasons', () => {
    renderWith(undefined, { notReadyForRostering: true })
    expect(within(headerOf('Daniel Osei')).getByText('Not ready for rostering')).toBeInTheDocument()
  })
})
