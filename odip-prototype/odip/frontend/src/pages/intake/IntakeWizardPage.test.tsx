import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import IntakeWizardPage from './IntakeWizardPage'

const { mockCreate, mockUpdate, mockSave, mockParticipant } = vi.hoisted(() => ({
  mockCreate: vi.fn(), mockUpdate: vi.fn(), mockSave: vi.fn(), mockParticipant: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useCreateParticipant: () => ({ mutateAsync: mockCreate, isPending: false, isError: false }),
  useUpdateParticipant: () => ({ mutateAsync: mockUpdate, isPending: false, isError: false }),
  useSaveParticipantIntake: () => ({ mutateAsync: mockSave, isPending: false, isError: false }),
  useParticipantIntakeSnapshots: () => ({ data: [], refetch: vi.fn() }),
  useDownloadParticipantIntakeSnapshotPdf: () => ({ mutate: vi.fn(), isPending: false }),
  useParticipant: mockParticipant,
  useParticipantContactRoles: () => ({ data: [] }),
  useParticipantRiskEntries: () => ({ data: [] }),
  usePersons: () => ({ data: [] }),
}))

function renderPage(path = '/participants/new') {
  const router = createMemoryRouter([
    { path: '/participants/new', element: <IntakeWizardPage /> },
    { path: '/participants/:id/intake', element: <IntakeWizardPage /> },
    { path: '/participants/:id', element: <div>Participant detail</div> },
    { path: '/participants/:id/profile', element: <div>Profile wizard</div> },
  ], { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1', firstName: 'Jamie', lastName: 'Rivers', isDraft: true, intakeCompletedAt: null,
    ndisNumber: 'NDIS-777', planType: 'SelfManaged', fundingSource: 'Ndis', isRepeatClient: false,
    serviceStreams: '', mobilityAidWheelchair: false, mobilityAidWalker: false, isHighSupport: false,
    isIntensiveSupport: false, overnightSupport: 'None', overnightRatio: 'OneToOne',
    requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false,
    requiresStandingMachine: false, supportRatio: 'SharedSupport', ...overrides,
  }
}

beforeEach(() => {
  mockCreate.mockReset(); mockCreate.mockResolvedValue({ success: true, data: { id: 'new-participant-1' } })
  mockUpdate.mockReset(); mockUpdate.mockResolvedValue({ success: true })
  mockSave.mockReset(); mockSave.mockResolvedValue({ success: true })
  mockParticipant.mockReset(); mockParticipant.mockReturnValue({ data: undefined, isLoading: false })
})

describe('IntakeWizardPage', () => {
  it('renders the create wizard with no profile-only identity fields', () => {
    renderPage()
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/middle name/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^gender$/i)).not.toBeInTheDocument()
  })

  it('blocks create-mode progression until required participant names are supplied', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(await screen.findByText(/first name is required/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/first name/i), 'Jamie')
    await user.type(screen.getByLabelText(/last name/i), 'Rivers')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(await screen.findByRole('button', { name: /ndis & funding/i, current: 'step' })).toBeInTheDocument()
  })

  it('routes an inquiry-converted edit mode to the narrowed form with its required hooks mocked', () => {
    mockParticipant.mockReturnValue({ data: draft(), isLoading: false })
    renderPage('/participants/draft-1/intake')
    expect(screen.getByRole('heading', { name: /^complete intake$/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Jamie')
    expect(screen.getByLabelText(/primary diagnosis/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/ndis number/i)).not.toBeInTheDocument()
  })

  it('saves an inquiry-converted edit through the narrowed endpoint, never a full profile update', async () => {
    const user = userEvent.setup()
    mockParticipant.mockReturnValue({ data: draft(), isLoading: false })
    renderPage('/participants/draft-1/intake')
    await user.clear(screen.getByLabelText(/medical summary/i))
    await user.type(screen.getByLabelText(/medical summary/i), 'Synthetic update')
    await user.click(screen.getByRole('button', { name: /save incomplete intake/i }))
    expect(mockSave).toHaveBeenCalledWith({
      id: 'draft-1',
      data: expect.objectContaining({ firstName: 'Jamie', lastName: 'Rivers', medicalSummary: 'Synthetic update' }),
    })
    expect(mockSave.mock.calls[0][0].data).not.toHaveProperty('isActive')
    expect(mockSave.mock.calls[0][0].data).not.toHaveProperty('ndisNumber')
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
