import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NumberField } from './NumberField'

function Harness({ onBadInput }: { onBadInput: (bad: boolean) => void }) {
  const [value, setValue] = useState(Number.NaN)
  return <NumberField label="Minutes" value={value} onChange={setValue} onBadInput={onBadInput} />
}

describe('NumberField onBadInput', () => {
  // Typing "e" into an empty number box leaves its value "", so React fires no change; only `input` reports it.
  it('reports a bad entry typed into an empty box, and clears it when the box is emptied', () => {
    const onBadInput = vi.fn()
    render(<Harness onBadInput={onBadInput} />)
    const box = screen.getByLabelText('Minutes')
    Object.defineProperty(box, 'validity', { value: { badInput: true }, configurable: true })
    fireEvent.input(box)
    expect(onBadInput).toHaveBeenLastCalledWith(true)
    Object.defineProperty(box, 'validity', { value: { badInput: false }, configurable: true })
    fireEvent.input(box)
    expect(onBadInput).toHaveBeenLastCalledWith(false)
  })
})
