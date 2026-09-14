import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminNotificationsTab from './AdminNotificationsTab'
import type { NotificationOutboxDto } from '@/api/types'

const {
  mockUseAdminNotifications,
  mockUseRetryNotification,
  mockUseSendTestEmail,
  mockRetryMutateAsync,
  mockSendTestEmailMutateAsync,
} = vi.hoisted(() => ({
  mockUseAdminNotifications: vi.fn(),
  mockUseRetryNotification: vi.fn(),
  mockUseSendTestEmail: vi.fn(),
  mockRetryMutateAsync: vi.fn(),
  mockSendTestEmailMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useAdminNotifications: mockUseAdminNotifications,
  useRetryNotification: mockUseRetryNotification,
  useSendTestEmail: mockUseSendTestEmail,
}))

function makeRow(overrides: Partial<NotificationOutboxDto> = {}): NotificationOutboxDto {
  return {
    id: 'notif-1',
    eventType: 'LeaveRequestSubmitted',
    entityType: 'LeaveRequest',
    entityId: 'leave-1',
    recipientUserId: 'user-1',
    recipientName: 'Priya Sharma',
    status: 'Failed',
    attempts: 5,
    nextAttemptAt: '2026-09-13T00:00:00Z',
    lastError: 'SMTP timeout',
    createdAt: '2026-09-12T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  mockUseAdminNotifications.mockReset()
  mockUseRetryNotification.mockReset().mockReturnValue({ mutateAsync: mockRetryMutateAsync, isPending: false })
  mockUseSendTestEmail.mockReset().mockReturnValue({ mutateAsync: mockSendTestEmailMutateAsync, isPending: false })
  mockRetryMutateAsync.mockReset()
  mockSendTestEmailMutateAsync.mockReset()
})

describe('AdminNotificationsTab', () => {
  it('renders failed rows with their error text', () => {
    mockUseAdminNotifications.mockReturnValue({ data: [makeRow()], isLoading: false, isError: false })
    render(<AdminNotificationsTab />)

    expect(screen.getByText('Priya Sharma')).toBeInTheDocument()
    expect(screen.getByText('SMTP timeout')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument()
  })

  it('does not show a Retry button for a non-Failed row', () => {
    mockUseAdminNotifications.mockReturnValue({ data: [makeRow({ status: 'Sent', lastError: undefined })], isLoading: false, isError: false })
    render(<AdminNotificationsTab />)

    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()
  })

  it('Retry calls the mutation and disables the button while pending', async () => {
    let resolveRetry: () => void = () => {}
    mockRetryMutateAsync.mockReturnValue(new Promise<void>(resolve => { resolveRetry = resolve }))
    mockUseAdminNotifications.mockReturnValue({ data: [makeRow()], isLoading: false, isError: false })
    const user = userEvent.setup()
    render(<AdminNotificationsTab />)

    const retryButton = screen.getByRole('button', { name: /^retry$/i })
    await user.click(retryButton)

    expect(mockRetryMutateAsync).toHaveBeenCalledWith('notif-1')
    expect(screen.getByRole('button', { name: /retrying/i })).toBeDisabled()

    await act(async () => { resolveRetry() })
  })

  it('shows the 409 message inline when a retry is rejected', async () => {
    mockRetryMutateAsync.mockRejectedValue({ response: { status: 409, data: { errors: ['Only failed notifications can be retried.'] } } })
    mockUseAdminNotifications.mockReturnValue({ data: [makeRow()], isLoading: false, isError: false })
    const user = userEvent.setup()
    render(<AdminNotificationsTab />)

    await user.click(screen.getByRole('button', { name: /^retry$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/only failed notifications can be retried/i)
  })

  it('sends a test email and shows the result', async () => {
    mockSendTestEmailMutateAsync.mockResolvedValue({ sent: true })
    mockUseAdminNotifications.mockReturnValue({ data: [], isLoading: false, isError: false })
    const user = userEvent.setup()
    render(<AdminNotificationsTab />)

    await user.type(screen.getByLabelText(/test email address/i), 'ops@example.com')
    await user.click(screen.getByRole('button', { name: /send test email/i }))

    expect(mockSendTestEmailMutateAsync).toHaveBeenCalledWith('ops@example.com')
    expect(await screen.findByText(/sent successfully/i)).toBeInTheDocument()
  })

  it('shows a failed test-email result inline without throwing', async () => {
    mockSendTestEmailMutateAsync.mockResolvedValue({ sent: false, error: 'Connection refused' })
    mockUseAdminNotifications.mockReturnValue({ data: [], isLoading: false, isError: false })
    const user = userEvent.setup()
    render(<AdminNotificationsTab />)

    await user.type(screen.getByLabelText(/test email address/i), 'ops@example.com')
    await user.click(screen.getByRole('button', { name: /send test email/i }))

    expect(await screen.findByText(/connection refused/i)).toBeInTheDocument()
  })
})
