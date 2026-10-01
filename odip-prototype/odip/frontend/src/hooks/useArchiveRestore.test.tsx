import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useArchiveRestore } from './useArchiveRestore'

type Item = { id: string; name: string; status: string }
const item: Item = { id: 'a1', name: 'Alex Rivera', status: 'Open' }

/** An axios-shaped failure: the API's envelope sits on `response.data`, where `extractErrorMessage` reads it. */
const apiError = (message: string) => ({ response: { data: { success: false, errors: [message] } } })

type MutateOptions = { onError?: (error: unknown) => void }

function Harness({
  deleteMutate,
  restoreMutate,
  restoreData,
}: {
  deleteMutate: (id: string, options?: MutateOptions) => void
  restoreMutate?: (args: { id: string; data: unknown }, options?: MutateOptions) => void
  restoreData?: (row: Item) => unknown
}) {
  const { toggleButtons, actionButtons, confirmDialog, errorNotice } = useArchiveRestore<Item>({
    deleteMutation: { mutate: deleteMutate, isPending: false },
    restoreMutation: restoreMutate ? { mutate: restoreMutate, isPending: false } : undefined,
    restoreData,
    entityName: row => row.name,
    entityId: row => row.id,
  })
  return (
    <MemoryRouter>
      {toggleButtons}
      {actionButtons(item)}
      {confirmDialog}
      {errorNotice}
    </MemoryRouter>
  )
}

async function archive(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Archive' }))
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }))
}

async function restore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: 'Archived' }))
  await user.click(screen.getByRole('button', { name: 'Restore' }))
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restore' }))
}

describe('useArchiveRestore — surfacing mutation errors for every screen that uses it', () => {
  it('shows nothing until a mutation fails', () => {
    render(<Harness deleteMutate={vi.fn()} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('passes an onError to the delete mutation and shows the server\'s message when archiving fails', async () => {
    const deleteMutate = vi.fn((_id: string, options?: MutateOptions) => options?.onError?.(apiError('Alex has upcoming shifts.')))
    const user = userEvent.setup()
    render(<Harness deleteMutate={deleteMutate} />)

    await archive(user)

    expect(deleteMutate).toHaveBeenCalledTimes(1)
    expect(deleteMutate).toHaveBeenCalledWith('a1', { onError: expect.any(Function) })
    expect(screen.getByRole('alert')).toHaveTextContent('Alex has upcoming shifts.')
  })

  it('names the item in a fallback message when the failure has no server text', async () => {
    const deleteMutate = vi.fn((_id: string, options?: MutateOptions) => options?.onError?.(new Error('Network Error')))
    const user = userEvent.setup()
    render(<Harness deleteMutate={deleteMutate} />)

    await archive(user)

    expect(screen.getByRole('alert')).toHaveTextContent('Could not archive "Alex Rivera". Please try again.')
  })

  it('passes an onError to the restore mutation and shows the server\'s message when restoring fails', async () => {
    const restoreMutate = vi.fn((_args: { id: string; data: unknown }, options?: MutateOptions) => options?.onError?.(apiError('Participant not found')))
    const user = userEvent.setup()
    render(<Harness deleteMutate={vi.fn()} restoreMutate={restoreMutate} />)

    await restore(user)

    expect(restoreMutate).toHaveBeenCalledTimes(1)
    expect(restoreMutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), { onError: expect.any(Function) })
    expect(screen.getByRole('alert')).toHaveTextContent('Participant not found')
  })

  it('names the item in the restore fallback message', async () => {
    const restoreMutate = vi.fn((_args: { id: string; data: unknown }, options?: MutateOptions) => options?.onError?.(undefined))
    const user = userEvent.setup()
    render(<Harness deleteMutate={vi.fn()} restoreMutate={restoreMutate} />)

    await restore(user)

    expect(screen.getByRole('alert')).toHaveTextContent('Could not restore "Alex Rivera". Please try again.')
  })

  it('lets the message be dismissed', async () => {
    const deleteMutate = vi.fn((_id: string, options?: MutateOptions) => options?.onError?.(apiError('Alex has upcoming shifts.')))
    const user = userEvent.setup()
    render(<Harness deleteMutate={deleteMutate} />)
    await archive(user)

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears the previous message when the next attempt starts, so a retry that works leaves no stale error', async () => {
    const deleteMutate = vi.fn()
      .mockImplementationOnce((_id: string, options?: MutateOptions) => options?.onError?.(apiError('Alex has upcoming shifts.')))
      .mockImplementationOnce(() => undefined)
    const user = userEvent.setup()
    render(<Harness deleteMutate={deleteMutate} />)

    await archive(user)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await archive(user)

    expect(deleteMutate).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears the message when the view is switched, so an Archived-view failure does not linger on the Active list', async () => {
    const restoreMutate = vi.fn((_args: { id: string; data: unknown }, options?: MutateOptions) => options?.onError?.(apiError('Participant not found')))
    const user = userEvent.setup()
    render(<Harness deleteMutate={vi.fn()} restoreMutate={restoreMutate} />)
    await restore(user)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Active' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('useArchiveRestore — what a restore sends', () => {
  it('sends the row with isActive: true by default (the existing contract for Staff)', async () => {
    const restoreMutate = vi.fn()
    const user = userEvent.setup()
    render(<Harness deleteMutate={vi.fn()} restoreMutate={restoreMutate} />)

    await restore(user)

    expect(restoreMutate.mock.calls[0][0]).toEqual({ id: 'a1', data: { ...item, isActive: true } })
  })

  it('sends whatever restoreData returns, so a screen can send an empty body instead of its list row', async () => {
    const restoreMutate = vi.fn()
    const user = userEvent.setup()
    render(<Harness deleteMutate={vi.fn()} restoreMutate={restoreMutate} restoreData={() => ({})} />)

    await restore(user)

    expect(restoreMutate.mock.calls[0][0]).toEqual({ id: 'a1', data: {} })
  })
})
