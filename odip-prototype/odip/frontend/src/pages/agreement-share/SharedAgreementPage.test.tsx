import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { SharedAgreementDto } from '@/api/types'
import SharedAgreementPage from './SharedAgreementPage'

const { shared } = vi.hoisted(() => ({ shared: vi.fn() }))
vi.mock('@/api/hooks/service-agreement-drafts', () => ({
  useSharedAgreement: () => shared(),
  sharedAgreementPdfUrl: (token: string) => `/api/v1/public/agreement-share/${token}/pdf`,
}))

const agreement = (changes: Partial<SharedAgreementDto> = {}): SharedAgreementDto => ({
  providerName: 'Ability Options', participantName: 'Marcus Tran', startDate: '2026-10-01', endDate: '2027-06-30', isOngoing: false, periodText: '1 October 2026 to 30 June 2027',
  lines: [{ item: 'Assistance with self-care', quantity: 10, unit: 'hour', unitPrice: 70.23, total: 702.3 }], total: 702.3,
  contactEmail: 'office@example.com', contactPhone: '07 5550 0100', expiresAt: '2026-12-03T01:00:00Z', ...changes,
})

function renderPage() {
  const router = createMemoryRouter([{ path: '/agreement/:token', element: <SharedAgreementPage /> }], { initialEntries: ['/agreement/tok-1'] })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => shared.mockReset())

describe('SharedAgreementPage', () => {
  it('shows the lines, the total, the period and the download, and no approve control', () => {
    shared.mockReturnValue({ data: agreement(), isLoading: false })
    renderPage()
    expect(screen.getByRole('heading', { name: 'Service agreement for Marcus Tran' })).toBeInTheDocument()
    expect(screen.getByText('1 October 2026 to 30 June 2027')).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Assistance with self-care' })).toBeInTheDocument()
    expect(screen.getAllByText('$702.30')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', '/api/v1/public/agreement-share/tok-1/pdf')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says how to agree with both the email and the phone, with only one, or with neither', () => {
    shared.mockReturnValue({ data: agreement(), isLoading: false })
    const { unmount } = renderPage()
    expect(screen.getByText('To agree to this service agreement, reply to office@example.com or call 07 5550 0100.')).toBeInTheDocument()
    unmount()
    shared.mockReturnValue({ data: agreement({ contactPhone: undefined }), isLoading: false })
    const second = renderPage()
    expect(screen.getByText('To agree to this service agreement, reply to office@example.com.')).toBeInTheDocument()
    second.unmount()
    shared.mockReturnValue({ data: agreement({ contactEmail: undefined }), isLoading: false })
    const third = renderPage()
    expect(screen.getByText('To agree to this service agreement, call 07 5550 0100.')).toBeInTheDocument()
    third.unmount()
    shared.mockReturnValue({ data: agreement({ contactEmail: undefined, contactPhone: undefined }), isLoading: false })
    renderPage()
    expect(screen.queryByText(/To agree to this service agreement/)).not.toBeInTheDocument()
  })

  it('says the ongoing wording the server gave', () => {
    shared.mockReturnValue({ data: agreement({ isOngoing: true, endDate: undefined, periodText: 'From 1 October 2026, ongoing, until the plan ends' }), isLoading: false })
    renderPage()
    expect(screen.getByText('From 1 October 2026, ongoing, until the plan ends')).toBeInTheDocument()
  })

  it('shows one fixed message for a link that is not valid, whatever the reason', () => {
    shared.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    renderPage()
    expect(screen.getByText(/This link isn.t valid any more\. It may have expired or been replaced\. Please contact the organisation that sent it\./)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Download PDF' })).not.toBeInTheDocument()
  })

  it('shows a loading line first, and marks the page noindex with its title while it is open', () => {
    shared.mockReturnValue({ data: undefined, isLoading: true })
    const { unmount } = renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(document.title).toBe('Service agreement')
    expect(document.querySelector('meta[name="robots"][content="noindex"]')).not.toBeNull()
    unmount()
    expect(document.querySelector('meta[name="robots"]')).toBeNull()
  })
})
