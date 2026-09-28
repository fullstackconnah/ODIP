import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

describe('ParticipantsPage — status change safety', () => {
  it('renders the status pill as a read-only display, not an interactive control', () => {
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', isActive: true })],
      isLoading: false,
    })
    renderPage()

    // The Status cell shows the literal label and an accessible name, with no button/select.
    // Scope the queries to the row so the page-level Active/Inactive/Archived toggle
    // doesn't trip the "multiple elements" matcher.
    const rows = screen.getAllByRole('row')
    const jamieRow = rows.find(r => r.textContent?.includes('Jamie Smith'))!
    expect(within(jamieRow).getByText('Active')).toBeInTheDocument()
    expect(within(jamieRow).getByLabelText('Status: Active')).toBeInTheDocument()
    expect(within(jamieRow).queryByRole('combobox', { name: /active/i })).not.toBeInTheDocument()
    expect(within(jamieRow).queryByRole('button', { name: /^active$/i })).not.toBeInTheDocument()
    // The pill itself must not be a button.
    expect(within(jamieRow).queryByRole('button', { name: /status: active/i })).not.toBeInTheDocument()
  })

  it('opens a confirmation dialog that names the participant and the target status, and mutates only on confirm', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', isActive: true })],
      isLoading: false,
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /change status for jamie smith/i }))

    // The dialog names the participant, the current state and the consequence.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    const dialog = screen.getByRole('alertdialog')
    // The title is exposed via aria-labelledby and the body message splits across nested spans,
    // so use the alertdialog's accessible name + textContent to assert the full copy.
    expect(dialog).toHaveAccessibleName(/Set Jamie Smith as Inactive/i)
    expect(dialog.textContent).toMatch(/Change\s+Jamie Smith.*status\s+from\s+Active\s+to\s+Inactive/is)

    // The confirm button is not the default "Confirm" — it names the action and the person.
    const confirmBtn = screen.getByRole('button', { name: /set jamie smith as inactive/i })
    expect(confirmBtn).toHaveTextContent(/Set as Inactive/i)

    await user.click(confirmBtn)

    // Exactly one mutation, with the full participant payload and the flipped flag.
    expect(mockUpdateMutate).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutate).toHaveBeenCalledWith({
      id: 'p1',
      data: { isActive: false },
    })
    // Cancel-style false positives: must not mutate on Cancel and must not mutate the
    // archive/restore path.
    expect(mockDeleteMutate).not.toHaveBeenCalled()
  })

  it('cancelling the confirmation does not mutate', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', isActive: true })],
      isLoading: false,
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /change status for jamie smith/i }))
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(mockUpdateMutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('hides the change-status button for read-only roles', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', isActive: true })],
      isLoading: false,
    })
    renderPage()

    expect(screen.queryByRole('button', { name: /change status for jamie smith/i })).not.toBeInTheDocument()
    // The status pill itself is still shown for everyone.
    const rows2 = screen.getAllByRole('row')
    const jamieRow2 = rows2.find(r => r.textContent?.includes('Jamie Smith'))!
    expect(within(jamieRow2).getByText('Active')).toBeInTheDocument()
  })

  it('flipping the wrong row never changes a different participant', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({
      data: [
        baseParticipant({ id: 'p1', fullName: 'Jamie Smith', isActive: true }),
        baseParticipant({ id: 'p2', fullName: 'Alex Rivera', isActive: true }),
      ],
      isLoading: false,
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /change status for alex rivera/i }))
    await user.click(screen.getByRole('button', { name: /set alex rivera as inactive/i }))

    expect(mockUpdateMutate).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutate).toHaveBeenCalledWith({
      id: 'p2',
      data: { isActive: false },
    })
  })

  it('no longer navigates when clicking the Status cell itself (row click target is the Name link, not the whole row)', async () => {
    const user = userEvent.setup()
    mockUseParticipants.mockReturnValue({
      data: [baseParticipant({ id: 'p1', fullName: 'Jamie Smith', isActive: true })],
      isLoading: false,
    })
    renderPage()

    // Clicking the Status cell (the read-only pill) must not navigate nor mutate.
    const rows3 = screen.getAllByRole('row')
    const jamieRow3 = rows3.find(r => r.textContent?.includes('Jamie Smith'))!
    await user.click(within(jamieRow3).getByText('Active'))

    expect(screen.queryByText('Participant detail page')).not.toBeInTheDocument()
    expect(mockUpdateMutate).not.toHaveBeenCalled()
  })
})
