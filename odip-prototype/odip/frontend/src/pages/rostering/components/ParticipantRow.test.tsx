import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ParticipantRow } from './ParticipantRow'
import { makeParticipantRow, WEEK_DAYS } from '../test-fixtures'

function noop() {}

/** Renders one row (its header cell and week strip are a fragment, so no grid is needed to inspect the header). */
function renderRow(
  overrides: Parameters<typeof makeParticipantRow>[0] = {},
  { hideCoverageBadge = false }: { hideCoverageBadge?: boolean } = {},
) {
  return render(
    <MemoryRouter>
      <ParticipantRow
        row={makeParticipantRow(overrides)}
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

describe('ParticipantRow header — one line: name, ratio chip, coverage badge', () => {
  it('lays the three out on a single --row-h flex line, in that order', () => {
    renderRow({ fullName: 'Grace Palmer-Hughes', supportRatio: 'TwoToOne', daysWithoutCover: 6 })

    const head = headerOf('Grace Palmer-Hughes')
    const name = screen.getByRole('link', { name: 'Grace Palmer-Hughes' })
    const chip = screen.getByRole('img', { name: '2:1 support' })
    const badge = screen.getByRole('img', { name: '6 days uncovered' })

    // A row, not the old two stacked lines: no flex-col, vertically centred, still --row-h tall.
    expect(head).toHaveClass('flex', 'items-center', 'min-h-[var(--row-h)]')
    expect(head).not.toHaveClass('flex-col')
    // DOM order is visual order in a single flex row.
    expect(isBefore(name, chip)).toBe(true)
    expect(isBefore(chip, badge)).toBe(true)
  })

  it('never squeezes or cuts the ratio chip or the badge, and keeps gap-2 between them and the name', () => {
    renderRow({ fullName: 'Grace Palmer-Hughes', supportRatio: 'TwoToOne', daysWithoutCover: 6 })

    const head = headerOf('Grace Palmer-Hughes')
    const name = screen.getByRole('link', { name: 'Grace Palmer-Hughes' })
    const chip = screen.getByRole('img', { name: '2:1 support' })
    const badge = screen.getByRole('img', { name: '6 days uncovered' })

    // gap-2 (8px) is the floor between the name group and the chips, so the name never touches the badge.
    expect(head).toHaveClass('gap-2')
    // Chip and badge share a shrink-0 group pushed to the right edge: neither can be squeezed.
    const tail = chip.parentElement as HTMLElement
    expect(tail).toHaveClass('shrink-0', 'ml-auto', 'gap-2')
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
    expect(chip).toHaveClass('h-5', 'rounded-sm', 'tabular-nums')
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

    // The old design spelled "6 days uncovered" out in a 15rem-wide header (@container), and those 110px
    // are what truncated "Grace Palmer-Hughes" to "Grace Pa…" at 1920. One compact badge, always.
    expect(headerOf('Mia Chen')).not.toHaveClass('@container')
    const badge = screen.getByRole('img', { name: '6 days uncovered' })
    expect(badge.outerHTML).not.toMatch(/@\[|@container/)
    expect(headerOf('Mia Chen').innerHTML).not.toMatch(/@\[|@container/)
  })
})

describe('ParticipantRow header — coverage badge (a compact count; the words are its name and title)', () => {
  it('shows "6 days uncovered" as a warning icon + the count, with the full wording as its title and accessible name', () => {
    renderRow({ daysWithoutCover: 6 })

    const badge = screen.getByRole('img', { name: '6 days uncovered' })
    expect(badge).toHaveAttribute('title', '6 days uncovered')
    // Only the count is text in the row; the words are not rendered at all (they cost the name 110px).
    expect(badge).toHaveTextContent(/^6$/)
    expect(within(badge).getByText('6')).toHaveClass('tabular-nums')
    expect(screen.queryByText('6 days uncovered')).not.toBeInTheDocument()
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // The amber warning-container tint is the colour meaning; it is unchanged.
    expect(badge).toHaveClass('bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]', 'h-5', 'rounded-sm')
  })

  it('pluralises the title and name: one day is "1 day uncovered"', () => {
    renderRow({ daysWithoutCover: 1 })

    const badge = screen.getByRole('img', { name: '1 day uncovered' })
    expect(badge).toHaveAttribute('title', '1 day uncovered')
    expect(badge).toHaveTextContent(/^1$/)
  })

  it('shows "Fully covered" as a check, with the words as its title and accessible name', () => {
    renderRow({ daysWithoutCover: 0 })

    const badge = screen.getByRole('img', { name: 'Fully covered' })
    expect(badge).toHaveAttribute('title', 'Fully covered')
    expect(badge).toHaveTextContent('')
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByText('Fully covered')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /uncovered/ })).not.toBeInTheDocument()
  })

  it('leaves the name the room the badge used to take: the badge is the compact size, not a 110px pill', () => {
    renderRow({ fullName: 'Grace Palmer-Hughes', hasRestrictivePractice: true, daysWithoutCover: 6 })

    const badge = screen.getByRole('img', { name: '6 days uncovered' })
    // A count is one glyph wide (a week has at most 7 uncovered days): icon + gap + digit inside px-1.5.
    expect(badge).toHaveClass('px-1.5', 'gap-1')
    expect(badge.className).not.toMatch(/(^|\s)(w-|min-w-|max-w-)/)
    // The name group is the flexible part; badge and chip are shrink-0 (asserted above), so the freed
    // room goes to the name.
    expect(screen.getByRole('link', { name: 'Grace Palmer-Hughes' }).parentElement).toHaveClass('min-w-0')
  })

  it('shows no coverage state at all on a week with no shifts anywhere, but still the ratio chip', () => {
    renderRow({ daysWithoutCover: 7 }, { hideCoverageBadge: true })

    expect(screen.queryByRole('img', { name: /uncovered|Fully covered/ })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '1:1 support' })).toBeInTheDocument()
  })

  it('draws no visually-hidden text: an sr-only span is a 1px clip box, i.e. text clipped without an ellipsis', () => {
    const { container } = renderRow({ hasRestrictivePractice: true, daysWithoutCover: 6 })

    expect(container.querySelector('.sr-only')).toBeNull()
  })
})
