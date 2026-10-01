import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReadinessNote } from './ReadinessNote'
import { TONE } from '@/lib/tone'

const ISSUES = ['Intake not complete', 'No signed service agreement']
const FULL_TEXT = 'Not ready: Intake not complete · No signed service agreement'

describe('ReadinessNote — nothing to say', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty list', []],
  ])('renders nothing for %s, in either variant', (_label, issues) => {
    const { container, rerender } = render(<ReadinessNote issues={issues} />)
    expect(container).toBeEmptyDOMElement()

    rerender(<ReadinessNote issues={issues} variant="chip" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ReadinessNote — the words', () => {
  it('joins the issues with " · " after "Not ready:", in the server\'s own words', () => {
    render(<ReadinessNote issues={ISSUES} />)

    expect(screen.getByText(FULL_TEXT)).toBeInTheDocument()
  })

  it('reads "Not ready: X" for a single issue, with no dangling separator', () => {
    render(<ReadinessNote issues={['Onboarding not complete: service type']} />)

    expect(screen.getByText('Not ready: Onboarding not complete: service type')).toBeInTheDocument()
  })

  it('prints the same words in the chip', () => {
    render(<ReadinessNote issues={ISSUES} variant="chip" />)

    expect(screen.getByText(FULL_TEXT)).toBeInTheDocument()
  })

  it('carries the whole text in its title, so a truncated chip can still be read', () => {
    const { container } = render(<ReadinessNote issues={ISSUES} variant="chip" />)

    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute('title', FULL_TEXT)
    expect(screen.getByTitle(FULL_TEXT)).toBe(root)
  })

  it('carries the whole text in the line\'s title too', () => {
    const { container } = render(<ReadinessNote issues={ISSUES} />)

    expect(container.firstElementChild).toHaveAttribute('title', FULL_TEXT)
  })
})

describe('ReadinessNote — the warning tone, and nothing else', () => {
  it('draws the chip in the warning tone\'s solid pair', () => {
    const { container } = render(<ReadinessNote issues={ISSUES} variant="chip" />)

    const chip = container.firstElementChild as HTMLElement
    expect(chip.tagName).toBe('SPAN')
    for (const cls of TONE.warning.solid.split(' ')) expect(chip).toHaveClass(cls)
    expect(chip).toHaveClass('text-xs', 'rounded-full')
  })

  it('draws the line as the warning tone\'s ink on the card: text only, no wash and no fill', () => {
    const { container } = render(<ReadinessNote issues={ISSUES} />)

    const line = container.firstElementChild as HTMLElement
    expect(line.tagName).toBe('P')
    for (const cls of TONE.warning.ink.split(' ')) expect(line).toHaveClass(cls)
    expect(line).toHaveClass('text-xs')
    expect(line.className).not.toMatch(/(^|\s)bg-/)
    // The fill belongs to the chip only.
    for (const cls of TONE.warning.solid.split(' ')) {
      if (cls.startsWith('bg-')) expect(line).not.toHaveClass(cls)
    }
  })

  it('defaults to the line variant', () => {
    const { container } = render(<ReadinessNote issues={ISSUES} />)

    expect(container.firstElementChild?.tagName).toBe('P')
  })

  it('introduces no colour of its own: every colour class comes from the warning tone', () => {
    const { container } = render(
      <>
        <ReadinessNote issues={ISSUES} variant="chip" />
        <ReadinessNote issues={ISSUES} />
      </>,
    )

    const toneClasses = new Set([...TONE.warning.solid.split(' '), ...TONE.warning.ink.split(' ')])
    for (const el of Array.from(container.querySelectorAll('*'))) {
      for (const cls of Array.from(el.classList)) {
        if (/^(bg|text-\[|border|ring|fill|stroke)/.test(cls)) expect(toneClasses.has(cls)).toBe(true)
      }
    }
  })
})

describe('ReadinessNote — informational, never in the way', () => {
  it('is not an alert, in either variant, and has nothing to press or fill in', () => {
    const { container } = render(
      <>
        <ReadinessNote issues={ISSUES} variant="chip" />
        <ReadinessNote issues={ISSUES} />
      </>,
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(container.querySelector('button, input, select, textarea, a, [tabindex]')).toBeNull()
  })

  it('announces the line politely (it appears when a participant is picked) and leaves the chip out of the live regions', () => {
    const { container } = render(
      <>
        <ReadinessNote issues={ISSUES} />
        <div data-testid="chip-host"><ReadinessNote issues={ISSUES} variant="chip" /></div>
      </>,
    )

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(container.querySelector('p')).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('chip-host').querySelector('[role]')).toBeNull()
  })

  it('hides the icon from assistive tech: the words are the whole message', () => {
    const { container } = render(<ReadinessNote issues={ISSUES} variant="chip" />)

    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('ReadinessNote — a narrow row', () => {
  it('lets the chip give way: it can shrink to nothing, never outgrows its container, and the text truncates', () => {
    const { container } = render(<ReadinessNote issues={ISSUES} variant="chip" />)

    const chip = container.firstElementChild as HTMLElement
    expect(chip).toHaveClass('min-w-0', 'max-w-full')
    const text = screen.getByText(FULL_TEXT)
    expect(text).toHaveClass('min-w-0', 'truncate')
  })

  it('makes the chip\'s text all-or-nothing, never a sliver: a basis in a wrapping, clipped, one-line box that wraps the text out of sight, and centres the icon, when there is no room for it', () => {
    const { container } = render(<ReadinessNote issues={ISSUES} variant="chip" />)

    const chip = container.firstElementChild as HTMLElement
    // One line, clipped: a wrapped text is hidden, not shown on a second line. The row gap is taller than the box so no part of it peeks in.
    expect(chip).toHaveClass('h-5', 'flex-wrap', 'overflow-hidden', 'content-start', 'gap-y-5')
    // With nothing left for the text, the icon alone is centred in the pill.
    expect(chip).toHaveClass('items-center', 'justify-center')
    // The text claims a small basis (so the wrap happens at a clean threshold) and then takes whatever is left, truncating.
    expect(screen.getByText(FULL_TEXT)).toHaveClass('flex-1', 'basis-12', 'min-w-0', 'truncate')
    // Still in the DOM when it does not fit (clipped, not removed), so assistive tech reads it; and still in the title.
    expect(screen.getByText(FULL_TEXT)).toBeInTheDocument()
    expect(chip).toHaveAttribute('title', FULL_TEXT)
  })

  it('lets the line wrap to three lines at most rather than cutting at one', () => {
    render(<ReadinessNote issues={ISSUES} />)

    const text = screen.getByText(FULL_TEXT)
    expect(text).toHaveClass('min-w-0', 'line-clamp-3')
    expect(text).not.toHaveClass('truncate')
  })

  it('takes the caller\'s className over its own where they collide (a row wants a squarer chip)', () => {
    const { container } = render(<ReadinessNote issues={ISSUES} variant="chip" className="h-5 rounded-sm px-1.5" />)

    const chip = container.firstElementChild as HTMLElement
    expect(chip).toHaveClass('h-5', 'rounded-sm', 'px-1.5')
    expect(chip).not.toHaveClass('rounded-full')
    expect(chip).not.toHaveClass('px-2')
    // ...and still wears the tone.
    for (const cls of TONE.warning.solid.split(' ')) expect(chip).toHaveClass(cls)
  })
})
