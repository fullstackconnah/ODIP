import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UserSwitcher from './UserSwitcher'

const { mockUseAdminTenantUsers } = vi.hoisted(() => ({
  mockUseAdminTenantUsers: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useAdminTenantUsers: mockUseAdminTenantUsers,
}))

const TENANT_USERS = [
  { id: 'user-support-1', fullName: 'Jamie Support', role: 'SupportWorker', isActive: true },
  { id: 'user-coord-1', fullName: 'Casey Coordinator', role: 'Coordinator', isActive: true },
]

const SUPERADMIN_USER = { id: 'superadmin-1', fullName: 'Sam SuperAdmin', role: 'SuperAdmin', tenantId: null }

function setSuperAdminSignedIn() {
  localStorage.setItem('odip_user', JSON.stringify(SUPERADMIN_USER))
  sessionStorage.setItem('odip_viewing_tenant', 'tenant-1')
}

beforeEach(() => {
  localStorage.clear()
  mockUseAdminTenantUsers.mockReturnValue({ data: { success: true, data: TENANT_USERS } })
  // jsdom doesn't implement navigation — stub reload so selectUser/clearUser's
  // window.location.reload() call doesn't throw and so tests can assert it fired. The stub goes ahead with the
  // reload as far as the page can tell (pagehide), so a later step in the same test acts as the reloaded page.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: vi.fn(() => window.dispatchEvent(new Event('pagehide'))) },
  })
})

