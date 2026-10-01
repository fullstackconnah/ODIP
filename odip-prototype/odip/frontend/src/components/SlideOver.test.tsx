import { useRef, useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SlideOver, type SlideOverProps } from './SlideOver'
import { ConfirmDialog } from './ConfirmDialog'
import { TAP_AREA } from './tapArea'

afterEach(() => {
  document.body.style.overflow = ''
})

function Panel(props: Partial<SlideOverProps> & { onClose?: () => void }) {
  return (
    <SlideOver open title="Edit pattern" onClose={() => {}} {...props}>
      <label>
        Notes
        <input />
      </label>
    </SlideOver>
  )
}

describe('SlideOver semantics', () => {
  it('is a modal dialog named by its title', () => {
    render(<Panel />)
    const dialog = screen.getByRole('dialog', { name: 'Edit pattern' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.getAttribute('aria-labelledby')).toBe(screen.getByRole('heading', { level: 2, name: 'Edit pattern' }).id)
    expect(dialog).not.toHaveAttribute('aria-describedby')
  })

  it('wires a description as the dialog description', () => {
    render(<Panel description="Repeats every Monday." />)
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Repeats every Monday.')
  })

  it('renders nothing while closed', () => {
    render(<Panel open={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps the geometry of the panels it replaced: right edge, full height from lg, max-w-md or max-w-lg, z-50 over a z-40 scrim', () => {
    const { rerender, container } = render(<Panel />)
    const panel = screen.getByRole('dialog')
    // h-full from lg; below it the panel stops above the fixed bottom nav (see the layers note in SlideOver.tsx)
    expect(panel).toHaveClass('fixed', 'right-0', 'top-0', 'z-50', 'lg:h-full', 'h-[calc(100%-var(--mobile-nav-h))]', 'w-full', 'max-w-md', 'flex', 'flex-col', 'overflow-hidden', 'border-l', 'shadow-xl')
    const scrim = panel.previousElementSibling as HTMLElement
    expect(scrim).toHaveClass('fixed', 'inset-0', 'z-40', 'bg-black/40')
    expect(container.firstElementChild).toBe(scrim)
    rerender(<Panel size="lg" />)
    expect(screen.getByRole('dialog')).toHaveClass('max-w-lg')
    expect(screen.getByRole('dialog')).not.toHaveClass('max-w-md')
  })

  it('puts the header, a scrolling body and the footer in that order', () => {
    render(<Panel footer={<button>Save</button>} />)
    const panel = screen.getByRole('dialog')
    const [header, body, footer] = Array.from(panel.children) as HTMLElement[]
    expect(within(header).getByRole('heading', { name: 'Edit pattern' })).toBeInTheDocument()
    expect(body).toHaveClass('flex-1', 'overflow-y-auto', 'p-[var(--card-pad)]')
    expect(within(body).getByLabelText('Notes')).toBeInTheDocument()
    expect(footer).toHaveClass('shrink-0', 'border-t')
    expect(within(footer).getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('has no footer strip without a footer', () => {
    render(<Panel />)
    expect(screen.getByRole('dialog').children).toHaveLength(2)
  })

  it('merges body and footer classes over the defaults instead of fighting them', () => {
    render(<Panel footer={<button>Save</button>} bodyClassName="flex flex-col gap-3 px-6" footerClassName="flex justify-end py-3" />)
    const [, body, footer] = Array.from(screen.getByRole('dialog').children) as HTMLElement[]
    expect(body).toHaveClass('flex-1', 'overflow-y-auto', 'flex', 'flex-col', 'gap-3', 'px-6')
    expect(footer).toHaveClass('shrink-0', 'border-t', 'flex', 'justify-end', 'py-3')
  })
})

describe('SlideOver close button', () => {
  it('is a named, typed button carrying the TAP_AREA 44px hit area, first in the dialog', () => {
    render(<Panel />)
    const close = screen.getByRole('button', { name: 'Close panel' })
    expect(close).toHaveAttribute('type', 'button')
    expect(close).toHaveClass(...TAP_AREA.split(' '))
    expect(within(screen.getByRole('dialog')).getAllByRole('button')[0]).toBe(close)
  })
})

describe('SlideOver closing and focus', () => {
  function WithOpener({ onClosed }: { onClosed?: () => void }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Edit it</button>
        <SlideOver open={open} onClose={() => { setOpen(false); onClosed?.() }} title="Edit">
          <input aria-label="Name" />
        </SlideOver>
      </>
    )
  }

  it('moves focus in on open and gives it back to the opener on every way out', async () => {
    const user = userEvent.setup()
    render(<WithOpener />)
    const opener = screen.getByRole('button', { name: 'Edit it' })

    await user.click(opener)
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()

    await user.click(opener)
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(opener).toHaveFocus()

    await user.click(opener)
    await user.click(screen.getByRole('dialog').previousElementSibling as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('a click inside the panel does not close it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Panel onClose={onClose} />)
    await user.click(screen.getByLabelText('Notes'))
    await user.click(screen.getByRole('heading', { name: 'Edit pattern' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('traps Tab inside the panel and wraps both ways (userEvent.tab)', async () => {
    const user = userEvent.setup()
    render(<Panel footer={<button>Save</button>} />)
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText('Notes')).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
  })

  it('focuses initialFocusRef instead of the close button', () => {
    function Focused() {
      const ref = useRef<HTMLInputElement>(null)
      return (
        <SlideOver open title="t" onClose={() => {}} initialFocusRef={ref}>
          <input aria-label="Name" ref={ref} />
        </SlideOver>
      )
    }
    render(<Focused />)
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus()
  })

  it('locks page scroll while open', () => {
    const { rerender } = render(<Panel />)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Panel open={false} />)
    expect(document.body.style.overflow).toBe('')
  })
})

describe('SlideOver beforeClose', () => {
  async function closeEveryWay(user: ReturnType<typeof userEvent.setup>) {
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('dialog').previousElementSibling as HTMLElement)
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
  }

  it('false vetoes Escape, the scrim and the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const beforeClose = vi.fn(() => false)
    render(<Panel onClose={onClose} beforeClose={beforeClose} />)
    await closeEveryWay(user)
    expect(beforeClose).toHaveBeenCalledTimes(3)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('true lets each of them close it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Panel onClose={onClose} beforeClose={() => true} />)
    await closeEveryWay(user)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('a promise of false vetoes; a promise of true closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<Panel onClose={onClose} beforeClose={() => Promise.resolve(false)} />)
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    rerender(<Panel onClose={onClose} beforeClose={() => Promise.resolve(true)} />)
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('a veto that rejects keeps the panel open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Panel onClose={onClose} beforeClose={() => Promise.reject(new Error('nope'))} />)
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores a second request while a promise veto is still pending', async () => {
    const user = userEvent.setup()
    let release: (allowed: boolean) => void = () => {}
    const beforeClose = vi.fn(() => new Promise<boolean>(resolve => { release = resolve }))
    const onClose = vi.fn()
    render(<Panel onClose={onClose} beforeClose={beforeClose} />)
    await user.keyboard('{Escape}')
    await user.keyboard('{Escape}')
    expect(beforeClose).toHaveBeenCalledTimes(1)
    release(true)
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('is not consulted when the caller closes the panel itself (a save that calls onClose, or a footer Cancel)', async () => {
    const user = userEvent.setup()
    const beforeClose = vi.fn(() => false)
    const onClose = vi.fn()
    render(<Panel onClose={onClose} beforeClose={beforeClose} footer={<button onClick={onClose}>Cancel</button>} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(beforeClose).not.toHaveBeenCalled()
  })
})

describe('SlideOver dirty', () => {
  it('a clean panel closes straight away: no prompt', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Panel onClose={onClose} dirty={false} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('Escape on a dirty panel asks "Discard changes?" and does not close; "Keep editing" returns to the field', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Panel onClose={onClose} dirty />)
    await user.click(screen.getByLabelText('Notes'))
    await user.keyboard('{Escape}')

    const prompt = screen.getByRole('alertdialog', { name: 'Discard changes?' })
    expect(prompt).toHaveAccessibleDescription(/unsaved changes/i)
    expect(onClose).not.toHaveBeenCalled()

    await user.click(within(prompt).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit pattern' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Notes')).toHaveFocus()
  })

  it('Escape on the prompt closes the prompt alone: the panel stays and the second Escape is the prompt\'s, not the panel\'s', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Panel onClose={onClose} dirty />)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit pattern' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('"Discard" closes the panel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Panel onClose={onClose} dirty />)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('the scrim and the close button ask too', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Panel onClose={onClose} dirty />)
    await user.click(screen.getByRole('dialog', { name: 'Edit pattern' }).previousElementSibling as HTMLElement)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('beforeClose runs first and can veto before any prompt appears', async () => {
    const user = userEvent.setup()
    render(<Panel dirty beforeClose={() => false} />)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('a footer Cancel that calls onClose is an explicit discard: no prompt even when dirty', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Panel dirty onClose={onClose} footer={<button onClick={onClose}>Cancel</button>} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('closing the panel from outside while the prompt is up does not leave a stale prompt for the next open', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Panel dirty />)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    rerender(<Panel dirty open={false} />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    rerender(<Panel dirty open />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('SlideOver with a dialog opened from inside it (the Delete flow)', () => {
  function PanelWithDelete({ onClose }: { onClose: () => void }) {
    const [asking, setAsking] = useState(false)
    return (
      <>
        <SlideOver open title="Edit shift" onClose={onClose} footer={<button onClick={() => setAsking(true)}>Delete</button>}>
          <input aria-label="Notes" />
        </SlideOver>
        <ConfirmDialog open={asking} onCancel={() => setAsking(false)} onConfirm={() => setAsking(false)} title="Delete shift" message="Sure?" />
      </>
    )
  }

  it('Escape closes only the dialog: the panel stays, focus is back on Delete, and the page is still scroll-locked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PanelWithDelete onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('alertdialog', { name: 'Delete shift' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit shift' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')

    // and now the panel answers Escape again
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tab inside the dialog stays in the dialog, not the panel behind it', async () => {
    const user = userEvent.setup()
    render(<PanelWithDelete onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog')
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })
})

describe('SlideOver and reduced motion', () => {
  const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf-8')

  it('the panel and scrim carry the classes index.css animates', () => {
    render(<Panel />)
    const panel = screen.getByRole('dialog')
    expect(panel).toHaveClass('slide-over-panel')
    expect(panel.previousElementSibling).toHaveClass('slide-over-scrim')
  })

  it('the slide and the scrim fade are declared only for users who have NOT asked for reduced motion', () => {
    // Every use of the animation must sit inside a `prefers-reduced-motion: no-preference` block, so with the preference set
    // nothing slides. Strip those blocks and no rule for the classes may be left.
    const withoutNoPreference = css.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^@]*\.slide-over-panel\s*\{\s*animation:\s*slideOverIn/)
    expect(withoutNoPreference).not.toMatch(/\.slide-over-panel\s*\{/)
    expect(withoutNoPreference).not.toMatch(/\.slide-over-scrim\s*\{/)
  })
})
