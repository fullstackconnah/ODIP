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
})
