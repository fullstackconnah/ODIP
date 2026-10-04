// BudgetFindingDetails: the figures the server sent, printed and nothing else. The three states a
// figure can be in are the point of this suite, because every one of them is a way a coordinator
// could otherwise be misled about a participant's money.

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen, within } from '@testing-library/react'
import { BudgetFindingDetails } from './BudgetFindingDetails'
import { RESTRICTED_FIGURE } from './budgetFigures'
import {
  amount,
  emptyFigures,
  fullFigures,
  notRecorded,
  restrictedFigures,
  unknown,
  zeroFigures,
} from './fixtures'
import type { BudgetPeriodFigures } from './budgetOverrideTypes'

afterEach(() => cleanup())

/**
 * The value cell for a row. The cell carries a screen-reader-only explanation of WHY a figure is
 * missing, so this strips the `.sr-only` span to give back the sighted text.
 */
const valueOf = (label: string) => {
  const dt = screen.getByText(label, { selector: 'dt' })
  const dd = dt.parentElement!.querySelector('dd')!
  const clone = dd.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.sr-only').forEach(n => n.remove())
  return clone.textContent!.trim()
}

/** The same cell with its hidden explanation left in — that is what a screen reader reads. */
const cellOf = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement!.querySelector('dd')!

const mixedFigures: BudgetPeriodFigures = {
  ...fullFigures,
  available: notRecorded,
  remaining: unknown,
  shiftCost: amount(0),
  projectedTotal: unknown,
  projectedOverrun: amount(640),
}

describe('the complete case', () => {
  it('prints every figure the server sent', () => {
    render(<BudgetFindingDetails figures={fullFigures} />)
    expect(valueOf('Pool')).toBe('Core (flexible)')
    expect(valueOf('Funding period')).toBe('Oct–Dec 2026')
    expect(valueOf('Available this period')).toBe('$8,000.00')
    expect(valueOf('Left in this period')).toBe('$3,800.00')
    expect(valueOf('This shift')).toBe('$292.32')
    expect(valueOf('With this shift')).toBe('$8,640.00')
    expect(valueOf('Over by')).toBe('$640.00')
  })

  it('is a labelled landmark, so a screen reader can jump to it', () => {
    render(<BudgetFindingDetails figures={fullFigures} />)
    expect(screen.getByRole('region', { name: 'Budget figures for this shift' })).toBeInTheDocument()
  })

  it('is a description list, so a screen reader can pair each label with its value', () => {
    render(<BudgetFindingDetails figures={fullFigures} />)
    const region = screen.getByRole('region', { name: 'Budget figures for this shift' })
    expect(within(region).getAllByRole('term')).toHaveLength(7)
    expect(within(region).getAllByRole('definition')).toHaveLength(7)
  })

  it('names the pool, the forecast, the available amount and the period in one sentence', () => {
    render(<BudgetFindingDetails figures={fullFigures} />)
    expect(screen.getByText('Takes Core (flexible) to $8,640.00 of $8,000.00 for Oct–Dec 2026.')).toBeInTheDocument()
  })
})

describe('a missing figure is never a zero', () => {
  it('prints an en dash for a figure the server did not record', () => {
    render(<BudgetFindingDetails figures={emptyFigures} />)
    expect(valueOf('Available this period')).toBe('–')
    expect(valueOf('With this shift')).toBe('–')
  })

  it('prints an en dash for a figure the server has not worked out', () => {
    render(<BudgetFindingDetails figures={mixedFigures} />)
    expect(valueOf('Left in this period')).toBe('–')
    expect(valueOf('With this shift')).toBe('–')
  })

  it('tells a screen reader which of the two it is, since the en dash alone does not', () => {
    render(<BudgetFindingDetails figures={emptyFigures} />)
    expect(cellOf('Available this period').textContent).toContain('not recorded')
    expect(cellOf('With this shift').textContent).toContain('not available')
  })

  it('never shows a $0.00 for a figure that is missing', () => {
    render(<BudgetFindingDetails figures={mixedFigures} />)
    // The one row that genuinely is zero is $0.00; every other figure is a dash.
    expect(valueOf('This shift')).toBe('$0.00')
    expect(valueOf('Available this period')).not.toContain('$')
    expect(valueOf('Left in this period')).not.toContain('$')
  })

  it('says the forecast is unavailable rather than writing a sentence with a hole in it', () => {
    render(<BudgetFindingDetails figures={emptyFigures} />)
    expect(screen.getByText(/the forecast is not available/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/to\s+of\s/)
  })

  it('still names the pool and the period, so a refusal is never anonymous', () => {
    render(<BudgetFindingDetails figures={emptyFigures} />)
    expect(valueOf('Pool')).toBe('Core (flexible)')
    expect(valueOf('Funding period')).toBe('Oct–Dec 2026')
  })
})

describe('a recorded zero is an answer', () => {
  it('prints every figure of an all-zero period as $0.00, not as a dash', () => {
    render(<BudgetFindingDetails figures={zeroFigures} />)
    expect(valueOf('Available this period')).toBe('$0.00')
    expect(valueOf('Left in this period')).toBe('$0.00')
    expect(valueOf('This shift')).toBe('$0.00')
    expect(valueOf('Over by')).toBe('$0.00')
    // The visible text of the figure cells. Scanning the whole document would false-positive on
    // the en dash inside the period label "Jan–Mar 2027", which is a date range, not a figure.
    const figureCells = [...document.querySelectorAll('dd')].map(cell => {
      const clone = cell.cloneNode(true) as HTMLElement
      clone.querySelectorAll('.sr-only').forEach(n => n.remove())
      return clone.textContent!.trim()
    })
    expect(figureCells).not.toContain('–')
    expect(figureCells.filter(v => v.includes('$'))).toHaveLength(5)
  })

  it('does not mistake a zero allowance for an unrecorded budget in the note', () => {
    render(<BudgetFindingDetails figures={zeroFigures} />)
    expect(screen.getByText(/never blocked by a budget warning/)).toBeInTheDocument()
  })
})

describe('the wording is never a prohibition', () => {
  it.each([
    ['full', fullFigures],
    ['empty', emptyFigures],
    ['zero', zeroFigures],
    ['mixed', mixedFigures],
  ])('says nothing that forbids recording delivered work (%s)', (_label, figures) => {
    render(<BudgetFindingDetails figures={figures} />)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/cannot be (saved|recorded|claimed)/i)
    expect(text).not.toMatch(/must not (save|record|claim)/i)
    expect(text).not.toMatch(/not allowed to (record|claim)/i)
  })

  it('says plainly that a delivered shift is never blocked, when there is an overrun on screen', () => {
    render(<BudgetFindingDetails figures={fullFigures} />)
    expect(screen.getByText(/never blocked by a budget warning/)).toBeInTheDocument()
  })

  it('does not compute anything: it prints the server’s numbers and no derived ones', () => {
    // available 8000, remaining 3800, shift 292.32, projected 8640. If it summed, "With this
    // shift" would be 3800 + 292.32 = 4092.32. It must be the server's 8640.
    render(<BudgetFindingDetails figures={fullFigures} />)
    expect(valueOf('With this shift')).toBe('$8,640.00')
    expect(valueOf('With this shift')).not.toBe('$4,092.32')
  })
})

