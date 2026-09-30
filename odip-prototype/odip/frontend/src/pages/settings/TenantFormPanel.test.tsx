import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TenantFormPanel from './TenantFormPanel'

vi.mock('@/api/hooks/admin', () => ({
  useCreateTenantWithSetup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
