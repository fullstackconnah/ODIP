import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import IntakeWizardPage from './IntakeWizardPage'

// Only the API client is mocked: the real hooks and a real QueryClient drive the refetch.
const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))
vi.mock('@/api/client', () => ({
  apiGet: mockGet, apiPostRaw: vi.fn(), apiPutRaw: vi.fn(), apiPatchRaw: vi.fn(), apiDeleteRaw: vi.fn(),
  apiPost: vi.fn(), apiPut: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(), apiGetWithDefault: vi.fn(),
}))

const participant = (over: Record<string, unknown> = {}) => ({
  id: 'p-1', firstName: 'Jamie', lastName: 'Rivers', isDraft: true, intakeCompletedAt: null,
  ndisNumber: 'NDIS-777', planType: 'SelfManaged', fundingSource: 'Ndis', isRepeatClient: false,
  serviceStreams: '', mobilityAidWheelchair: false, mobilityAidWalker: false, isHighSupport: false,
  isIntensiveSupport: false, overnightSupport: 'None', overnightRatio: 'OneToOne',
  requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false,
  requiresStandingMachine: false, supportRatio: 'SharedSupport', preferredName: 'Jay', ...over,
})

let client: QueryClient
const serve = (p: Record<string, unknown>) =>
  mockGet.mockImplementation(async (url: string) => (url === '/participants/p-1' ? p : []))

function renderEdit() {
  const router = createMemoryRouter([
    { path: '/participants/:id/intake', element: <IntakeWizardPage /> },
    { path: '/participants', element: <div>Participants list</div> },
  ], { initialEntries: ['/participants/p-1/intake'] })
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}
const refetch = () => client.invalidateQueries({ queryKey: ['participant', 'p-1'] })

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockGet.mockReset()
  serve(participant())
})

describe('IntakeWizardPage — a refetch while editing a draft', () => {
  it('keeps the typed first name and still takes the changed server value', async () => {
    const user = userEvent.setup()
    renderEdit()
    const first = await screen.findByLabelText(/first name/i)
    await waitFor(() => expect(first).toHaveValue('Jamie'))
    await user.clear(first)
    await user.type(first, 'Jamison')

    serve(participant({ preferredName: 'Jai' }))
    await refetch()

    await waitFor(() => expect(screen.getByLabelText(/preferred name/i)).toHaveValue('Jai'))
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Jamison')
  })

  it('keeps a contact row added before the refetch', async () => {
    const user = userEvent.setup()
    renderEdit()
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toHaveValue('Jamie'))
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await within(screen.getByRole('navigation', { name: /intake wizard steps/i }))
      .findByRole('button', { name: /contacts/i, current: 'step' })
    await user.click(screen.getByRole('button', { name: /add contact/i }))
    expect(await screen.findByRole('checkbox', { name: 'Primary contact' })).toBeInTheDocument()

    const calls = mockGet.mock.calls.length
    serve(participant({ preferredName: 'Jai' }))
    await refetch()
    await waitFor(() => expect(mockGet.mock.calls.length).toBeGreaterThan(calls))
    // let the refetched participant reach the reset effect
    await new Promise(r => setTimeout(r, 50))

    expect(screen.getByRole('checkbox', { name: 'Primary contact' })).toBeInTheDocument()
  })

  it('takes a changed server value when nothing has been typed', async () => {
    renderEdit()
    await waitFor(() => expect(screen.getByLabelText(/preferred name/i)).toHaveValue('Jay'))

    serve(participant({ firstName: 'Jules', preferredName: 'Jai' }))
    await refetch()

    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toHaveValue('Jules'))
    expect(screen.getByLabelText(/preferred name/i)).toHaveValue('Jai')
  })
})
