import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { OnboardingTable } from './OnboardingPage'

// A REAL QueryClient: while a failed worklist retries, TanStack reports it as loading with no error. queryPhase says 'error' for that, so a screen
// that derived "loading" from queryPhase alone fell through to its empty state ("No participants in onboarding") during the retry.
const { fetcher } = vi.hoisted(() => ({ fetcher: vi.fn<() => Promise<unknown>>() }))
vi.mock('@/api/hooks', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return { useOnboardingWorklist: () => useQuery({ queryKey: ['onboarding'], queryFn: () => fetcher(), retry: false }) }
})

it('shows no empty state while a failed worklist is being retried', async () => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  fetcher.mockRejectedValueOnce(new Error('offline'))
  const client = new QueryClient()
  render(<QueryClientProvider client={client}><MemoryRouter><OnboardingTable /></MemoryRouter></QueryClientProvider>)
  await screen.findByText(/Could not load the onboarding worklist|offline/)

  fetcher.mockReturnValueOnce(new Promise(() => {}))
  await act(async () => { void client.refetchQueries({ queryKey: ['onboarding'] }); await new Promise(r => setTimeout(r, 10)) })
  expect(screen.queryByText('No participants in onboarding')).not.toBeInTheDocument()
})
