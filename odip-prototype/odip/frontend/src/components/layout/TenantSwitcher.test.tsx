import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TenantSwitcher from './TenantSwitcher'

const { mockUseAdminTenantsSummary } = vi.hoisted(() => ({
  mockUseAdminTenantsSummary: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useAdminTenantsSummary: mockUseAdminTenantsSummary,
}))

const TENANTS = [
  { id: 'tenant-1', name: 'Demo', isActive: true },
  { id: 'tenant-2', name: 'Acme', isActive: true },
]

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('odip_viewing_tenant', 'tenant-1')
  mockUseAdminTenantsSummary.mockReturnValue({ data: TENANTS })
})

describe('TenantSwitcher — trigger a11y and keyboard dismissal (PP-74)', () => {
  it('exposes aria-haspopup and toggles aria-expanded on the trigger', async () => {
    const user = userEvent.setup()
    render(<TenantSwitcher />)

    const trigger = screen.getByRole('button', { name: /demo/i })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes the dropdown on Escape', async () => {
    const user = userEvent.setup()
    render(<TenantSwitcher />)

    const trigger = screen.getByRole('button', { name: /demo/i })
    await user.click(trigger)
    expect(screen.getByText(/viewing as tenant/i)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByText(/viewing as tenant/i)).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})

// Density polish (touch): the SuperAdmin tenant switcher was a 32px trigger and 36px menu rows. Both take a --tap-min
// floor (0px on a mouse, 44px under `pointer: coarse`; the header is 48px tall, so 44 fits). Below sm the tenant name
// leaves the trigger (a SuperAdmin's two switchers + bell + avatar overflowed a 390px header by 18px) but stays in the
// button's accessible name and tooltip. jsdom applies no CSS, so the class contract is pinned.
describe('TenantSwitcher — touch target and small-screen trigger', () => {
  it('floors the trigger at --tap-min without changing its look on a mouse', () => {
    render(<TenantSwitcher />)

    const trigger = screen.getByRole('button', { name: /demo/i })
    expect(trigger).toHaveClass('flex', 'min-h-[var(--tap-min)]', 'items-center', 'gap-1.5', 'px-2.5', 'py-1.5', 'rounded-lg')
    expect(trigger.className).not.toMatch(/44px/)
  })

  it('keeps the tenant name reachable when it is hidden below sm: in the accessible name and the tooltip', () => {
    render(<TenantSwitcher />)

    const trigger = screen.getByRole('button', { name: 'SA Demo' })
    expect(trigger).toHaveAttribute('title', 'Demo')
    const name = screen.getByText('Demo', { selector: 'span' })
    expect(name).toHaveClass('hidden', 'sm:block')
    // The SA badge and the caret stay on every width.
    expect(screen.getByText('SA')).not.toHaveClass('hidden')
  })

  it('names the trigger while the tenant list is still loading, with no tooltip until there is a name', () => {
    mockUseAdminTenantsSummary.mockReturnValue({ data: [] })
    localStorage.setItem('odip_viewing_tenant', 'missing')
    render(<TenantSwitcher />)

    const trigger = screen.getByRole('button', { name: 'SA Loading…' })
    expect(trigger).not.toHaveAttribute('title')
  })

  it('floors every menu row at --tap-min too', async () => {
    const user = userEvent.setup()
    render(<TenantSwitcher />)

    await user.click(screen.getByRole('button', { name: 'SA Demo' }))
    const rows = [screen.getByRole('button', { name: /^Demo/ }), screen.getByRole('button', { name: /^Acme/ })]
    for (const row of rows) expect(row).toHaveClass('min-h-[var(--tap-min)]', 'w-full', 'flex', 'items-center', 'py-2')
  })
})

describe('TenantSwitcher — a switch whose reload was cancelled', () => {
  it('puts the old tenant back on the first press after staying, so the next request still goes to it', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload: vi.fn() } })
    const user = userEvent.setup()
    render(<TenantSwitcher />)

    await user.click(screen.getByRole('button', { name: /^SA /i }))
    await user.click(screen.getByRole('button', { name: /Acme/ }))
    await user.click(screen.getByRole('button', { name: 'Switch tenant' }))
    expect(window.location.reload).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('odip_viewing_tenant')).toBe('tenant-2')   // what the reloaded page reads

    window.dispatchEvent(new Event('pointerdown'))   // "Stay" on a dirty form's prompt, then a press on this page

    expect(localStorage.getItem('odip_viewing_tenant')).toBe('tenant-1')
  })
})

describe("TenantSwitcher dismissal", () => {
  it.each(["Cancel", "Escape", "Close dialog"])("dismisses via %s once", async (dismiss) => {
    const user = userEvent.setup();
    const originalOverflow = document.body.style.overflow;
    const originalViewing = localStorage.getItem("odip_viewing_tenant");

    render(
      <header style={{ backdropFilter: "blur(24px)" }}>
        <TenantSwitcher />
      </header>
    );

    const trigger = screen.getByRole("button", { name: /^SA / });
    await user.click(trigger);

    const acme = screen.getByRole("button", { name: "Acme" });
    await user.click(acme);

    const dialog = screen.getByRole("alertdialog", { name: "Switch tenant?" });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    if (dismiss === "Escape") {
      await user.keyboard("{Escape}");
    } else {
      await user.click(screen.getByRole("button", { name: dismiss }));
    }

    expect(screen.queryByRole("alertdialog", { name: "Switch tenant?" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe(originalOverflow);
    expect(localStorage.getItem("odip_viewing_tenant")).toBe(originalViewing);
  });
});

describe('TenantSwitcher — label stays on one line in the header bar', () => {
  it('truncates a long name instead of wrapping, and keeps the full name as the accessible name and title', () => {
    const name = 'Jo Care Disability Services And Supports Pty'
    mockUseAdminTenantsSummary.mockReturnValue({ data: [{ id: 'tenant-1', name, isActive: true }] })
    render(<TenantSwitcher />)

    const trigger = screen.getByRole('button', { name: `SA ${name}` })
    expect(trigger).toHaveAttribute('title', name)
    const label = screen.getByText(name)
    expect(label.className).toContain('whitespace-nowrap')
    expect(label.className).toContain('truncate')
    expect(label.className).toContain('min-w-0')
  })
})
