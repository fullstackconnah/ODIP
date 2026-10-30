import { describe, it, expect } from 'vitest'
import { render, within } from '@testing-library/react'
import { Fold, Section, WaitingToSend } from './ui'

// jsdom applies no CSS, so the open-state swap is pinned as the classes that do it.
const labels = (root: HTMLElement) => ({ show: within(root).getByText('Show'), hide: within(root).getByText('Hide') })

describe('Fold — the label follows the open state', () => {
  it('shows Show closed and Hide open through its own named group', () => {
    const { container } = render(<Fold summary="Done">row</Fold>)
    const details = container.querySelector('details')!
    expect(details).toHaveClass('group/fold')
    const { show, hide } = labels(container)
    expect(show).toHaveClass('group-open/fold:hidden')
    expect(hide).toHaveClass('hidden', 'group-open/fold:inline')
  })
})

describe('Section collapse — the label follows the open state', () => {
  it('shows Show closed and Hide open through its own named group', () => {
    const { container } = render(<Section title="Before" collapse={{ summary: 'All done' }}>body</Section>)
    expect(container.querySelector('details')).toHaveClass('group/section')
    const { show, hide } = labels(container)
    expect(show).toHaveClass('group-open/section:hidden')
    expect(hide).toHaveClass('hidden', 'group-open/section:inline')
  })

  it('leaves a Fold inside it on a different group name, so an open Section cannot flip a closed Fold', () => {
    const { container } = render(<Section title="Before" collapse={{ summary: 'All done' }}><Fold summary="Later">row</Fold></Section>)
    const [section, fold] = Array.from(container.querySelectorAll('details'))
    expect(section).toHaveClass('group/section')
    expect(fold).toHaveClass('group/fold')
    expect(fold).not.toHaveClass('group/section')
    expect(fold.querySelector('summary')!.innerHTML).not.toContain('group-open/section')
  })
})

describe('WaitingToSend', () => {
  it('reads Waiting to send, or Still trying when stuck, with the same icon', () => {
    const a = render(<WaitingToSend />)
    expect(a.container).toHaveTextContent('Waiting to send')
    const b = render(<WaitingToSend stuck />)
    expect(b.container).toHaveTextContent('Still trying')
    expect(b.container.querySelector('svg')).toBeTruthy()
  })
})
