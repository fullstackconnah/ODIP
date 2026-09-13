import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import NotificationPreferencesTab from './NotificationPreferencesTab'
import type { NotificationPreferenceGridDto } from '@/api/types'

const { mockUseNotificationPreferences, mockUseUpdateNotificationPreferences, mockMutate } = vi.hoisted(() => ({
  mockUseNotificationPreferences: vi.fn(),
  mockUseUpdateNotificationPreferences: vi.fn(),
  mockMutate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useNotificationPreferences: mockUseNotificationPreferences,
  useUpdateNotificationPreferences: mockUseUpdateNotificationPreferences,
}))

// NotificationPreferencesTab calls useUnsavedChangesWarning, which uses react-router 7's
// useBlocker — that throws under a plain declarative <MemoryRouter>/<Routes>, so this needs a
// data router (same pattern SettingsPage.test.tsx documents for PP-77).
function renderTab() {
  const router = createMemoryRouter(
    [
      { path: '/settings', element: <NotificationPreferencesTab /> },
      { path: '/elsewhere', element: <div>Elsewhere page</div> },
    ],
    { initialEntries: ['/settings'] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

function makeGrid(overrides: Partial<Record<string, boolean>> = {}): NotificationPreferenceGridDto {
  const eventTypes = [
    'LeaveRequestSubmitted', 'LeaveRequestDecided', 'ShiftAssigned',
    'ShiftCompletionPendingReview', 'ShiftCompletionReturned', 'WitnessRequested',
    'CaregiverSubmissionReceived', 'IncidentReported', 'ServiceAgreementSent',
    'ServiceAgreementSigned', 'IntegrationDegraded',
  ] as const
  return {
    rows: eventTypes.flatMap(eventType => ([
      { eventType, channel: 'Email' as const, enabled: overrides[eventType] ?? true },
      { eventType, channel: 'Sms' as const, enabled: true },
    ])),
  }
}

beforeEach(() => {
  mockUseNotificationPreferences.mockReset()
  mockUseUpdateNotificationPreferences.mockReset()
  mockMutate.mockReset()
  mockUseUpdateNotificationPreferences.mockReturnValue({ mutate: mockMutate, isPending: false })
})

describe('NotificationPreferencesTab', () => {
  it('shows a loading state while preferences are fetching', () => {
    mockUseNotificationPreferences.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    renderTab()

    expect(screen.getByRole('status')).toHaveTextContent(/loading notification preferences/i)
  })

  it('renders every event type as a row, with SMS always disabled', () => {
    mockUseNotificationPreferences.mockReturnValue({ data: makeGrid(), isLoading: false, isError: false })
    renderTab()

    expect(screen.getByText('Leave request submitted')).toBeInTheDocument()
    expect(screen.getByText('Incident reported')).toBeInTheDocument()
    expect(screen.getByText('Integration degraded')).toBeInTheDocument()

    const smsCheckboxes = screen.getAllByLabelText(/^SMS —/)
    expect(smsCheckboxes.length).toBeGreaterThan(0)
    for (const checkbox of smsCheckboxes) {
      expect(checkbox).toBeDisabled()
    }
    expect(screen.getAllByText(/not available yet/i).length).toBe(smsCheckboxes.length)
  })

  it('toggling an Email checkbox and saving calls the update mutation with the right payload', async () => {
    mockUseNotificationPreferences.mockReturnValue({ data: makeGrid(), isLoading: false, isError: false })
    mockMutate.mockImplementation((_payload, opts) => opts?.onSuccess?.(makeGrid({ LeaveRequestSubmitted: false })))
    const user = userEvent.setup()
    renderTab()

    const saveButton = screen.getByRole('button', { name: /save preferences/i })
    expect(saveButton).toBeDisabled()

    await user.click(screen.getByLabelText('Email — Leave request submitted'))
    expect(saveButton).toBeEnabled()

    await user.click(saveButton)

    expect(mockMutate).toHaveBeenCalledTimes(1)
    const [payload] = mockMutate.mock.calls[0]
    expect(payload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: 'LeaveRequestSubmitted', channel: 'Email', enabled: false }),
      ]),
    )
    expect(payload.every((row: { channel: string }) => row.channel === 'Email')).toBe(true)
  })

  it('shows the 400 message inline when the update is rejected', async () => {
    mockUseNotificationPreferences.mockReturnValue({ data: makeGrid(), isLoading: false, isError: false })
    mockMutate.mockImplementation((_payload, opts) => {
      opts?.onError?.({ response: { status: 400, data: { errors: ['Unknown event type or channel.'] } } })
    })
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByLabelText('Email — Leave request submitted'))
    await user.click(screen.getByRole('button', { name: /save preferences/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/unknown event type or channel/i)
  })
})
