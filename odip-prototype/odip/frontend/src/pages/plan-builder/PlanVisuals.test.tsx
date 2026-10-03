import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
    expect(screen.getAllByText('–')).toHaveLength(5)      // the days with nothing: an en dash, as the dashboard's tiles use
    expect(screen.getByText(/weekday prices change at 06:00 and 20:00/)).toBeInTheDocument()
  })

  // Design review 9: the seams were drawn on Saturday and Sunday too, under a caption that says "weekday prices"; weekends are one price all day.
  it('draws the 06:00 and 20:00 seams on the five weekday columns only', () => {
    const { container } = render(<WeekStrip blocks={[mondayWednesday()]} />)

    expect(container.querySelectorAll('[data-seam="true"]')).toHaveLength(10)    // two a day, Monday to Friday
    const columns = [...container.querySelectorAll('div.relative.overflow-hidden')]
    expect(columns).toHaveLength(7)
    expect(columns.map(column => column.querySelectorAll('[data-seam="true"]').length)).toEqual([2, 2, 2, 2, 2, 0, 0])
  })

  // Design review 9: bars carried no number and no title, so nothing tied a bar to its row, and a block of two hours is thirteen pixels.
  it('puts the block\'s number in a bar tall enough for it, and names every bar with its block\'s number and readable line', () => {
    const blocks = [
      mondayWednesday('b1'),
      mondayWednesday('b2', { days: ['Friday'], start: '09:00:00', end: '10:30:00' }),     // an hour and a half: a sliver, so no number inside
      mondayWednesday('b3', { days: ['Saturday'], start: '09:00:00', end: '15:00:00', supportType: 'GroupActivity', participantsPresent: 3 }),
    ]
    const { container } = render(<WeekStrip blocks={blocks} />)

    const bar = (title: string) => container.querySelector<HTMLElement>(`span[title^="${title}"]`)
    expect(container.querySelectorAll('span[title]')).toHaveLength(4)       // Monday and Wednesday of block 1, Friday of block 2, Saturday of block 3
    expect(container.querySelectorAll('span[title^="1. "]')).toHaveLength(2)
    expect(bar('1. ')).toHaveAttribute('title', '1. Mon, Wed · 09:00–13:00 · Community access 1:1')
    expect(bar('1. ')).toHaveTextContent('1')
    expect(bar('2. ')).toBeEmptyDOMElement()                                // 90 minutes is under the line for a number
    expect(bar('3. ')).toHaveTextContent('3')
    expect(bar('3. ')).toHaveAttribute('title', '3. Sat · 09:00–15:00 · Group activity 1:3')
  })

  it('does not put a number in a bar that shares its day with so many others it is a few pixels wide', () => {
    const crowd = ['b1', 'b2', 'b3', 'b4'].map(id => mondayWednesday(id, { days: ['Monday'] }))
    const { container } = render(<WeekStrip blocks={crowd} />)

    expect(container.querySelectorAll('span[title]')).toHaveLength(4)
    expect([...container.querySelectorAll('span[title]')].every(bar => bar.textContent === '')).toBe(true)
  })

  // Review F8: the other blocks' bars were 1.17:1 against their track, and the dashed seams 1.54:1; a graphic the picture cannot be read without holds 3:1 (WCAG 1.4.11).
  describe('contrast of what it draws, read from the palette in index.css', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../index.css'), 'utf-8')
    const theme = css.slice(css.indexOf('@theme'), css.indexOf('}', css.indexOf('@theme')))
    const token = (name: string) => {
      const hex = new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6})`).exec(theme)?.[1]
      if (!hex) throw new Error(`--color-${name} is not a six digit colour in index.css`)
      return [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16))
    }
    const luminance = ([r, g, b]: number[]) => [r, g, b].map(c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
    const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
    const over = (fg: number[], bg: number[], alpha: number) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha))
    const track = token('surface-container-low')

    it('draws every bar with the full primary border, 3:1 or better against the track, and the fill of the other blocks only tints', () => {
      const { container } = render(<WeekStrip blocks={[mondayWednesday('b1'), mondayWednesday('b2', { days: ['Saturday'] })]} highlightId="b1" />)

      for (const bar of container.querySelectorAll('span[title]')) expect(bar.className).toContain('border-[var(--color-primary)] ')
      expect(contrast(token('primary'), track)).toBeGreaterThanOrEqual(3)
      expect(container.querySelector('span[title^="2. "]')?.className).toContain('bg-[var(--color-primary-fixed)]')
      expect(container.querySelector('span[title^="1. "]')?.className).toContain('bg-[var(--color-primary)]')     // this block: solid, not another hue
    })

    it('draws the numbers legibly: on the tint in the ink made for it, on the solid fill in white', () => {
      expect(contrast(token('on-primary-fixed'), token('primary-fixed'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast([255, 255, 255], token('primary'))).toBeGreaterThanOrEqual(4.5)
    })

    it('draws the seams at 3:1 or better against the track', () => {
      const { container } = render(<WeekStrip blocks={[mondayWednesday()]} />)
      const seam = container.querySelector('[data-seam="true"]') as HTMLElement
      const alpha = Number(/border-\[var\(--color-muted-foreground\)\]\/(\d+)/.exec(seam.className)?.[1]) / 100

      expect(alpha).toBeGreaterThan(0)
      expect(contrast(over(token('muted-foreground'), track, alpha), track)).toBeGreaterThanOrEqual(3)
    })
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
