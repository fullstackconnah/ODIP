import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import NotificationPreferencesTab from './NotificationPreferencesTab'
import { NOTIFICATION_EVENT_TYPE_GROUPS, type NotificationPreferenceGridDto } from '@/api/types'

const { mockUseNotificationPreferences, mockUseUpdateNotificationPreferences, mockMutate } = vi.hoisted(() => ({
  mockUseNotificationPreferences: vi.fn(),
  mockUseUpdateNotificationPreferences: vi.fn(),
  mockMutate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useNotificationPreferences: mockUseNotificationPreferences,
  useUpdateNotificationPreferences: mockUseUpdateNotificationPreferences,
}))

const FRAME = { title: 'Notifications', description: 'Which events ODIP emails you about.', readOnly: false, focusOnMount: false }

function renderTab() {
  const router = createMemoryRouter(
    [
      { path: '/settings', element: <NotificationPreferencesTab {...FRAME} /> },
      { path: '/elsewhere', element: <div>Elsewhere page</div> },
    ],
    { initialEntries: ['/settings?section=notifications'] },
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
  it('shows a loading state while preferences are fetching, and no Save over it', () => {
    mockUseNotificationPreferences.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    renderTab()
    expect(screen.getByRole('status')).toHaveTextContent(/loading notifications section/i)
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('shows one tick per event under its area, and no SMS column', () => {
    mockUseNotificationPreferences.mockReturnValue({ data: makeGrid({ IncidentReported: false }), isLoading: false, isError: false })
    renderTab()

    expect(screen.getByRole('heading', { level: 3, name: 'Leave' })).toBeInTheDocument()
    // One tick per event type the app knows (roster #244 adds ShiftUnassigned, so the count comes from the list, not a number).
    expect(screen.getAllByRole('checkbox')).toHaveLength(NOTIFICATION_EVENT_TYPE_GROUPS.flatMap(g => g.eventTypes).length)
    expect(screen.getByRole('checkbox', { name: 'Leave request submitted' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Incident reported' })).not.toBeChecked()
    expect(screen.queryByText(/sms/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/not available yet/i)).not.toBeInTheDocument()
  })

  it('saves every Email tick with the one Save, then says Saved', async () => {
    mockUseNotificationPreferences.mockReturnValue({ data: makeGrid(), isLoading: false, isError: false })
    mockMutate.mockImplementation((_payload, opts) => opts?.onSuccess?.(makeGrid({ LeaveRequestSubmitted: false })))
    const user = userEvent.setup()
    renderTab()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: 'Leave request submitted' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // The full body: one Email row per event type in the grid, in its order, with only the untick changed.
    const expected = makeGrid({ LeaveRequestSubmitted: false }).rows.filter(r => r.channel === 'Email').map(({ eventType, enabled }) => ({ eventType, channel: 'Email', enabled }))
    expect(mockMutate.mock.calls[0][0]).toEqual(expected)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('says in the foot why a save was refused, and keeps the ticks as they were left', async () => {
    mockUseNotificationPreferences.mockReturnValue({ data: makeGrid(), isLoading: false, isError: false })
    mockMutate.mockImplementation((_payload, opts) => opts?.onError?.({ response: { status: 400, data: { errors: ['Unknown event type or channel.'] } } }))
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('checkbox', { name: 'Leave request submitted' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Not saved. Unknown event type or channel.')
    expect(screen.getByRole('checkbox', { name: 'Leave request submitted' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  it('asks before leaving with an unsaved tick', async () => {
    mockUseNotificationPreferences.mockReturnValue({ data: makeGrid(), isLoading: false, isError: false })
    const user = userEvent.setup()
    const { router } = renderTab()

    await user.click(screen.getByRole('checkbox', { name: 'Leave request submitted' }))
    await act(async () => { await router.navigate('/elsewhere') })

    expect(screen.getByRole('alertdialog', { name: 'Leave without saving?' })).toBeInTheDocument()
  })
})
