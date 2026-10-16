import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { useUnsavedChangesWarning } from './useUnsavedChangesWarning'

const sectionOf = (search: string) => new URLSearchParams(search).get('section')

function Form({ dirty }: { dirty: boolean }) {
  const { dialog } = useUnsavedChangesWarning(dirty, {
    blockIf: (current, next) => sectionOf(current.search) !== sectionOf(next.search),
    stayCopy: { title: 'Leave Billing details without saving?', message: 'Your changes in this section have not been saved.', confirmLabel: 'Discard changes' },
  })
  return (
    <>
      {dialog}
      <Link to="/settings?section=organisation">Organisation profile</Link>
      <Link to="/settings?section=billing&page=2">Same section</Link>
      <Link to="/elsewhere">Elsewhere</Link>
    </>
  )
}

function renderForm(dirty: boolean) {
  const router = createMemoryRouter(
    [{ path: '/settings', element: <Form dirty={dirty} /> }, { path: '/elsewhere', element: <p>Elsewhere page</p> }],
    { initialEntries: ['/settings?section=billing'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('useUnsavedChangesWarning with blockIf and stayCopy', () => {
  it('asks before a dirty form moves to another section of the same page, in the words given for staying', async () => {
    const user = userEvent.setup()
    const router = renderForm(true)

    await user.click(screen.getByRole('link', { name: 'Organisation profile' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Leave Billing details without saving?' })
    expect(dialog).toHaveTextContent('Your changes in this section have not been saved.')
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(router.state.location.search).toBe('?section=billing')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('goes on to the section asked for after "Discard changes"', async () => {
    const user = userEvent.setup()
    const router = renderForm(true)

    await user.click(screen.getByRole('link', { name: 'Organisation profile' }))
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))

    expect(router.state.location.search).toBe('?section=organisation')
  })

  it('lets a move inside the same section through', async () => {
    const user = userEvent.setup()
    const router = renderForm(true)

    await user.click(screen.getByRole('link', { name: 'Same section' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(router.state.location.search).toBe('?section=billing&page=2')
  })

  it('keeps the house words for leaving the page altogether', async () => {
    const user = userEvent.setup()
    renderForm(true)

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))

    expect(screen.getByRole('alertdialog', { name: 'Leave without saving?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave page' })).toBeInTheDocument()
  })

  it('never asks while the form is clean', async () => {
    const user = userEvent.setup()
    const router = renderForm(false)

    await user.click(screen.getByRole('link', { name: 'Organisation profile' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(router.state.location.search).toBe('?section=organisation')
  })
})

describe('useUnsavedChangesWarning: browser Back and closing the tab', () => {
  it('asks before the browser Back button leaves a dirty section, and stays put', async () => {
    const router = createMemoryRouter(
      [{ path: '/settings', element: <Form dirty /> }],
      { initialEntries: ['/settings?section=organisation', '/settings?section=billing'], initialIndex: 1 },
    )
    render(<RouterProvider router={router} />)

    await act(async () => { await router.navigate(-1) })

    expect(screen.getByRole('alertdialog', { name: 'Leave Billing details without saving?' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?section=billing')
  })

  it('asks the browser to confirm closing or reloading the tab while dirty, and not while clean', () => {
    const { unmount } = render(<RouterProvider router={createMemoryRouter([{ path: '/settings', element: <Form dirty /> }], { initialEntries: ['/settings?section=billing'] })} />)
    const dirtyClose = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirtyClose)
    expect(dirtyClose.defaultPrevented).toBe(true)
    unmount()

    renderForm(false)
    const cleanClose = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanClose)
    expect(cleanClose.defaultPrevented).toBe(false)
  })
})

describe('useUnsavedChangesWarning with leaveCopy', () => {
  const leaveCopy = { title: 'Leave without publishing?', message: 'They stay saved as drafts.', confirmLabel: 'Leave without publishing', stayLabel: 'Stay' }

  function Roster() {
    const { dialog } = useUnsavedChangesWarning(true, { leaveCopy, blockIf: (current, next) => sectionOf(current.search) !== sectionOf(next.search) })
    return (
      <>
        {dialog}
        <Link to="/settings?section=organisation">Organisation profile</Link>
        <Link to="/elsewhere">Elsewhere</Link>
      </>
    )
  }

  function renderRoster() {
    const router = createMemoryRouter(
      [{ path: '/settings', element: <Roster /> }, { path: '/elsewhere', element: <p>Elsewhere page</p> }],
      { initialEntries: ['/settings?section=billing'] },
    )
    render(<RouterProvider router={router} />)
    return router
  }

  it('asks in the given words before leaving the page, with Stay first and a primary, not red, confirm', async () => {
    const user = userEvent.setup()
    const router = renderRoster()

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Leave without publishing?' })
    expect(dialog).toHaveTextContent('They stay saved as drafts.')
    expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus()
    const confirm = screen.getByRole('button', { name: 'Leave without publishing' })
    expect(confirm.className).toContain('bg-[var(--color-primary)]')
    expect(confirm.className).not.toContain('bg-[var(--color-destructive)]')

    await user.click(screen.getByRole('button', { name: 'Stay' }))
    expect(router.state.location.pathname).toBe('/settings')
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
    await user.click(screen.getByRole('button', { name: 'Leave without publishing' }))
    expect(router.state.location.pathname).toBe('/elsewhere')
  })

  it('uses the same words for a same-page move its blockIf asks about', async () => {
    const user = userEvent.setup()
    renderRoster()

    await user.click(screen.getByRole('link', { name: 'Organisation profile' }))
    expect(screen.getByRole('alertdialog', { name: 'Leave without publishing?' })).toBeInTheDocument()
  })
})