describe('a privacy-restricted view', () => {
  it('puts no amount anywhere in the DOM', () => {
    render(<BudgetFindingDetails figures={restrictedFigures} />)
    expect(document.body.textContent).not.toMatch(/\$/)
  })

  it('says the same word in every money cell, so no amount can be inferred from which row is blank', () => {
    render(<BudgetFindingDetails figures={restrictedFigures} />)
    for (const label of ['Available this period', 'Left in this period', 'This shift', 'With this shift', 'Over by']) {
      expect(valueOf(label)).toBe(RESTRICTED_FIGURE)
    }
  })

  it('still names the pool and the period: those are not money, and the reader needs them', () => {
    render(<BudgetFindingDetails figures={restrictedFigures} />)
    expect(valueOf('Pool')).toBe('Core (flexible)')
    expect(valueOf('Funding period')).toBe('Oct–Dec 2026')
  })

  it('explains that hidden is not the same as none', () => {
    render(<BudgetFindingDetails figures={restrictedFigures} />)
    expect(screen.getByText(/never that there was none/)).toBeInTheDocument()
  })

  it('uses the same word even for a figure that is genuinely zero', () => {
    render(<BudgetFindingDetails figures={{ ...zeroFigures, restricted: true }} />)
    expect(valueOf('Available this period')).toBe(RESTRICTED_FIGURE)
    expect(document.body.textContent).not.toContain('$0.00')
  })

  it('tells a screen reader the figures are hidden, not that they are absent', () => {
    render(<BudgetFindingDetails figures={restrictedFigures} />)
    expect(cellOf('Available this period').textContent).toContain('hidden on this account')
  })
})

describe('the markup a phone width needs', () => {
  it('keeps every figure reachable without horizontal scrolling: seven rows, none dropped', () => {
    render(<BudgetFindingDetails figures={fullFigures} />)
    const region = screen.getByRole('region', { name: 'Budget figures for this shift' })
    expect(within(region).getAllByRole('term').map(t => t.textContent)).toEqual([
      'Pool',
      'Funding period',
      'Available this period',
      'Left in this period',
      'This shift',
      'With this shift',
      'Over by',
    ])
  })

  it('wraps a very long pool and period name rather than clipping it', () => {
    const long: BudgetPeriodFigures = {
      ...fullFigures,
      pool: 'Improved Daily Living Skills, Plan managed by a third-party provider',
      period: 'A funding period with a long descriptive label supplied by the plan manager',
    }
    render(<BudgetFindingDetails figures={long} />)
    expect(valueOf('Pool')).toContain('third-party provider')
    expect(valueOf('Funding period')).toContain('descriptive label')
  })
})

describe('an unknown figure with a known one beside it', () => {
  it('mutes only the unknown cell, so a reader can see at a glance which figure is missing', () => {
    render(<BudgetFindingDetails figures={mixedFigures} />)
    expect(cellOf('Available this period').className).toMatch(/muted-foreground/)
    expect(cellOf('Pool').className).not.toMatch(/muted-foreground/)
    expect(cellOf('This shift').className).not.toMatch(/muted-foreground/)
  })
})

describe('the component has no opinion about the plan', () => {
  it('renders every figure state without throwing', () => {
    expect(() => render(<BudgetFindingDetails figures={{ ...fullFigures, projectedOverrun: unknown }} />)).not.toThrow()
    expect(() => render(<BudgetFindingDetails figures={{ ...fullFigures, available: notRecorded }} />)).not.toThrow()
    expect(() => render(<BudgetFindingDetails figures={{ ...fullFigures, shiftCost: unknown }} />)).not.toThrow()
  })
})
