import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShiftsUploadFields from './ShiftsUploadFields'

const base = { shape: null, onShape: vi.fn(), from: '2026-11-02', onFrom: vi.fn(), weeks: 12, onWeeks: vi.fn(), today: '2026-10-26' } as const

describe('ShiftsUploadFields', () => {
  it('offers both shapes unchosen, with no start or weeks until a pattern is chosen', async () => {
    const onShape = vi.fn()
    render(<ShiftsUploadFields {...base} onShape={onShape} />)
    expect(screen.getByRole('group', { name: "What's in your file?" })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Dated shifts/ })).not.toBeChecked()
    expect(screen.queryByLabelText('Starts from')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /A weekly pattern/ }))
    expect(onShape).toHaveBeenCalledWith('pattern')
  })

  it('a pattern shows the start limits and the span it makes', () => {
    render(<ShiftsUploadFields {...base} shape="pattern" />)
    const start = screen.getByLabelText('Starts from')
    expect(start).toHaveAttribute('min', '2026-10-26')
    expect(start).toHaveAttribute('max', '2026-11-23')
    expect(screen.getByText('Makes shifts from Mon 2 Nov to Sun 24 Jan.')).toBeInTheDocument()
  })

  it('dated shifts show the horizon line and no start fields', () => {
    render(<ShiftsUploadFields {...base} shape="dated" />)
    expect(screen.getByText("Rows dated before today or more than 12 weeks ahead (after Sun 17 Jan) can't be imported.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Starts from')).not.toBeInTheDocument()
  })
})
