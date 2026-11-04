import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import IncidentDetailPage from './IncidentDetailPage'

const { mockPerms } = vi.hoisted(() => ({ mockPerms: { canWrite: true, canReadIncidentReview: false, canWriteIncidentReview: false } }))

vi.mock('@/api/hooks', () => ({
  useIncident: () => ({
    data: {
      id: 'inc-1', incidentType: 'Other', severity: 'Low', status: 'Draft', title: 'T', description: 'D', timeZoneId: 'Australia/Sydney',
      incidentDateTime: '2026-07-11T20:15:00', qscReportingStatus: 'NotRequired', injuries: [], witnesses: [], reportableClass: 'None',
      wereEmergencyServicesCalled: false, emergencyServices: 'None', commissionFinalReportRequested: false,
    },
    isLoading: false,
  }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => mockPerms }))
vi.mock('./incidents/IncidentReviewCard', () => ({
  IncidentReviewCard: ({ canEdit }: { canEdit: boolean }) => <div data-testid="incident-review">{canEdit ? 'edit' : 'read'}</div>,
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/incidents/inc-1']}>
      <Routes><Route path="/incidents/:id" element={<IncidentDetailPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('IncidentDetailPage — Admin review section', () => {
  beforeEach(() => Object.assign(mockPerms, { canReadIncidentReview: false, canWriteIncidentReview: false }))

  it('is absent for a role that cannot read the review', () => {
    renderPage()
    expect(screen.queryByTestId('incident-review')).toBeNull()
  })

  it('is read-only for a Coordinator', () => {
    Object.assign(mockPerms, { canReadIncidentReview: true })
    renderPage()
    expect(screen.getByTestId('incident-review')).toHaveTextContent('read')
  })

  it('is editable for an Admin', () => {
    Object.assign(mockPerms, { canReadIncidentReview: true, canWriteIncidentReview: true })
    renderPage()
    expect(screen.getByTestId('incident-review')).toHaveTextContent('edit')
  })
})
