import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SearchInput } from './SearchInput'

describe('SearchInput', () => {
  it('is a field: the shared field surface with room for the icon, and no grey input slab', () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="Find a trip" />)
    const input = screen.getByRole('textbox', { name: 'Find a trip' })
    expect(input).toHaveClass('bg-[var(--color-field)]', 'border-[var(--color-field-border)]', 'pl-10', 'h-[var(--control-h)]')
    expect(input.className).not.toContain('--color-input')
  })
})
