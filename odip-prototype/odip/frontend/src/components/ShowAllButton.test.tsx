import { describe, it, expect } from 'vitest'
import { useRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useShowAll } from './ShowAllButton'

function List({ count }: { count: number }) {
  const ref = useRef<HTMLUListElement>(null)
  const { limit, button } = useShowAll(count, ref, '[data-row]')
  return (
    <div>
      <ul ref={ref}>
        {Array.from({ length: Math.min(limit, count) }, (_, i) => <li key={i} data-row tabIndex={-1}>Row {i + 1}</li>)}
      </ul>
      {button}
    </div>
  )
}

describe('useShowAll', () => {
  it('shows no button at 5 rows', () => {
    render(<List count={5} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('offers Show all 6 at 6 rows', () => {
    render(<List count={6} />)
    expect(screen.getByRole('button', { name: 'Show all 6' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('expands to every row, focuses row 6, then collapses and keeps focus on the button', async () => {
    render(<List count={23} />)
    const button = screen.getByRole('button', { name: 'Show all 23' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(button)
    expect(screen.getAllByRole('listitem')).toHaveLength(23)
    expect(screen.getByText('Row 6')).toHaveFocus()
    const fewer = screen.getByRole('button', { name: 'Show fewer' })
    expect(fewer).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(fewer)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Show all 23' })).toHaveFocus()
  })

  it('resets to collapsed when the list drops under 6 rows', async () => {
    const { rerender } = render(<List count={9} />)
    await userEvent.click(screen.getByRole('button', { name: 'Show all 9' }))
    rerender(<List count={4} />)
    rerender(<List count={9} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })
})
