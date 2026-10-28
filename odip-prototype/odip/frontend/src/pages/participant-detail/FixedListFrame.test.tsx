import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FixedListFrame } from './FixedListFrame'

type Row = { id: string; done: boolean }

function frame(rows: Row[], canAdd: boolean) {
  return render(
    <FixedListFrame title="Daily living" rows={rows} isAnswered={r => r.done} unit="not assessed" addLabel="Add an assessment" canAdd={canAdd} rowSelector="[data-row]">
      {visible => <ul>{visible.map(r => <li key={r.id} data-row>{r.id}</li>)}<li>{visible.length === 0 ? 'empty table' : ''}</li></ul>}
    </FixedListFrame>,
  )
}

describe('FixedListFrame — zero rows is the same as zero answered', () => {
  it('gives a viewer the one plain line, no table and no button', () => {
    frame([], false)
    expect(screen.getByText('Not recorded: Daily living')).toBeInTheDocument()
    expect(screen.queryByText('empty table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('gives an editor the same plain line: with no rows there is nothing to add to, so no fold', () => {
    const { container } = frame([], true)
    expect(screen.getByText('Not recorded: Daily living')).toBeInTheDocument()
    expect(container.querySelector('details')).toBeNull()
    expect(screen.queryByText('empty table')).not.toBeInTheDocument()
  })

  it('gives an editor the fold when rows exist but none are answered', () => {
    const { container } = frame([{ id: 'a', done: false }, { id: 'b', done: false }], true)
    const fold = container.querySelector('details')!
    expect(fold).toHaveTextContent('Not recorded: Daily living')
    expect(fold).toHaveTextContent('a')
    expect(fold).toHaveAttribute('open')
    expect(fold).toHaveAttribute('data-fold-static')
  })

  it('lets the editor close the fold that opened by itself', async () => {
    const { container } = frame([{ id: 'a', done: false }], true)
    const fold = container.querySelector('details')!
    await userEvent.click(screen.getByText('Not recorded: Daily living'))
    expect(fold).not.toHaveAttribute('open')
  })

  it('still shows the answered rows, the count and the reveal button when some are answered', () => {
    frame([{ id: 'a', done: true }, { id: 'b', done: false }], true)
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.queryByText('b')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 2 not assessed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add an assessment' })).toBeInTheDocument()
  })
})
