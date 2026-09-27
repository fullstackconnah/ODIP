import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ParticipantsPage from './ParticipantsPage'

const { mockUseParticipants, mockDeleteMutate, mockUpdateMutate, mockUseParticipantAlertsAggregate } = vi.hoisted(() => ({
  mockUseParticipants: vi.fn(),
  mockDeleteMutate: vi.fn(),
  mockUpdateMutate: vi.fn(),
  mockUseParticipantAlertsAggregate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useParticipants: mockUseParticipants,
  useDeleteParticipant: () => ({ mutate: mockDeleteMutate, isPending: false }),
  useUpdateParticipant: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useParticipantAlertsAggregate: mockUseParticipantAlertsAggregate,
}))

function baseParticipant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    fullName: 'Jamie Smith',
    maskedNdisNumber: null,
    ndisNumber: null,
    planType: 'SelfManaged',
    region: 'QLD',
    mobilityAidWheelchair: false,
    isHighSupport: false,
    supportRatio: 'SharedSupport',
    isRepeatClient: false,
    isActive: true,
    serviceStreams: 'None',
    hasActiveMedications: false,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/participants']}>
      <Routes>
        <Route path="/participants" element={<ParticipantsPage />} />
        <Route path="/participants/:id" element={<div>Participant detail page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  mockUseParticipants.mockReturnValue({ data: [], isLoading: false })
  mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
})

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('ParticipantsPage — service stream badges', () => {
  it('renders stream badges for a tagged participant', () => {
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ serviceStreams: 'STA, Trip' })],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('STA')).toBeInTheDocument()
    expect(screen.getByText('Trip')).toBeInTheDocument()
  })

  it('renders a dash placeholder for an untagged participant', () => {
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ serviceStreams: 'None' })],
      isLoading: false,
    })
    renderPage()

    // The NDIS Number column also renders a dash for a null number, so scope to "at least one".
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText('STA')).not.toBeInTheDocument()
  })
})

describe('ParticipantsPage — medication quick button', () => {
  it('is shown only for a participant with active medications, and navigates to their medications tab', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({
      data: [
        baseParticipant({ id: 'p1', fullName: 'Jamie Smith', hasActiveMedications: true }),
        baseParticipant({ id: 'p2', fullName: 'Alex Rivera', hasActiveMedications: false }),
      ],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByRole('button', { name: /view medications for jamie smith/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /view medications for alex rivera/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /view medications for jamie smith/i }))

    // Navigated to the participant-scoped medications view, not the row's own detail-page click.
    expect(screen.getByText('Participant detail page')).toBeInTheDocument()
  })
})

describe('ParticipantsPage — alerts badge column', () => {
  it('renders critical and warning counts from the aggregate endpoint, keyed by participant id', () => {
    mockUseParticipants.mockReturnValue({
      data: [
        baseParticipant({ id: 'p1', fullName: 'Jamie Smith' }),
        baseParticipant({ id: 'p2', fullName: 'Alex Rivera' }),
      ],
      isLoading: false,
    })
    mockUseParticipantAlertsAggregate.mockReturnValue({
      data: [
        {
          participantId: 'p1', participantName: 'Jamie Smith', isActive: true,
          alerts: [{ type: 'plan-expired', severity: 'Critical', message: 'Plan expired', deepLinkTab: 'details', linkTo: null }],
          criticalCount: 1, warningCount: 0, infoCount: 0,
        },
        {
          participantId: 'p2', participantName: 'Alex Rivera', isActive: true,
          alerts: [],
          criticalCount: 0, warningCount: 0, infoCount: 0,
        },
      ],
      isLoading: false,
    })
    renderPage()

    // One row has a Critical badge (count 1); the other shows the empty-state dash.
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('does not fetch or render the alerts column when the hook is not enabled (e.g. non-coordinator role)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    mockUseParticipants.mockReturnValue({ data: [baseParticipant()], isLoading: false })
    renderPage()

    expect(screen.queryByText('Alerts')).not.toBeInTheDocument()
  })

  it('renders an Info badge for a participant whose only alerts are Info severity (previously fell through to a blank cell)', () => {
    // Give the row a real NDIS number and a tagged service stream so those columns' own
    // unrelated dash placeholders (for a null number / 'None' streams) can't be confused with
    // the alerts column's dash.
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', ndisNumber: '430123456', serviceStreams: 'STA' })],
      isLoading: false,
    })
    mockUseParticipantAlertsAggregate.mockReturnValue({
      data: [
        {
          participantId: 'p1', participantName: 'Jamie Smith', isActive: true,
          alerts: [{ type: 'note-reminder', severity: 'Info', message: 'Support plan review due soon', deepLinkTab: 'support', linkTo: null }],
          criticalCount: 0, warningCount: 0, infoCount: 1,
        },
      ],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('shows a loading placeholder rather than the "no alerts" dash while the aggregate is still fetching', () => {
    // Give the row a real NDIS number and a tagged service stream so those columns' own
    // unrelated dash placeholders (for a null number / 'None' streams) can't be confused with
    // the alerts column's dash.
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', ndisNumber: '430123456', serviceStreams: 'STA' })],
      isLoading: false,
    })
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: undefined, isLoading: true })
    renderPage()

    // No dash yet — that would falsely assert "no alerts" before the request has resolved.
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })
})

describe('ParticipantsPage — operational register stage boundary', () => {
  it('does not render a client-side Draft control because incomplete records belong to Onboarding', () => {
    mockUseParticipants.mockReturnValue({ data: [baseParticipant()], isLoading: false })
    renderPage()

    expect(screen.queryByRole('radio', { name: 'Drafts' })).not.toBeInTheDocument()
  })

  it('requests the server-owned operational stage predicate as well as non-drafts', () => {
    mockUseParticipants.mockReturnValue({ data: [baseParticipant()], isLoading: false })
    renderPage()

    expect(mockUseParticipants).toHaveBeenLastCalledWith(expect.objectContaining({
      isDraft: 'false',
      operationalOnly: 'true',
    }))
  })

  it('renders legacy records returned by the server while incomplete onboarding records are absent', () => {
    mockUseParticipants.mockReturnValue({ data: [baseParticipant({ fullName: 'Legacy visible participant' })], isLoading: false })
    renderPage()

    expect(screen.getByText('Legacy visible participant')).toBeInTheDocument()
    expect(screen.queryByText('Incomplete onboarding participant')).not.toBeInTheDocument()
  })
})

describe('ParticipantsPage — row click', () => {
  it('still navigates to the participant detail page (no regression)', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({ data: [baseParticipant()], isLoading: false })
    renderPage()

    await user.click(screen.getByText('Jamie Smith'))

    expect(screen.getByText('Participant detail page')).toBeInTheDocument()
  })
})
