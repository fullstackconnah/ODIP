import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal'
import { ConfirmDialog } from './ConfirmDialog'
import { TAP_AREA } from './tapArea'

describe('Modal closeOnBackdrop', () => {
  it('closes on a backdrop click by default', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Example">
        <p>Body</p>
      </Modal>,
    )

    // The backdrop is the outer fixed-position element wrapping the dialog.
    await user.click(screen.getByRole('dialog').parentElement!)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on a backdrop click when closeOnBackdrop is false', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Example" closeOnBackdrop={false}>
        <p>Body</p>
      </Modal>,
    )

    await user.click(screen.getByRole('dialog').parentElement!)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('still closes via the header close button when closeOnBackdrop is false', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Example" closeOnBackdrop={false}>
        <p>Body</p>
      </Modal>,
    )

    await user.click(screen.getByRole('button'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Modal inside a form', () => {
  it('its close button is type="button", so closing the dialog never submits an enclosing form', async () => {
    // The dialog renders inline, so one opened from inside a <form> (the Profile wizard's embedded Contacts
    // editor) sits in that form's DOM. An untyped <button> is a submit button there.
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Modal open onClose={onClose} title="Example"><p>Body</p></Modal>
      </form>,
    )

    const close = within(screen.getByRole('dialog')).getAllByRole('button')[0]
    expect(close).toHaveAttribute('type', 'button')
    await user.click(close)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

// Modal's behaviour (Escape, Tab trap, scroll lock, focus in and back) lives in useDialogBehavior, which has its own tests;
// these pin that Modal still delivers each of them, and the one visible-surface change that came with the refactor.
describe('Modal behaviour', () => {
  afterEach(() => {
    document.body.style.overflow = ''
  })

  function WithOpener({ closeOnBackdrop = true }: { closeOnBackdrop?: boolean }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open it</button>
        <Modal open={open} onClose={() => setOpen(false)} title="Example" closeOnBackdrop={closeOnBackdrop} footer={<button>Save</button>}>
          <input aria-label="Name" />
        </Modal>
      </>
    )
  }

  it('Escape closes it, even when closeOnBackdrop is false', async () => {
    const user = userEvent.setup()
    render(<WithOpener closeOnBackdrop={false} />)
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('moves focus in on open and returns it to the opener on close', async () => {
    const user = userEvent.setup()
    render(<WithOpener />)
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    expect(within(screen.getByRole('dialog')).getAllByRole('button')[0]).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Open it' })).toHaveFocus()
  })

  it('traps Tab: the close button, the field and the footer button, then round again; Shift+Tab goes the other way', async () => {
    const user = userEvent.setup()
    render(<WithOpener />)
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
  })

  it('locks page scroll while open and releases it on close', async () => {
    const user = userEvent.setup()
    render(<WithOpener />)
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    expect(document.body.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('')
  })

  it('a ConfirmDialog opened over another Modal answers Escape alone: the Modal underneath stays open and gets its focus back', async () => {
    const user = userEvent.setup()
    function Stacked() {
      const [asking, setAsking] = useState(false)
      const [open, setOpen] = useState(true)
      return (
        <>
          <Modal open={open} onClose={() => setOpen(false)} title="Edit" footer={<button onClick={() => setAsking(true)}>Delete</button>}>
            <p>Body</p>
          </Modal>
          <ConfirmDialog open={asking} onCancel={() => setAsking(false)} onConfirm={() => setAsking(false)} title="Delete it?" message="Sure?" />
        </>
      )
    }
    render(<Stacked />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
    // scroll stays locked for the Modal that is still open
    expect(document.body.style.overflow).toBe('hidden')
  })
})

// ── The sticky footer ────────────────────────────────────────────────────────────────────────────
// jsdom has no layout, so this pins the classes a real browser needs. A sticky box sticks to the scroll container's content box: with the
// dialog's own bottom padding left on, the footer floated 16px above the edge, the last line of the body touched it, and the body showed
// through the strip underneath (seen in the round 1 screenshots).
describe('Modal sticky footer', () => {
  it('keeps the footer in view as a sticky strip and takes the dialog\'s bottom padding away, so the strip sits on the edge', () => {
    render(<Modal open onClose={() => {}} title="Example" footer={<button type="button">Approve</button>} stickyFooter><p>Body</p></Modal>)

    const strip = screen.getByRole('button', { name: 'Approve' }).parentElement!
    expect(strip).toHaveClass('sticky', 'bottom-0', '-mx-4', 'mt-4', 'border-t')
    // Not pulled out of the bottom padding: that is what lifted it off the edge.
    expect(strip.className).not.toMatch(/-mb-/)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('px-4', 'pt-4')
    expect(dialog.className).not.toMatch(/(^|\s)p-4(\s|$)/)
    expect(dialog.className).not.toMatch(/(^|\s)pb-/)
  })

  it('leaves an ordinary footer, and a dialog with nothing in its footer, exactly as they were', () => {
    const { unmount } = render(<Modal open onClose={() => {}} title="Example" footer={<button type="button">OK</button>}><p>Body</p></Modal>)
    expect(screen.getByRole('button', { name: 'OK' }).parentElement).not.toHaveClass('sticky')
    expect(screen.getByRole('dialog')).toHaveClass('p-4')
    unmount()

    render(<Modal open onClose={() => {}} title="Example" stickyFooter><p>Body</p></Modal>)
    expect(screen.getByRole('dialog')).toHaveClass('p-4')
  })
})

describe('Modal close button (R1-07)', () => {
  it('has an accessible name', () => {
    render(<Modal open onClose={() => {}} title="Example"><p>Body</p></Modal>)
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close dialog' })).toBeInTheDocument()
  })

  it('carries the TAP_AREA hit area: 44px on touch, and the 28px box (p-1 around the 20px glyph) is unchanged', () => {
    render(<Modal open onClose={() => {}} title="Example"><p>Body</p></Modal>)
    const close = screen.getByRole('button', { name: 'Close dialog' })
    expect(close).toHaveClass(...TAP_AREA.split(' '))
    expect(close).toHaveClass('p-1', 'rounded-lg')
    expect(close.querySelector('svg')).toHaveClass('w-5', 'h-5')
  })
})
