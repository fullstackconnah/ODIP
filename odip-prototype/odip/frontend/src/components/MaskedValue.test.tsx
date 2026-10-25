import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MaskedValue } from './MaskedValue'

describe('MaskedValue', () => {
  it('hides the bullets from assistive tech and speaks the last character', () => {
    const { container } = render(<MaskedValue value="••••••••7" />)
    expect(screen.getByText('••••••••7')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Hidden, ends in 7')).toHaveClass('sr-only')
    expect(container).toHaveTextContent('••••••••7Hidden, ends in 7')
  })

  it('says only "Hidden" when the value is bullets only', () => {
    render(<MaskedValue value="••••••••" />)
    expect(screen.getByText('Hidden')).toHaveClass('sr-only')
  })

  it('renders an unmasked value unchanged', () => {
    const { container } = render(<MaskedValue value="430123456" />)
    expect(container.innerHTML).toBe('430123456')
  })

  it('renders an empty value as nothing', () => {
    const { container } = render(<MaskedValue value="" />)
    expect(container.innerHTML).toBe('')
  })

  it('swaps only the bullet run in a composite string', () => {
    const { container } = render(<MaskedValue value="••••••••5 (expires 01/02/2027)" />)
    expect(screen.getByText('Hidden, ends in 5')).toBeInTheDocument()
    expect(container).toHaveTextContent('(expires 01/02/2027)')
  })
})
