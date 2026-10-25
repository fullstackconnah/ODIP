import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Wordmark } from './Wordmark'

describe('Wordmark', () => {
  it('is named "Bunya Support" for assistive tech, while the lowercase lettering is hidden from it', () => {
    render(<h1><Wordmark size={32} /></h1>)
    expect(screen.getByRole('heading', { level: 1, name: 'Bunya Support' })).toBeInTheDocument()
    expect(screen.getByText('support').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('sets "support" in primary olive on light, and lime on dark', () => {
    const { rerender } = render(<Wordmark size={21} />)
    expect(screen.getByText('support').getAttribute('style')).toContain('color: var(--color-primary)')
    rerender(<Wordmark size={21} tone="dark" />)
    expect(screen.getByText('support').getAttribute('style')).toContain('color: var(--color-primary-fixed)')
  })

  it('fills the light dot from --wordmark-dot (a solid disc in dark), and the dark tone from primary-fixed', () => {
    const { container, rerender } = render(<Wordmark size={21} />)
    expect(container.querySelector('circle')!.getAttribute('style')).toContain('fill: var(--wordmark-dot)')
    rerender(<Wordmark size={21} tone="dark" />)
    expect(container.querySelector('circle')!.getAttribute('style')).toContain('fill: var(--color-primary-fixed)')
  })
})
