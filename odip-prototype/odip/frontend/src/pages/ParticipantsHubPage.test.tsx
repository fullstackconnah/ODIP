import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ParticipantsHubPage from './ParticipantsHubPage'

// Mock the three lifecycle hooks so we exercise the hub's tab-switching layout without
// driving the real query/mutation endpoints.
const { mockUseParticipants, mockUseParticipantInquiries } = vi.hoisted(() => ({
  mockUseParticipants: vi.fn(),
  mockUseParticipantInquiries: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useParticipants: mockUseParticipants,
  useDeleteParticipant: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateParticipant: () => ({ mutate: vi.fn(), isPending: false }),
  useParticipantAlertsAggregate: () => ({ data: [], isLoading: false }),
  useParticipantInquiries: mockUseParticipantInquiries,
  useCreateParticipantInquiry: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateParticipantInquiry: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useConvertParticipantInquiry: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}))

/** Exposes the router's live location so tests can assert the tab is reflected in the URL. */
function LocationProbe({ onChange }: { onChange: (value: string) => void }) {
  const { pathname, search } = useLocation()
  onChange(`${pathname}${search}`)
  return null
}

function renderHub(initialPath = '/participants') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  let location = initialPath
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe onChange={value => { location = value }} />
        <Routes>
          <Route path="/participants" element={<ParticipantsHubPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, location: { get current() { return location } } }
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  mockUseParticipants.mockReturnValue({ data: [], isLoading: false })
  mockUseParticipantInquiries.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
})

afterEach(() => {
  cleanup()
  document.title = ''
  localStorage.clear()
  vi.clearAllMocks()
})

describe('ParticipantsHubPage — single PageHeader + tabbed lifecycle', () => {
  it('renders exactly one <h1> regardless of which tab is open', async () => {
    const user = userEvent.setup()
    renderHub()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await user.click(screen.getByRole('tab', { name: 'Onboarding' }))
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await user.click(screen.getByRole('tab', { name: 'Active participants' }))
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('shows the Active participants panel by default and switches panels when a tab is clicked', async () => {
    const user = userEvent.setup()
    renderHub()
    const tablist = screen.getByRole('tablist', { name: 'Lifecycle stages' })
    // Active participants tab is active on first render — that's the default for /participants.
    expect(within(tablist).getByRole('tab', { name: 'Active participants' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/No participants yet/i)

    await user.click(within(tablist).getByRole('tab', { name: 'Enquiries' }))
    expect(within(tablist).getByRole('tab', { name: 'Enquiries' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/enquir/i)
  })

  it('tabs are in the order Enquiries → Onboarding → Active participants', () => {
    renderHub()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual(['Enquiries', 'Onboarding', 'Active participants'])
  })

  it('updates the document title when the active tab changes', async () => {
    const user = userEvent.setup()
    renderHub()
    // Default tab is Active participants — that's also the document title.
    expect(document.title).toBe('Active participants — Odip')
    await user.click(screen.getByRole('tab', { name: 'Enquiries' }))
    expect(document.title).toBe('Enquiries — Odip')
    await user.click(screen.getByRole('tab', { name: 'Onboarding' }))
    expect(document.title).toBe('Onboarding — Odip')
  })

  it('mirrors the active tab into the URL so a stage is shareable, and drops ?tab= on the default', async () => {
    const user = userEvent.setup()
    const { location } = renderHub()
    await user.click(screen.getByRole('tab', { name: 'Enquiries' }))
    await waitFor(() => expect(location.current).toContain('tab=enquiries'))
    // Switching to the default tab removes the param entirely so /participants stays clean.
    await user.click(screen.getByRole('tab', { name: 'Active participants' }))
    await waitFor(() => expect(location.current).toBe('/participants'))
  })

  it('opens the stage named by ?tab= when the hub is deep-linked', () => {
    renderHub('/participants?tab=onboarding')
    expect(screen.getByRole('tab', { name: 'Onboarding' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Active participants' })).toHaveAttribute('aria-selected', 'false')
  })

  it('ignores an unknown ?tab= value and falls back to Active participants', () => {
    renderHub('/participants?tab=not-a-stage')
    expect(screen.getByRole('tab', { name: 'Active participants' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the New enquiry button in the PageHeader action slot on every tab for lifecycle roles', async () => {
    const user = userEvent.setup()
    renderHub()
    // Visible on the default Active participants tab.
    expect(screen.getByRole('link', { name: /New enquiry/i })).toHaveAttribute('href', '/participants/new-inquiry')
    // Visible on Enquiries.
    await user.click(screen.getByRole('tab', { name: 'Enquiries' }))
    expect(screen.getByRole('link', { name: /New enquiry/i })).toHaveAttribute('href', '/participants/new-inquiry')
    // Visible on Onboarding.
    await user.click(screen.getByRole('tab', { name: 'Onboarding' }))
    expect(screen.getByRole('link', { name: /New enquiry/i })).toHaveAttribute('href', '/participants/new-inquiry')
  })

  it('hides the New enquiry button for roles that lack the lifecycle capability', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    renderHub()
    expect(screen.queryByRole('link', { name: /New enquiry/i })).not.toBeInTheDocument()
  })
})

// Density verdict: the header block was ~136px before the first row because the stage's description
// sat in its own row inside the panel, under a generic subtitle that restated the tab labels.
describe('ParticipantsHubPage — one description line, not two', () => {
  const ACTIVE = 'The operational register — participants you can roster and book.'
  const ENQUIRIES = 'Lightweight capture of new prospects before intake.'

  it('shows the active stage\'s description once, as the inline subtitle beside the H1', () => {
    renderHub()

    const h1 = screen.getByRole('heading', { level: 1, name: 'Participants' })
    expect(screen.getAllByText(ACTIVE)).toHaveLength(1)
    expect(h1.parentElement).toContainElement(screen.getByText(ACTIVE))
    // The generic subtitle that repeated the three tab labels is gone.
    expect(screen.queryByText(/one view, three stages/i)).not.toBeInTheDocument()
  })

  it('opens the panel straight onto its table: no description paragraph inside it', () => {
    renderHub()

    const panel = screen.getByRole('tabpanel')
    expect(within(panel).queryByText(ACTIVE)).not.toBeInTheDocument()
    // The empty state is the panel's first content now, not a paragraph the hub put above it.
    expect(panel).toHaveTextContent(/No participants yet/i)
    expect(panel.firstElementChild?.tagName).not.toBe('P')
  })

  it('swaps the subtitle with the stage, still a single line', async () => {
    const user = userEvent.setup()
    renderHub()

    await user.click(screen.getByRole('tab', { name: 'Enquiries' }))
    expect(screen.getByText(ENQUIRIES)).toBeInTheDocument()
    expect(screen.queryByText(ACTIVE)).not.toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).queryByText(ENQUIRIES)).not.toBeInTheDocument()
  })

  it('keeps the title row and the tab strip in one block-flow wrapper, with no section gap between them', () => {
    renderHub()

    const h1 = screen.getByRole('heading', { level: 1, name: 'Participants' })
    const tablist = screen.getByRole('tablist', { name: 'Lifecycle stages' })
    const root = tablist.closest('.animate-fade-in') as HTMLElement
    expect(root).toContainElement(h1)
    // Plain block flow: a flex column with a section gap is what opened 16px between the two.
    expect(root.className).toBe('animate-fade-in')
  })
})
