import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToggleGroup } from './ToggleGroup'

const options = [
  { key: 'a', label: 'Option A' },
  { key: 'b', label: 'Option B' },
  { key: 'c', label: 'Option C' },
]

describe('ToggleGroup semantics', () => {
  it('exposes a radiogroup of radios, not a set of plain buttons — this is single-select-from-a-set', () => {
    render(<ToggleGroup options={options} value="a" onChange={vi.fn()} />)

    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
  })

  it('marks only the selected option aria-checked', () => {
    render(<ToggleGroup options={options} value="b" onChange={vi.fn()} />)

    expect(screen.getByRole('radio', { name: 'Option A' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Option B' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Option C' })).toHaveAttribute('aria-checked', 'false')
  })

  it('calls onChange with the clicked option key', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ToggleGroup options={options} value="a" onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: 'Option C' }))

    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('uses a roving tabindex: only the checked radio is a Tab stop', () => {
    render(<ToggleGroup options={options} value="b" onChange={vi.fn()} />)

    expect(screen.getByRole('radio', { name: 'Option A' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('radio', { name: 'Option B' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Option C' })).toHaveAttribute('tabindex', '-1')
  })

  it('moves selection with ArrowRight, per the native radio-group keyboard pattern', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ToggleGroup options={options} value="a" onChange={onChange} />)

    screen.getByRole('radio', { name: 'Option A' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('wraps from the last option back to the first with ArrowRight', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ToggleGroup options={options} value="c" onChange={onChange} />)

    screen.getByRole('radio', { name: 'Option C' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith('a')
  })
})
