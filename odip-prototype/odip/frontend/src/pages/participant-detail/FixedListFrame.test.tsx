import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  it('gives an editor the fold, holding what the section renders for no rows and no count line', () => {
    const { container } = frame([], true)
    const fold = container.querySelector('details')!
    expect(fold).toHaveTextContent('Not recorded: Daily living')
    expect(fold).toHaveTextContent('empty table')
    expect(fold).not.toHaveTextContent(/of 0/)
  })

  it('still shows the answered rows, the count and the reveal button when some are answered', () => {
    frame([{ id: 'a', done: true }, { id: 'b', done: false }], true)
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.queryByText('b')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 2 not assessed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add an assessment' })).toBeInTheDocument()
  })
})