describe('UserSwitcher — RIDER: id-based self-exclusion under view-as', () => {
  it('selectUser overrides id (not just fullName/role) in this tab viewing profile', async () => {
    setSuperAdminSignedIn()
    const user = userEvent.setup()
    render(<UserSwitcher />)

    await user.click(screen.getByRole('button', { name: /view as user/i }))
    await user.click(screen.getByRole('button', { name: /jamie support/i }))
    // Selecting a user now opens a confirm dialog (PP-22) before switchTenant/selectUser
    // actually fires.
    await user.click(screen.getByRole('button', { name: /^switch user$/i }))

    const storedUser = JSON.parse(sessionStorage.getItem('odip_viewing_profile') || '{}')
    // The bug this rider fixes: only fullName/role were overridden, leaving `id` at the
    // SuperAdmin's own id — usePermissions() reads `id` as the self-exclusion source (e.g. the
    // medication witness picker), so an impersonated user was never excluded from their own
    // picker under view-as.
    expect(storedUser.id).toBe('user-support-1')
    expect(storedUser.fullName).toBe('Jamie Support')
    expect(storedUser.role).toBe('SupportWorker')

    expect(sessionStorage.getItem('odip_viewing_user')).toBe('user-support-1')
    expect(window.location.reload).toHaveBeenCalledTimes(1)

    // The SuperAdmin's own profile is never overwritten: other tabs keep acting as them.
    expect(JSON.parse(localStorage.getItem('odip_user') || '{}')).toEqual(SUPERADMIN_USER)
    expect(localStorage.getItem('odip_superadmin_user')).toBeNull()
  })

  it('never overwrites the own profile of the SuperAdmin, however many users are viewed in turn', async () => {
    setSuperAdminSignedIn()
    const user = userEvent.setup()
    render(<UserSwitcher />)

    await user.click(screen.getByRole('button', { name: /view as user/i }))
    await user.click(screen.getByRole('button', { name: /^jamie support/i }))
    await user.click(screen.getByRole('button', { name: /^switch user$/i }))

    // Reopen (trigger now reads back "Jamie Support" from localStorage on this re-render — no
    // real page reload happened, reload() is stubbed) and switch to a different impersonated
    // user: odip_user must still hold the ORIGINAL SuperAdmin identity. The trigger's own accessible name now starts
    // with the "USR" badge, not the user's name, so it's unambiguous against the dropdown row.
    await user.click(screen.getByRole('button', { name: /^usr/i }))
    await user.click(screen.getByRole('button', { name: /^casey coordinator/i }))
    await user.click(screen.getByRole('button', { name: /^switch user$/i }))

    expect(JSON.parse(localStorage.getItem('odip_user') || '{}').id).toBe('superadmin-1')
    expect(JSON.parse(sessionStorage.getItem('odip_viewing_profile') || '{}').id).toBe('user-coord-1')
  })

  it('exposes aria-haspopup/aria-expanded on the trigger and closes the dropdown on Escape (PP-74)', async () => {
    setSuperAdminSignedIn()
    const user = userEvent.setup()
    render(<UserSwitcher />)

    const trigger = screen.getByRole('button', { name: /view as user/i })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/view as user$/i)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('clearUser restores the original id on switch-back', async () => {
    setSuperAdminSignedIn()
    const user = userEvent.setup()
    render(<UserSwitcher />)

    await user.click(screen.getByRole('button', { name: /view as user/i }))
    await user.click(screen.getByRole('button', { name: /^jamie support/i }))
    await user.click(screen.getByRole('button', { name: /^switch user$/i }))
    expect(JSON.parse(sessionStorage.getItem('odip_viewing_profile') || '{}').id).toBe('user-support-1')

    // Reopen the dropdown (selectUser closed it) to reach "Exit view".
    await user.click(screen.getByRole('button', { name: /^usr/i }))
    await user.click(screen.getByRole('button', { name: /exit view/i }))
    // Exiting view is confirmed the same way switching users is.
    await user.click(screen.getByRole('button', { name: /^exit view$/i }))

    const restoredUser = JSON.parse(localStorage.getItem('odip_user') || '{}')
    expect(restoredUser.id).toBe('superadmin-1')
    expect(restoredUser.role).toBe('SuperAdmin')
    expect(sessionStorage.getItem('odip_viewing_profile')).toBeNull()
    expect(sessionStorage.getItem('odip_viewing_user')).toBeNull()
    // Once for the earlier switch-user confirm, once for the exit-view confirm.
    expect(window.location.reload).toHaveBeenCalledTimes(2)
  })

  it('cancelling the exit-view confirm dialog leaves the impersonated session untouched', async () => {
    setSuperAdminSignedIn()
    const user = userEvent.setup()
    render(<UserSwitcher />)

    await user.click(screen.getByRole('button', { name: /view as user/i }))
    await user.click(screen.getByRole('button', { name: /^jamie support/i }))
    await user.click(screen.getByRole('button', { name: /^switch user$/i }))

    await user.click(screen.getByRole('button', { name: /^usr/i }))
    await user.click(screen.getByRole('button', { name: /exit view/i }))
    // The confirm dialog is now open — cancel it instead of confirming.
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(JSON.parse(sessionStorage.getItem('odip_viewing_profile') || '{}').id).toBe('user-support-1')
    expect(sessionStorage.getItem('odip_viewing_user')).toBe('user-support-1')
    expect(window.location.reload).toHaveBeenCalledTimes(1) // only from the earlier switch, not from exit
  })
})

// Density polish (touch): same treatment as TenantSwitcher. A 32px trigger and 36px rows take a --tap-min floor, and
// below sm the user's name leaves the trigger (kept in its accessible name and tooltip) so the SuperAdmin header fits.
describe('UserSwitcher — touch target and small-screen trigger', () => {
  it('floors the trigger at --tap-min without changing its look on a mouse', () => {
    setSuperAdminSignedIn()
    render(<UserSwitcher />)

    const trigger = screen.getByRole('button', { name: /view as user/i })
    expect(trigger).toHaveClass('flex', 'min-h-[var(--tap-min)]', 'items-center', 'gap-1.5', 'px-2.5', 'py-1.5', 'rounded-lg')
    expect(trigger.className).not.toMatch(/44px/)
  })

  it('hides the name below sm but keeps it in the accessible name and tooltip when a user is being viewed', () => {
    setSuperAdminSignedIn()
    sessionStorage.setItem('odip_viewing_user', 'user-support-1')
    render(<UserSwitcher />)

    const trigger = screen.getByRole('button', { name: 'USR Jamie Support' })
    expect(trigger).toHaveAttribute('title', 'Jamie Support')
    const name = screen.getByText('Jamie Support', { selector: 'span' })
    expect(name).toHaveClass('hidden', 'sm:block')
    expect(screen.getByText('USR')).not.toHaveClass('hidden')
  })

  it('says "View as user…" in the accessible name before anyone is being viewed, with no tooltip', () => {
    setSuperAdminSignedIn()
    render(<UserSwitcher />)

    const trigger = screen.getByRole('button', { name: 'USR View as user…' })
    expect(trigger).not.toHaveAttribute('title')
  })

  it('floors the menu rows at --tap-min, including "Exit view"', async () => {
    setSuperAdminSignedIn()
    sessionStorage.setItem('odip_viewing_user', 'user-support-1')
    const user = userEvent.setup()
    render(<UserSwitcher />)

    await user.click(screen.getByRole('button', { name: /^usr/i }))
    const exit = screen.getByRole('button', { name: /exit view/i })
    expect(exit).toHaveClass('min-h-[var(--tap-min)]', 'w-full', 'flex', 'items-center')
    for (const name of [/^jamie support/i, /^casey coordinator/i]) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-[var(--tap-min)]', 'w-full', 'flex', 'items-center', 'py-2')
    }
  })
})

