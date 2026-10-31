import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ChartTable } from './ChartTable'

describe('ChartTable', () => {
  it('has a caption, column headers and a row header for each row', () => {
    render(<ChartTable caption="Figures" columns={['Week of', 'Shifts']} rows={[{ header: '3 Nov', cells: ['4'] }, { header: '10 Nov', cells: ['none'] }]} />)
    const table = screen.getByRole('table')
    expect(within(table).getByText('Figures').tagName).toBe('CAPTION')
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Week of', 'Shifts'])
    expect(within(table).getAllByRole('rowheader').map(h => h.textContent)).toEqual(['3 Nov', '10 Nov'])
    expect(within(table).getByRole('cell', { name: 'none' })).toBeTruthy()
  })
  // A table ignores sr-only's 1px width (its content sets a 583px minimum), which widened the 390 layout; a clipping wrapper does not.
  it('is hidden by a clipping wrapper, not by styling the table itself', () => {
    render(<ChartTable caption="Figures" columns={['Week of']} rows={[{ header: '3 Nov', cells: [] }]} />)
    const table = screen.getByRole('table')
    expect(table.className).not.toContain('sr-only')
    expect(table.parentElement?.className).toContain('sr-only')
  })
})
