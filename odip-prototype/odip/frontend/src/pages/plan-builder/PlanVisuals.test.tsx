import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { draftBlock, mondayWednesday } from '@/test/fixtures/planPricing'
import { PLAN_TEMPLATES } from '@/lib/planTemplates'
import { BandPreview } from './BandPreview'
import { NumberField } from './NumberField'
import { TemplateCards } from './TemplateCards'
import { WeekStrip } from './WeekStrip'

describe('WeekStrip', () => {
  it('says each day\'s times in its text alternative, since the picture itself is not what a screen reader reads', () => {
    const blocks = [mondayWednesday('b1'), mondayWednesday('b2', { days: ['Friday'], start: '22:00:00', end: '06:00:00' })]
    render(<WeekStrip blocks={blocks} />)

    const picture = screen.getByRole('img')
    const label = picture.getAttribute('aria-label') ?? ''
    expect(label).toContain('Monday: 09:00–13:00')
    expect(label).toContain('Wednesday: 09:00–13:00')
    expect(label).toContain('Friday: 22:00–24:00')
    expect(label).toContain('Saturday: 00:00–06:00')      // a block across midnight carries on in the next day
    expect(label).toContain('Tuesday: no support')
    expect(label).toContain('Sunday: no support')
  })

  it('draws one bar for each stretch of each block and the strong colour only for the block it is told to', () => {
    const { container } = render(<WeekStrip blocks={[mondayWednesday('b1'), mondayWednesday('b2', { days: ['Saturday'] })]} highlightId="b2" />)

    expect(container.querySelectorAll('[class*="bg-[var(--color-primary)]"]:not([class*="inline-block"])')).toHaveLength(1)
    expect(container.querySelectorAll('[data-highlight="true"]')).toHaveLength(1)
    expect(screen.getByText('This block')).toBeInTheDocument()
    expect(screen.getByText('Other blocks')).toBeInTheDocument()
  })

  it('has no legend for a block when none is highlighted, and shows each day\'s hours underneath', () => {
    render(<WeekStrip blocks={[mondayWednesday()]} />)

    expect(screen.queryByText('This block')).not.toBeInTheDocument()
    expect(screen.getAllByText('4 h')).toHaveLength(2)    // Monday and Wednesday
    expect(screen.getAllByText('—')).toHaveLength(5)      // the days with nothing
    expect(screen.getByText(/weekday prices change at 06:00 and 20:00/)).toBeInTheDocument()
  })

  it('puts two blocks on at the same time side by side', () => {
    const { container } = render(<WeekStrip blocks={[mondayWednesday('b1', { days: ['Monday'] }), mondayWednesday('b2', { days: ['Monday'], start: '10:00:00', end: '12:00:00' })]} />)

    const bars = [...container.querySelectorAll<HTMLElement>('span.absolute.rounded-\\[var\\(--radius-sm\\)\\].border')]
    expect(bars.map(bar => bar.style.width)).toEqual(['calc(50% - 2px)', 'calc(50% - 2px)'])
  })
})

describe('BandPreview', () => {
  it('cuts a block across midnight where the weekday prices change, and says each part and how long it lasts', () => {
    const { container } = render(<BandPreview block={{ days: ['Monday'], start: '22:00:00', end: '06:00:00' }} />)

    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Weekday price bands. The block covers Evening 22:00–24:00 (2 h); Night 00:00–06:00 next day (6 h).')
    expect(container.querySelector('p')).toHaveTextContent('8 h across midnight: Evening 22:00–24:00 (2 h), Night 00:00–06:00 next day (6 h).')
  })

  it('says a same-day block is on the same day and warns that a weekend is one price for the whole day', () => {
    const { container } = render(<BandPreview block={{ days: ['Saturday', 'Monday'], start: '09:00:00', end: '13:00:00' }} />)

    expect(container.querySelector('p')).toHaveTextContent('4 h on the same day: Daytime 09:00–13:00 (4 h).')
    expect(screen.getByText(/Saturday and Sunday are one price for the whole day/)).toBeInTheDocument()
  })

  it('has nothing to draw until there are times', () => {
    const { container } = render(<BandPreview block={{ days: ['Monday'], start: '', end: '' }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('TemplateCards', () => {
  const props = { state: 'NSW' as const, zone: 'National' as const }

  it('are six radios in the Template step, each saying what it is for and the one line it fills in, and choosing one reports it', async () => {
    const user = userEvent.setup()
    const onChoose = vi.fn()
    render(<TemplateCards {...props} mode="radio" selectedKey="community-weekdays" onChoose={onChoose} />)

    const group = screen.getByRole('group', { name: 'Start from a template' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(6)
    expect(radios.map(radio => (radio as HTMLInputElement).checked)).toEqual([true, false, false, false, false, false])
    expect(within(group).getByText('Mon–Fri · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()
    expect(within(group).getByText('Sat · 09:00–15:00 · Group activity 1:3')).toBeInTheDocument()
    expect(within(group).getByText('No days or times yet')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Saturday group outing 1:3/ }))
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose.mock.calls[0][0]).toBe(PLAN_TEMPLATES[1])
  })

  it('moves the choice with the arrow keys, as radios do', async () => {
    const user = userEvent.setup()
    const onChoose = vi.fn()
    render(<TemplateCards {...props} mode="radio" selectedKey="community-weekdays" onChoose={onChoose} />)

    screen.getByRole('radio', { name: /Community access weekdays/ }).focus()
    await user.keyboard('{ArrowRight}')

    expect(onChoose.mock.calls[0][0].key).toBe('saturday-outing')
  })

  it('start a block at once when they are the way into an empty plan, as buttons', async () => {
    const user = userEvent.setup()
    const onChoose = vi.fn()
    render(<TemplateCards {...props} mode="start" onChoose={onChoose} />)

    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Personal care mornings/ }))
    expect(onChoose.mock.calls[0][0].key).toBe('personal-care-mornings')
  })
})

describe('NumberField', () => {
  function Harness({ initial = 3 }: { initial?: number }) {
    const [value, setValue] = useState(initial)
    return (
      <>
        <NumberField label="Workers" value={value} onChange={setValue} min={1} max={10} />
        <output data-testid="value">{Number.isNaN(value) ? 'NaN' : value}</output>
        <button type="button" onClick={() => setValue(7)}>Set 7</button>
      </>
    )
  }

  it('lets the box be emptied to type another figure, instead of snapping to 0 under the cursor', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText('Workers')

    await user.clear(input)
    expect(input).toHaveValue(null)
    expect(screen.getByTestId('value')).toHaveTextContent('NaN')

    await user.type(input, '12')
    expect(input).toHaveValue(12)
    expect(screen.getByTestId('value')).toHaveTextContent('12')
  })

  it('shows a value changed from outside (a template, a toggle) as soon as it arrives', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Set 7' }))

    expect(screen.getByLabelText('Workers')).toHaveValue(7)
  })

  it('keeps a decimal point the person has typed', async () => {
    const user = userEvent.setup()
    function Decimal() {
      const [value, setValue] = useState(1)
      return <NumberField label="Rate" value={value} onChange={setValue} step={0.01} inputMode="decimal" />
    }
    render(<Decimal />)

    const input = screen.getByLabelText('Rate')
    await user.clear(input)
    await user.type(input, '0.99')

    expect(input).toHaveValue(0.99)
  })
})

// A block fixture is a block: the strip and the cards are tested with the same ones the steps use.
describe('fixtures', () => {
  it('a draft block carries the requirements beside the block', () => {
    expect(draftBlock().requirements).toEqual({ workerGender: 'NoPreference', driver: false, skills: [] })
  })
})
