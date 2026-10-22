import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TenantFormPanel from './TenantFormPanel'

vi.mock('@/api/hooks/admin', () => ({
  useCreateTenantWithSetup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: vi.fn() }),
}))

// The panel's single-line inputs take a fixed `--control-h` height. A textarea that reuses that class ignores its `rows`
// attribute (an explicit height beats it), so the Invoice Footer Notes box rendered one line tall. jsdom does no layout, so
// this pins the class contract: no fixed height, a min-height level with the inputs, `rows` honoured, resizable.
describe('TenantFormPanel — Invoice Footer Notes textarea', () => {
  async function openProviderSection() {
    const user = userEvent.setup()
    render(<TenantFormPanel isOpen onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /provider settings/i }))
    return screen.getByText('Invoice Footer Notes').closest('div')!.querySelector('textarea')!
  }

  it('keeps its rows and does not carry the single-line control height', async () => {
    const textarea = await openProviderSection()
    expect(textarea).toHaveAttribute('rows', '2')
    expect(textarea.className).not.toMatch(/(^|\s)h-\[var\(--control-h\)\]/)
    expect(textarea).toHaveClass('h-auto', 'min-h-[var(--control-h)]')
  })

  it('can be resized vertically', async () => {
    const textarea = await openProviderSection()
    expect(textarea).toHaveClass('resize-y')
    expect(textarea).not.toHaveClass('resize-none')
  })
})

describe('TenantFormPanel as a dialog', () => {
  const tenant = { id: 'tenant-1', name: 'Sample Support Co', emailDomain: 'sample.com.au', isActive: true, createdAt: '2026-01-01T00:00:00Z', userCount: 2 }

  it('is a modal dialog named "New Tenant" or "Edit Tenant", closed when isOpen is false', () => {
    const { rerender } = render(<TenantFormPanel isOpen={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<TenantFormPanel isOpen onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'New Tenant' })).toHaveAttribute('aria-modal', 'true')
    rerender(<TenantFormPanel isOpen onClose={vi.fn()} tenant={tenant} />)
    expect(screen.getByRole('dialog', { name: 'Edit Tenant' })).toBeInTheDocument()
  })

  it('an untouched panel closes on Escape without asking, in create mode and in edit mode', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { unmount } = render(<TenantFormPanel isOpen onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()

    onClose.mockClear()
    render(<TenantFormPanel isOpen onClose={onClose} tenant={tenant} />)
    expect(screen.getByPlaceholderText('e.g. Acme Travel Co')).toHaveValue('Sample Support Co')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('an edit makes Escape ask first; Discard closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TenantFormPanel isOpen onClose={onClose} />)
    await user.type(screen.getByPlaceholderText('e.g. Acme Travel Co'), 'Acme')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('once the save has gone through there is nothing to discard: Escape closes at once', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TenantFormPanel isOpen onClose={onClose} />)
    await user.type(screen.getByPlaceholderText('e.g. Acme Travel Co'), 'Acme')
    await user.type(screen.getByPlaceholderText('e.g. acme.com.au'), 'acme.com.au')
    await user.click(screen.getByRole('button', { name: /State/ }))
    await user.click(screen.getByRole('option', { name: 'NSW' }))
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))
    expect(await screen.findByText('Tenant created')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

// The Active toggle is a switch, as UserFormPanel's twin is: a screen reader hears its name and whether it is on.
describe('TenantFormPanel — Active switch', () => {
  const tenant = { id: 'tenant-1', name: 'Sample Support Co', emailDomain: 'sample.com.au', isActive: true, createdAt: '2026-01-01T00:00:00Z', userCount: 2 }

  it('is a named switch that reports and flips its state', async () => {
    const user = userEvent.setup()
    render(<TenantFormPanel isOpen onClose={vi.fn()} tenant={tenant} />)
    const toggle = screen.getByRole('switch', { name: 'Active' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })
})

// V-D2 follow-up: the labels sat beside their inputs without naming them, so a screen reader announced every field as an unnamed edit box.
describe('TenantFormPanel — every field is named by its label', () => {
  it('finds each create-mode field by its visible label', async () => {
    const user = userEvent.setup()
    render(<TenantFormPanel isOpen onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /provider settings/i }))
    for (const label of ['Organisation Name *', 'Email Domain', 'Registration Number', 'ABN', 'Organisation Name', 'Address', 'Bank Account Name', 'BSB', 'Account Number', 'Invoice Footer Notes']) {
      expect(screen.getByLabelText(label, { selector: 'input, textarea' }), label).toBeInTheDocument()
    }
    expect(screen.getByText('State *')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /initial admin user/i }))
    expect(screen.getByLabelText('Role')).toBeInTheDocument()
  })
})
