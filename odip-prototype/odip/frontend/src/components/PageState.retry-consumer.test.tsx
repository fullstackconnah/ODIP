import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import WorkspaceVisibilitySection from '@/pages/settings/WorkspaceVisibilitySection'

const { refetch } = vi.hoisted(() => ({ refetch: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useModuleVisibility: () => ({ data: undefined, isError: true, isFetching: false, refetch }),
  useUpdateModuleVisibility: () => ({ mutate: vi.fn(), isPending: false }),
}))

it('the settings retry preserves the request so PageState holds and releases its action', async () => {
  let reject!: (error: Error) => void
  refetch.mockReturnValue(new Promise<void>((_resolve, no) => { reject = no }))
  render(<MemoryRouter><WorkspaceVisibilitySection title="Workspace visibility" description="Choose the menu." readOnly={false} focusOnMount={false} /></MemoryRouter>)
  const retry = screen.getByRole('button', { name: 'Try again' })
  fireEvent.click(retry)
  expect(retry).toHaveAttribute('aria-disabled', 'true')
  expect(retry).toHaveAttribute('aria-busy', 'true')
  fireEvent.click(retry)
  expect(refetch).toHaveBeenCalledTimes(1)
  await act(async () => { reject(new Error('synthetic offline')) })
  expect(retry).not.toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this workspace visibility settings.")
  expect(screen.getByRole('status')).toHaveTextContent('Try again')
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
})
