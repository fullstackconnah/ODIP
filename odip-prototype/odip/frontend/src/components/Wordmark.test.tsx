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

  it('W1 without fold is unchanged: no glide or fold hooks, no positioning', () => {
    const { container } = render(<h1><Wordmark size={32} /></h1>)
    expect(screen.getByRole('heading', { level: 1, name: 'Bunya Support' })).toBeInTheDocument()
    const lettering = container.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(lettering.textContent).toBe('bunyasupport')
    expect(container.querySelector('[data-glide],[data-fold]')).toBeNull()
    expect(lettering.style.position).toBe('')
  })

  it('W2 fold marks the "b" as the glide target and the tail as the part that folds into it', () => {
    const { container } = render(<h1><Wordmark size={21} fold /></h1>)
    const b = screen.getByText('b', { exact: true })
    expect(b).toHaveAttribute('data-glide', 'brand-mark')
    expect(b.style.transformOrigin).toBe('0 0')
    const tail = container.querySelector('[data-fold="word"]') as HTMLElement
    expect(tail.textContent).toContain('unya')
    expect(tail.textContent).toContain('support')
    expect((container.querySelector('[aria-hidden="true"]') as HTMLElement).style.position).toBe('relative')
    expect(screen.getByRole('heading', { level: 1, name: 'Bunya Support' })).toBeInTheDocument()
  })
})
