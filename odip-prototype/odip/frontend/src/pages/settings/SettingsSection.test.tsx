import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { SETTINGS_PERMS } from '@/test/fixtures/settingsPermissions'
import { SettingsSection, type SectionSave } from './SettingsSection'

const { mockUsePermissions, screenSize } = vi.hoisted(() => ({ mockUsePermissions: vi.fn(), screenSize: { belowMd: false } }))
vi.mock('@/lib/permissions', () => ({ usePermissions: mockUsePermissions }))
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => screenSize.belowMd }))

beforeEach(() => {
  mockUsePermissions.mockReturnValue(SETTINGS_PERMS.Admin)
  screenSize.belowMd = false
})

type HarnessProps = { save?: SectionSave; readOnly?: boolean; focusOnMount?: boolean }

function Harness({ save, readOnly = false, focusOnMount = false }: HarnessProps) {
  return (
    <>
      <Link to="/settings?section=organisation">Organisation profile</Link>
      <Link to="/settings">Settings home</Link>
      <SettingsSection title="Billing details" description="The bank account on your invoices." readOnly={readOnly} focusOnMount={focusOnMount} save={save}>
        <input aria-label="Account name" readOnly={readOnly} defaultValue="Sunrise Support" />
      </SettingsSection>
    </>
  )
}

function renderFrame(props: HarnessProps) {
  const router = createMemoryRouter([{ path: '/settings', element: <Harness {...props} /> }], { initialEntries: ['/settings?section=billing'] })
  render(<RouterProvider router={router} />)
  return router
}

const save = (over: Partial<SectionSave> = {}): SectionSave => ({ dirty: false, pending: false, result: null, onSave: vi.fn(), ...over })
const saveButton = () => screen.getByRole('button', { name: /^(Save changes|Saving…)$/ })

describe('SettingsSection: the frame', () => {
  it('is a region named by its h2, with its one sentence and no locked note for someone who can edit', () => {
    renderFrame({ save: save() })
    expect(screen.getByRole('region', { name: 'Billing details' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Billing details' })).toBeInTheDocument()
    expect(screen.getByText('The bank account on your invoices.')).toBeInTheDocument()
    expect(screen.queryByText(/only an admin can change these/i)).not.toBeInTheDocument()
  })

  it('says why a read-only section is locked, before its fields, and draws no Save even when one is passed', () => {
    renderFrame({ readOnly: true, save: save({ dirty: true }) })
    const note = screen.getByText('Only an Admin can change these. Ask an Admin if something here needs updating.')
    expect(note.compareDocumentPosition(screen.getByLabelText('Account name')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('moves focus to its heading only when a switch brought the person here', () => {
    renderFrame({ focusOnMount: true })
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus()
  })

  it('leaves focus alone on a first load or a deep link', () => {
    renderFrame({ focusOnMount: false })
    expect(screen.getByRole('heading', { level: 2 })).not.toHaveFocus()
  })
})

describe('SettingsSection: the save foot', () => {
  it.each([
    ['clean, nothing saved this visit', {}, true, /^$/],
    ['dirty', { dirty: true }, false, /^Unsaved changes$/],
    ['dirty with one field wrong', { dirty: true, problems: 1 }, true, /^Fix 1 field to save\.$/],
    ['dirty with two fields wrong', { dirty: true, problems: 2 }, true, /^Fix 2 fields to save\.$/],
    ['saving', { dirty: true, pending: true }, true, /^Unsaved changes$/],
    ['saved', { result: 'saved' }, true, /^Saved$/],
    ['edited again after a save', { dirty: true, result: 'saved' }, false, /^Unsaved changes$/],
  ] as const)('%s', (_state, over, disabled, status) => {
    renderFrame({ save: save(over as Partial<SectionSave>) })
    expect(saveButton().hasAttribute('disabled')).toBe(disabled)
    expect(screen.getByRole('status')).toHaveTextContent(status)
  })

  it('says "Saving…" and is busy while the save runs, then calls onSave on a click', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<RouterProvider router={createMemoryRouter([{ path: '/', element: <SettingsSection title="Budgets" description="d" readOnly={false} focusOnMount={false} save={save({ dirty: true, pending: true })}><p>body</p></SettingsSection> }])} />)
    expect(saveButton()).toHaveTextContent('Saving…')
    expect(saveButton()).toHaveAttribute('aria-busy', 'true')
    unmount()

    const onSave = vi.fn()
    renderFrame({ save: save({ dirty: true, onSave }) })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('reads a failure out as an alert and keeps Save available for a retry', () => {
    renderFrame({ save: save({ dirty: true, result: { error: 'Not saved. Check your connection and try again.' } }) })
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved. Check your connection and try again.')
    expect(screen.getByRole('status')).toHaveTextContent(/^$/)
    expect(saveButton()).toBeEnabled()
  })
})

describe('SettingsSection: switching section with unsaved changes', () => {
  it('asks before another section opens, and opens it after "Discard changes"', async () => {
    const user = userEvent.setup()
    const router = renderFrame({ save: save({ dirty: true }) })

    await user.click(screen.getByRole('link', { name: 'Organisation profile' }))
    expect(screen.getByRole('alertdialog', { name: 'Leave Billing details without saving?' })).toHaveTextContent(
      "Your changes in this section haven't been saved. If you leave it now, they'll be lost.",
    )
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(router.state.location.search).toBe('?section=billing')

    await user.click(screen.getByRole('link', { name: 'Organisation profile' }))
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(router.state.location.search).toBe('?section=organisation')
  })

  // Bare /settings is Profile from md up and the list below md: a different place from Billing details either way.
  it.each([false, true])('asks before bare /settings too (below md: %s)', async belowMd => {
    screenSize.belowMd = belowMd
    const user = userEvent.setup()
    renderFrame({ save: save({ dirty: true }) })

    await user.click(screen.getByRole('link', { name: 'Settings home' }))
    expect(screen.getByRole('alertdialog', { name: 'Leave Billing details without saving?' })).toBeInTheDocument()
  })

  // The foot blurs what scrolls under it, and a backdrop filter traps a fixed child: the prompt would cover the foot band only.
  it('draws the prompt over the whole page, not inside the sticky foot', async () => {
    const user = userEvent.setup()
    renderFrame({ save: save({ dirty: true }) })
    await user.click(screen.getByRole('link', { name: 'Organisation profile' }))

    const scrim = screen.getByRole('alertdialog').closest('[role="presentation"]')
    expect(scrim?.parentElement).toBe(document.body)
  })

  it('asks before the browser Back button leaves for the section before', async () => {
    const router = createMemoryRouter([{ path: '/settings', element: <Harness save={save({ dirty: true })} /> }], {
      initialEntries: ['/settings?section=organisation', '/settings?section=billing'],
      initialIndex: 1,
    })
    render(<RouterProvider router={router} />)

    await act(async () => { await router.navigate(-1) })

    expect(screen.getByRole('alertdialog', { name: 'Leave Billing details without saving?' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?section=billing')
  })

  it('never asks from a read-only section, which has no foot', async () => {
    const user = userEvent.setup()
    const router = renderFrame({ readOnly: true, save: save({ dirty: true }) })

    await user.click(screen.getByRole('link', { name: 'Organisation profile' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(router.state.location.search).toBe('?section=organisation')
  })
})