describe('UserSwitcher — a switch whose reload was cancelled', () => {
  it('puts the SuperAdmin back on the first press after staying, so the next request is not made as the viewed user', async () => {
    // A reload a dirty form's prompt cancelled: the page never hides.
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload: vi.fn() } })
    setSuperAdminSignedIn()
    const user = userEvent.setup()
    render(<UserSwitcher />)

    await user.click(screen.getByRole('button', { name: /view as user/i }))
    await user.click(screen.getByRole('button', { name: /jamie support/i }))
    await user.click(screen.getByRole('button', { name: /^switch user$/i }))
    expect(sessionStorage.getItem('odip_viewing_user')).toBe('user-support-1')

    window.dispatchEvent(new Event('pointerdown'))

    expect(sessionStorage.getItem('odip_viewing_user')).toBeNull()
    expect(JSON.parse(localStorage.getItem('odip_user') || '{}')).toEqual(SUPERADMIN_USER)
    expect(sessionStorage.getItem('odip_viewing_profile')).toBeNull()
    expect(localStorage.getItem('odip_superadmin_user')).toBeNull()
  })
})

describe("UserSwitcher dismissal", () => {
  it.each([
    ["switch", "Cancel"],
    ["switch", "Escape"],
    ["switch", "Close dialog"],
    ["exit", "Cancel"],
    ["exit", "Escape"],
    ["exit", "Close dialog"],
  ])("dismisses %s via %s once", async (flow, dismiss) => {
    const user = userEvent.setup();
    setSuperAdminSignedIn();
    if (flow === "exit") {
      sessionStorage.setItem("odip_viewing_profile", JSON.stringify({ ...SUPERADMIN_USER, id: "user-support-1" }));
      sessionStorage.setItem("odip_viewing_user", "user-support-1");
    }

    const originalOverflow = document.body.style.overflow;
    const originalUser = localStorage.getItem("odip_user");
    const originalViewingUser = sessionStorage.getItem("odip_viewing_user");
    const originalProfile = sessionStorage.getItem("odip_viewing_profile");
    const originalViewingTenant = sessionStorage.getItem("odip_viewing_tenant");

    render(
      <header style={{ backdropFilter: "blur(24px)" }}>
        <UserSwitcher />
      </header>
    );

    const trigger = screen.getByRole("button", { name: /^USR / });
    await user.click(trigger);

    if (flow === "switch") {
      const casey = screen.getByRole("button", { name: /Casey Coordinator/ });
      await user.click(casey);
    } else {
      const exit = screen.getByRole("button", { name: /Exit view/ });
      await user.click(exit);
    }

    const dialogTitle =
      flow === "switch" ? "Switch user?" : "Exit user view?";
    const dialog = screen.getByRole("alertdialog", { name: dialogTitle });
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

    expect(screen.queryByRole("alertdialog", { name: dialogTitle })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe(originalOverflow);
    expect(localStorage.getItem("odip_user")).toBe(originalUser);
    expect(sessionStorage.getItem("odip_viewing_user")).toBe(originalViewingUser);
    expect(sessionStorage.getItem("odip_viewing_profile")).toBe(originalProfile);
    expect(sessionStorage.getItem("odip_viewing_tenant")).toBe(originalViewingTenant);
  });
});

describe('UserSwitcher — label stays on one line in the header bar', () => {
  it('keeps "View as user…" on one line and truncates a long name, full name still the accessible name', () => {
    setSuperAdminSignedIn()
    render(<UserSwitcher />)
    const idle = screen.getByText('View as user…')
    expect(idle.className).toContain('whitespace-nowrap')
    expect(idle.className).toContain('truncate')
    expect(idle.className).toContain('min-w-0')
    expect(idle.className).toContain('min-[1400px]:max-w-[20rem]')
  })
})

describe('UserSwitcher: focus ring', () => {
  it('carries the house keyboard focus ring', () => {
    setSuperAdminSignedIn()
    render(<UserSwitcher />)
    expect(screen.getByRole('button', { name: /view as user/i })).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-[var(--color-ring)]')
  })

  it('gives the exit-view row and every user row the keyboard focus ring', async () => {
    setSuperAdminSignedIn()
    sessionStorage.setItem('odip_viewing_user', 'user-support-1')
    const user = userEvent.setup()
    render(<UserSwitcher />)

    await user.click(screen.getByRole('button', { name: /^usr/i }))
    const rows = [screen.getByRole('button', { name: /exit view/i }), screen.getByRole('button', { name: /^casey coordinator/i })]
    for (const row of rows) {
      expect(row).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-[var(--color-ring)]', 'focus-visible:relative')
      expect(row).not.toHaveClass('focus:ring-2')
    }
  })
})

// The trigger sits too far left on a 360px phone for a right-aligned w-64 popover; it narrows below sm (shots measure the rect).
describe('UserSwitcher: popover stays on screen on a phone', () => {
  it('narrows to w-56 below sm and keeps w-64 from sm up', async () => {
    setSuperAdminSignedIn()
    const user = userEvent.setup()
    render(<UserSwitcher />)

    await user.click(screen.getByRole('button', { name: /^usr/i }))
    const popover = screen.getByText('View as user', { exact: true }).closest('div.absolute')
    expect(popover).toHaveClass('right-0', 'w-64', 'max-sm:w-56')
  })
})
