import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToggleGroup } from './ToggleGroup'

const options = [
  { key: 'a', label: 'Option A' },
  { key: 'b', label: 'Option B' },
  { key: 'c', label: 'Option C' },
]

describe('ToggleGroup description', () => {
  it('points the radiogroup at the element that explains the choice', () => {
    render(
      <>
        <ToggleGroup options={options} value="a" onChange={vi.fn()} ariaLabel="Mode" ariaDescribedby="what-each-does" />
        <p id="what-each-does">A does this and B does that.</p>
      </>,
    )

    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toHaveAccessibleDescription('A does this and B does that.')
  })

  it('has no description when none is given', () => {
    render(<ToggleGroup options={options} value="a" onChange={vi.fn()} ariaLabel="Mode" />)

    expect(screen.getByRole('radiogroup', { name: 'Mode' })).not.toHaveAttribute('aria-describedby')
  })
})

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

describe('ToggleGroup disabled', () => {
  it('locks every radio and marks the group aria-disabled, while the selected option still reads as selected', () => {
    render(<ToggleGroup options={options} value="b" onChange={vi.fn()} disabled ariaLabel="Mode" />)

    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toHaveAttribute('aria-disabled', 'true')
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Option B' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Option A' })).toHaveAttribute('aria-checked', 'false')
  })

  it('never calls onChange for a click or an arrow key', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ToggleGroup options={options} value="a" onChange={onChange} disabled />)

    await user.click(screen.getByRole('radio', { name: 'Option C' }))
    screen.getByRole('radio', { name: 'Option A' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows it: a not-allowed cursor and a dimmed group, with no hover fill on the unselected options', () => {
    render(<ToggleGroup options={options} value="a" onChange={vi.fn()} disabled />)

    const unselected = screen.getByRole('radio', { name: 'Option B' })
    expect(unselected).toHaveClass('cursor-not-allowed', 'opacity-60')
    expect(unselected.className).not.toMatch(/hover:bg-/)
  })

  it('is untouched when not disabled: enabled radios, no aria-disabled, the usual hover fill', () => {
    render(<ToggleGroup options={options} value="a" onChange={vi.fn()} />)

    expect(screen.getByRole('radiogroup')).not.toHaveAttribute('aria-disabled')
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Option B' })).toHaveClass('hover:bg-[var(--color-accent)]')
    expect(screen.getByRole('radio', { name: 'Option B' }).className).not.toMatch(/cursor-not-allowed|opacity-60/)
  })
})
