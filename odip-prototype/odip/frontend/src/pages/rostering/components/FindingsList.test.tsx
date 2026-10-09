import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { FindingsList } from './FindingsList'
import { makeFinding } from '../test-fixtures'
import { forecastOverWithFigures } from './parallel-budget-override/fixtures'

// FindingsList, as the budget phase 3 design review changed it: two pools past their funding are two findings with ONE code (L7), and the warning triangle is not drawn in the amber fill (L1).

afterEach(() => cleanup())

describe('two findings with one code (L7)', () => {
  it('lists both, with no duplicate-key warning from React', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const second = { ...forecastOverWithFigures, message: 'Takes Daily Activities to $2,000.00 of $1,500.00.', budget: { ...forecastOverWithFigures.budget!, poolName: 'Daily Activities' } }

    render(<FindingsList findings={[{ ...forecastOverWithFigures, severity: 'Warning' }, { ...second, severity: 'Warning' }]} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/)
    error.mockRestore()
  })

  it('still lists findings that carry no figures, each once', () => {
    render(<FindingsList findings={[makeFinding({ code: 'A', message: 'First' }), makeFinding({ code: 'B', message: 'Second' })]} />)

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })
})

describe('a Blocking finding another control has answered (design review L5)', () => {
  const refusal = { ...forecastOverWithFigures, severity: 'Blocking' as const, message: 'Takes Core (flexible) to $8,640.00 of $8,000.00.' }

  it('reads as answered, in the warning wash with its label, and no longer as a standing red refusal', () => {
    render(<FindingsList findings={[refusal]} answered={{ codes: ['BUDGET_FORECAST_OVER'], label: 'Booking as an emergency' }} />)

    const row = screen.getByText(refusal.message).closest('li')!
    expect(row.className).toContain('--color-warning-container')
    expect(row.className).not.toContain('error-container')
    expect(row).toHaveTextContent('Booking as an emergency')
  })

  it('puts the label under the sentence, not beside it: beside it the sentence was squeezed into a narrow column on a phone', () => {
    render(<FindingsList findings={[refusal]} answered={{ codes: ['BUDGET_FORECAST_OVER'], label: 'Booking as an emergency' }} />)

    const sentence = screen.getByText(refusal.message)
    const label = screen.getByText('Booking as an emergency')
    expect(label.parentElement).toBe(sentence.parentElement)
    expect(sentence.parentElement).toHaveClass('flex-col')
    expect(sentence.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('leaves a Blocking finding the control did not answer as it was', () => {
    render(<FindingsList findings={[refusal, makeFinding({ code: 'WSC_EXPIRED', severity: 'Blocking', message: 'Screening has expired' })]} answered={{ codes: ['BUDGET_FORECAST_OVER'], label: 'Booking as an emergency' }} />)

    expect(screen.getByText('Screening has expired').closest('li')!.className).toContain('error-container')
  })
})

describe('the warning triangle (L1)', () => {
  it('is drawn in the warning ink, not the amber fill: the fill is 1.9:1 on the box', () => {
    render(<FindingsList findings={[makeFinding({ message: 'Needs a look' })]} />)

    const icon = screen.getByText('Needs a look').parentElement!.querySelector('svg')!
    expect(icon.getAttribute('class')).toMatch(/on-warning-container/)
    expect(icon.getAttribute('class')).not.toMatch(/text-\[var\(--color-warning\)\]/)
  })
})
