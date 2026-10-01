import { useRef, useState, type RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDialogBehavior, type DialogBehaviorOptions } from './useDialogBehavior'

type LayerProps = Partial<Omit<DialogBehaviorOptions, 'containerRef' | 'initialFocusRef'>> & {
  name: string
  /** Render a button this ref points at and ask the hook to focus it first. */
  focusSecond?: boolean
  empty?: boolean
}

/** A bare dialog: two buttons (or none), wired to the hook the way Modal and SlideOver wire it. */
function Layer({ name, open = true, onClose = () => {}, empty, focusSecond, ...options }: LayerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const secondRef = useRef<HTMLButtonElement>(null)
  useDialogBehavior({ open, onClose, containerRef: ref, initialFocusRef: focusSecond ? (secondRef as RefObject<HTMLElement | null>) : undefined, ...options })
  if (!open) return null
  return (
    <div ref={ref} role="dialog" aria-label={name} tabIndex={-1}>
      {!empty && (
        <>
          <button>{name} first</button>
          <button ref={secondRef}>{name} second</button>
          <button>{name} last</button>
        </>
      )}
    </div>
  )
}

afterEach(() => {
  document.body.style.overflow = ''
})

describe('useDialogBehavior: Escape and the layer stack', () => {
  it('Escape calls onClose once', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Layer name="a" onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does nothing while closed, and stops listening once it is closed again', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<Layer name="a" open={false} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    rerender(<Layer name="a" open onClose={onClose} />)
    rerender(<Layer name="a" open={false} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape reaches only the topmost layer: the later-opened one', async () => {
    const user = userEvent.setup()
    const panel = vi.fn()
    const dialog = vi.fn()
    render(
      <>
        <Layer name="panel" onClose={panel} />
        <Layer name="dialog" onClose={dialog} />
      </>,
    )
    await user.keyboard('{Escape}')
    expect(dialog).toHaveBeenCalledTimes(1)
    expect(panel).not.toHaveBeenCalled()
  })

  it('once the top layer closes, the one beneath answers Escape again', async () => {
    const user = userEvent.setup()
    const panel = vi.fn()
    const dialog = vi.fn()
    const { rerender } = render(
      <>
        <Layer name="panel" onClose={panel} />
        <Layer name="dialog" onClose={dialog} />
      </>,
    )
    rerender(
      <>
        <Layer name="panel" onClose={panel} />
        <Layer name="dialog" open={false} onClose={dialog} />
      </>,
    )
    await user.keyboard('{Escape}')
    expect(panel).toHaveBeenCalledTimes(1)
    expect(dialog).not.toHaveBeenCalled()
  })

  it('the stack follows the order layers OPEN in, not the order they sit in the tree', async () => {
    const user = userEvent.setup()
    const early = vi.fn()
    const late = vi.fn()
    // `late` is declared first in the tree but opens second.
    const { rerender } = render(
      <>
        <Layer name="late" open={false} onClose={late} />
        <Layer name="early" onClose={early} />
      </>,
    )
    rerender(
      <>
        <Layer name="late" open onClose={late} />
        <Layer name="early" onClose={early} />
      </>,
    )
    await user.keyboard('{Escape}')
    expect(late).toHaveBeenCalledTimes(1)
    expect(early).not.toHaveBeenCalled()
  })

  it('a top layer with closeOnEscape=false swallows Escape: the layer beneath does not close either', async () => {
    const user = userEvent.setup()
    const panel = vi.fn()
    const locked = vi.fn()
    render(
      <>
        <Layer name="panel" onClose={panel} />
        <Layer name="locked" closeOnEscape={false} onClose={locked} />
      </>,
    )
    await user.keyboard('{Escape}')
    expect(locked).not.toHaveBeenCalled()
    expect(panel).not.toHaveBeenCalled()
  })

  it('ignores an Escape that an inner widget already used (preventDefault), and answers the next one', () => {
    const onClose = vi.fn()
    render(<Layer name="a" onClose={onClose} />)
    // An open Dropdown list closes on Escape and calls preventDefault: that keypress was meant for the list.
    const used = (event: Event) => event.preventDefault()
    document.body.addEventListener('keydown', used, { once: true })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls the LATEST onClose without re-registering', async () => {
    const user = userEvent.setup()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Layer name="a" onClose={first} />)
    rerender(<Layer name="a" onClose={second} />)
    await user.keyboard('{Escape}')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('a re-render of the lower layer does not lift it above the layer opened after it', async () => {
    const user = userEvent.setup()
    const panel = vi.fn()
    const dialog = vi.fn()
    const { rerender } = render(
      <>
        <Layer name="panel" onClose={panel} />
        <Layer name="dialog" onClose={dialog} />
      </>,
    )
    rerender(
      <>
        <Layer name="panel" onClose={() => panel()} />
        <Layer name="dialog" onClose={dialog} />
      </>,
    )
    await user.keyboard('{Escape}')
    expect(dialog).toHaveBeenCalledTimes(1)
    expect(panel).not.toHaveBeenCalled()
  })
})

describe('useDialogBehavior: the Tab trap (userEvent.tab)', () => {
  function Page() {
    return (
      <>
        <button>outside before</button>
        <Layer name="a" />
        <button>outside after</button>
      </>
    )
  }

  it('moves focus in on open: the first focusable element', () => {
    render(<Page />)
    expect(screen.getByRole('button', { name: 'a first' })).toHaveFocus()
  })

  it('Tab walks the layer and wraps from the last element to the first', async () => {
    const user = userEvent.setup()
    render(<Page />)
    await user.tab()
    expect(screen.getByRole('button', { name: 'a second' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'a last' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'a first' })).toHaveFocus()
  })

  it('Shift+Tab wraps from the first element to the last', async () => {
    const user = userEvent.setup()
    render(<Page />)
    expect(screen.getByRole('button', { name: 'a first' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'a last' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'a second' })).toHaveFocus()
  })

  it('focus never leaves the layer however many times Tab is pressed', async () => {
    const user = userEvent.setup()
    render(<Page />)
    for (let i = 0; i < 8; i++) {
      await user.tab()
      expect(screen.getByRole('dialog', { name: 'a' })).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('pulls focus back in when it has strayed outside (Tab goes to the first element, Shift+Tab to the last)', async () => {
    const user = userEvent.setup()
    render(<Page />)
    act(() => screen.getByRole('button', { name: 'outside after' }).focus())
    await user.tab()
    expect(screen.getByRole('button', { name: 'a first' })).toHaveFocus()
    act(() => screen.getByRole('button', { name: 'outside before' }).focus())
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'a last' })).toHaveFocus()
  })

  it('only the topmost layer traps: Tab inside a dialog opened over a panel stays in the dialog', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Layer name="panel" />
        <Layer name="dialog" />
      </>,
    )
    expect(screen.getByRole('button', { name: 'dialog first' })).toHaveFocus()
    for (let i = 0; i < 5; i++) {
      await user.tab()
      expect(screen.getByRole('dialog', { name: 'dialog' })).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('a layer with nothing focusable keeps focus on itself', async () => {
    const user = userEvent.setup()
    render(<Layer name="a" empty />)
    expect(screen.getByRole('dialog', { name: 'a' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('dialog', { name: 'a' })).toHaveFocus()
  })

  it('skips controls that cannot take focus: a hidden input and anything in a disabled fieldset', async () => {
    const user = userEvent.setup()
    function WithDeadEnds() {
      const ref = useRef<HTMLDivElement>(null)
      useDialogBehavior({ open: true, onClose: () => {}, containerRef: ref })
      return (
        <div ref={ref} role="dialog" aria-label="dead ends" tabIndex={-1}>
          <button>first</button>
          <button>last</button>
          <input type="hidden" name="h" />
          <fieldset disabled>
            <input aria-label="disabled in fieldset" />
          </fieldset>
        </div>
      )
    }
    render(<WithDeadEnds />)
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus()
    // `last` is the real last stop even though a hidden input and a fieldset-disabled input come after it in the DOM.
    await user.tab()
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus()
  })
})

describe('useDialogBehavior: focus in and back', () => {
  function Opener() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>open</button>
        <Layer name="a" open={open} onClose={() => setOpen(false)} />
      </>
    )
  }

  it('returns focus to the element that had it when the layer opened', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    expect(screen.getByRole('button', { name: 'a first' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'open' })).toHaveFocus()
  })

  it('returns focus when the layer unmounts instead of switching open off (the roster panels remount on a key change)', async () => {
    const user = userEvent.setup()
    function Remounting() {
      const [on, setOn] = useState(false)
      return (
        <>
          <button onClick={() => setOn(true)}>open</button>
          {on && <Layer name="a" onClose={() => setOn(false)} />}
        </>
      )
    }
    render(<Remounting />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'open' })).toHaveFocus()
  })

  it('focuses initialFocusRef instead of the first element', () => {
    render(<Layer name="a" focusSecond />)
    expect(screen.getByRole('button', { name: 'a second' })).toHaveFocus()
  })

  it('leaves focus alone on close with returnFocus=false', async () => {
    const user = userEvent.setup()
    function NoReturn() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          <Layer name="a" open={open} returnFocus={false} onClose={() => setOpen(false)} />
        </>
      )
    }
    render(<NoReturn />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'open' })).not.toHaveFocus()
  })

  it('a dialog opened from inside a panel hands focus back to the control in the panel, and the panel keeps it', async () => {
    const user = userEvent.setup()
    function PanelWithDialog() {
      const [asking, setAsking] = useState(false)
      const panelRef = useRef<HTMLDivElement>(null)
      useDialogBehavior({ open: true, onClose: () => {}, containerRef: panelRef })
      return (
        <>
          <div ref={panelRef} role="dialog" aria-label="panel" tabIndex={-1}>
            <button>panel first</button>
            <button onClick={() => setAsking(true)}>Delete</button>
          </div>
          <Layer name="confirm" open={asking} onClose={() => setAsking(false)} />
        </>
      )
    }
    render(<PanelWithDialog />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('button', { name: 'confirm first' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'confirm' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'panel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
  })

  it('does not throw when the opener has gone from the page by the time the layer closes', async () => {
    const user = userEvent.setup()
    function OpenerGoes() {
      const [state, setState] = useState<'idle' | 'open' | 'gone'>('idle')
      return (
        <>
          {state !== 'gone' && <button onClick={() => setState('open')}>open</button>}
          <Layer name="a" open={state === 'open'} onClose={() => setState('gone')} />
        </>
      )
    }
    render(<OpenerGoes />)
    await user.click(screen.getByRole('button', { name: 'open' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'open' })).not.toBeInTheDocument()
  })
})

describe('useDialogBehavior: scroll lock', () => {
  it('locks page scroll while open and restores what was there before', () => {
    document.body.style.overflow = 'scroll'
    const { rerender } = render(<Layer name="a" />)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Layer name="a" open={false} />)
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('stays locked until the LAST layer closes', () => {
    const { rerender } = render(
      <>
        <Layer name="panel" />
        <Layer name="dialog" />
      </>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    rerender(
      <>
        <Layer name="panel" />
        <Layer name="dialog" open={false} />
      </>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    rerender(
      <>
        <Layer name="panel" open={false} />
        <Layer name="dialog" open={false} />
      </>,
    )
    expect(document.body.style.overflow).toBe('')
  })

  it('stays locked when the layer that opened first closes first', () => {
    const { rerender } = render(
      <>
        <Layer name="panel" />
        <Layer name="dialog" />
      </>,
    )
    rerender(
      <>
        <Layer name="panel" open={false} />
        <Layer name="dialog" />
      </>,
    )
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('unlocks when a layer unmounts while open', () => {
    const { unmount } = render(<Layer name="a" />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('does not lock with lockScroll=false', () => {
    render(<Layer name="a" lockScroll={false} />)
    expect(document.body.style.overflow).toBe('')
  })

  it('a layer that does not lock does not unlock the one that does', () => {
    const { rerender } = render(
      <>
        <Layer name="panel" />
        <Layer name="tooltip" lockScroll={false} />
      </>,
    )
    rerender(
      <>
        <Layer name="panel" />
        <Layer name="tooltip" lockScroll={false} open={false} />
      </>,
    )
    expect(document.body.style.overflow).toBe('hidden')
  })
})

describe('useDialogBehavior: teardown', () => {
  it('stops answering Escape after unmount', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { unmount } = render(<Layer name="a" onClose={onClose} />)
    unmount()
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('removes its document listener once the last layer is gone', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(
      <>
        <Layer name="panel" />
        <Layer name="dialog" />
      </>,
    )
    // One shared listener for the whole stack, not one per layer.
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1)
    unmount()
    expect(remove.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1)
    add.mockRestore()
    remove.mockRestore()
  })
})
