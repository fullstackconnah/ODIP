import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import WorkspaceVisibilitySection from '@/pages/settings/WorkspaceVisibilitySection'
import { PageState } from '@/components/PageState'
import { queryPhase } from '@/lib/queryPhase'

// A REAL QueryClient and useQuery with a failing queryFn: no mocked refetch. TanStack sets status 'pending' (isError false, isLoading true) the moment a
// refetch of a no-data query starts, so a caller that tests isError unmounted the banner and its focus; and refetch() RESOLVES on failure.
const { fetcher } = vi.hoisted(() => ({ fetcher: vi.fn<() => Promise<unknown>>() }))
vi.mock('@/api/hooks', async () => {
  const { useQuery: real } = await import('@tanstack/react-query')
  return {
    useModuleVisibility: () => real({ queryKey: ['visibility'], queryFn: () => fetcher(), retry: false }),
    useUpdateModuleVisibility: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

function deferredFailure() {
  let reject!: (error: Error) => void
  fetcher.mockReturnValueOnce(new Promise((_yes, no) => { reject = no }))
  return reject
}

async function mountFailed(ui: React.ReactElement) {
  fetcher.mockRejectedValueOnce(new Error('offline'))
  const client = new QueryClient()
  render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
  const retry = await screen.findByRole('button', { name: 'Try again' })
  retry.focus()
  return retry
}

async function expectRetryKeepsTheButton(retry: HTMLElement) {
  const failAgain = deferredFailure()
  fireEvent.click(retry)
  // Let the observer's batched notification render the in-flight state, as a real network delay does, before the request fails.
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry)
  expect(retry).toBeInTheDocument()
  expect(retry).toHaveFocus()
  expect(retry).toHaveAttribute('aria-disabled', 'true')
  expect(retry).toHaveAttribute('aria-busy', 'true')
  fireEvent.click(retry)
  expect(fetcher).toHaveBeenCalledTimes(2)
  await act(async () => { failAgain(new Error('still offline')) })
  await waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled', 'true'))
  expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry)
  expect(retry).toHaveFocus()
  expect(screen.getByRole('status')).toHaveTextContent("Couldn't load it again.")
}

it('a settings caller that tests isError keeps the same focused button through a real failing retry', async () => {
  fetcher.mockReset()
  const retry = await mountFailed(<WorkspaceVisibilitySection title="Workspace visibility" description="Choose the menu." readOnly={false} focusOnMount={false} />)
  await expectRetryKeepsTheButton(retry)
})

it('a caller that uses queryPhase keeps the same focused button through a real failing retry', async () => {
  fetcher.mockReset()
  function Consumer() {
    const q = useQuery({ queryKey: ['phase'], queryFn: () => fetcher(), retry: false })
    const phase = queryPhase(q)
    return phase === 'error' ? <PageState kind="error" noun="things" onRetry={() => q.refetch()} /> : <p>{phase}</p>
  }
  const retry = await mountFailed(<Consumer />)
  await expectRetryKeepsTheButton(retry)
})
