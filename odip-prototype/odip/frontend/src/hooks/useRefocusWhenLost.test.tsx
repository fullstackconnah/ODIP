import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRefocusWhenLost } from './useRefocusWhenLost'

// A create form becomes its "done" view: the focused Create button unmounts and focus falls to the page body. The hook puts it back on the
// view's heading, but only when it was LOST: a control that still holds focus keeps it.

function Harness({ inDialog = false }: { inDialog?: boolean }) {
  const [view, setView] = useState<'form' | 'done'>('form')
  const [round, setRound] = useState(0)
  const heading = useRef<HTMLParagraphElement>(null)
  useRefocusWhenLost(heading, `${view}-${round}`)

  const content = view === 'form' ? (
    <button type="button" onClick={() => setView('done')}>Create</button>
  ) : (
    <>
      <p ref={heading} tabIndex={-1}>It was created.</p>
      <button type="button" onClick={() => setRound(r => r + 1)}>Send again (stays)</button>
    </>
  )
  return (
    <>
      <button type="button">Outside</button>
      {inDialog ? <div role="dialog" aria-label="Panel" tabIndex={-1}><button type="button">Close</button>{content}</div> : content}
    </>
  )
}

describe('useRefocusWhenLost', () => {
  it('moves focus to the target after a change that unmounted the focused control', async () => {
    const u = userEvent.setup()
    render(<Harness />)

    await u.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByText('It was created.')).toHaveFocus()
  })

  it('does the same inside a dialog', async () => {
    const u = userEvent.setup()
    render(<Harness inDialog />)

    await u.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByText('It was created.')).toHaveFocus()
  })

  it('leaves focus alone when a control that still exists has it', async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await u.click(screen.getByRole('button', { name: 'Create' }))

    // The change below does not remove the button that was clicked, so focus has not been lost.
    await u.click(screen.getByRole('button', { name: 'Send again (stays)' }))

    expect(screen.getByRole('button', { name: 'Send again (stays)' })).toHaveFocus()
  })

  it('does nothing while there is no target (the form view), so it never steals focus from the form', async () => {
    const u = userEvent.setup()
    render(<Harness />)

    await u.click(screen.getByRole('button', { name: 'Outside' }))

    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus()
  })
})
