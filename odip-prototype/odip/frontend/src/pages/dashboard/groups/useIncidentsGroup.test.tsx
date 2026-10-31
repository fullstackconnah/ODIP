import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import { facts, headers, renderGroup, rowOf, subjects } from './groupHarness'
import { useIncidentsGroup } from './useIncidentsGroup'

vi.mock('@/lib/firebase', () => ({ auth: null, devAuthEnabled: true }))
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet }))

const incident = (id: string, o: Record<string, unknown> = {}) => ({
  id, serviceType: 'None', tripInstanceId: null, tripName: null, incidentType: 'Injury', otherTypeSpecify: null, severity: 'High', status: 'Submitted',
  title: `Incident ${id}`, incidentDateTime: '2026-10-14T08:00:00', location: null, reportedByName: 'Sam Lee', involvedParticipantId: 'p-1',
  involvedParticipantName: 'Grace Palmer-Hughes', qscReportingStatus: 'Required', isOverdue24h: false, createdAt: '2026-10-14T00:00:00Z',
  medicationAdministrationId: null, shiftId: null, shiftNoteId: null, ...o,
})
const page = (items: unknown[], totalCount = items.length) => ({ items, totalCount, page: 1, pageSize: 5, totalPages: 1, hasNext: false, hasPrevious: false })

// Braces: an arrow that returned the mock would hand vitest a cleanup function, and it would call apiGet() after the test.
beforeEach(() => { apiGet.mockReset() })

describe('Incidents group (links only)', () => {
  it('lists the NDIS Commission overdue ones first, then the rest of what needs somebody, each once, counted by the needsAttention total', async () => {
    apiGet.mockImplementation((_url: string, params: Record<string, string>) => Promise.resolve(params.isOverdueQsc
      ? page([incident('q1', { isOverdue24h: true, status: 'Resolved' })])
      : page([incident('a1'), incident('q1', { isOverdue24h: true, status: 'Resolved' }), incident('a2', { status: 'UnderReview' })], 9)))
    renderGroup(() => useIncidentsGroup(true))

    await screen.findByText('Incident q1')
    expect(apiGet).toHaveBeenCalledWith('/incidents', { isOverdueQsc: 'true', page: '1', pageSize: '5' })
    expect(apiGet).toHaveBeenCalledWith('/incidents', { needsAttention: 'true', page: '1', pageSize: '5' })
    expect(subjects()).toEqual(['Incident q1', 'Incident a1', 'Incident a2'])
    expect(screen.getByRole('tab', { name: 'Incidents (9)' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all open incidents' })).toHaveAttribute('href', '/incidents')
    const overdue = rowOf('Incident q1')
    expect(within(overdue).getByText('NDIS Commission overdue')).toBeInTheDocument()
    expect(within(overdue).getByRole('link', { name: 'Open incident: Incident q1' })).toHaveAttribute('href', '/incidents/q1')
    expect(within(overdue).queryByRole('button')).not.toBeInTheDocument()
    expect(within(rowOf('Incident a2')).getByText('Under review')).toBeInTheDocument()   // a status flag is a sentence, not Title Case
    expect(headers()).toEqual(['Incident', 'Participant', 'Type', 'When', ''])
    expect(facts('Incident q1')).toEqual(['Grace Palmer-Hughes', 'Injury', expect.stringMatching(/^14 Oct/)])
  })

  it('never shows clear while a list failed', async () => {
    apiGet.mockRejectedValue(new Error('down'))
    renderGroup(() => useIncidentsGroup(true))

    expect(await screen.findByText("Couldn't load this incidents queue. Check your connection and try again.")).toBeInTheDocument()
  })
})
