import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useStaff } from '@/api/hooks'
import { renderGroup, announcement, facts, headers, subjects } from './groupHarness'
import { useComplianceGroup } from './useComplianceGroup'

vi.mock('@/lib/firebase', () => ({ auth: null, devAuthEnabled: true }))
const { apiGet, apiPutRaw } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPutRaw: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet, apiPutRaw }))

const TODAY = '2026-10-14'
const member = (o: Record<string, unknown> = {}) => ({
  id: 's1', firstName: 'Sam', lastName: 'Lee', fullName: 'Sam Lee', role: 'SupportWorker', position: 'SupportWorker', email: 'sam@example.com',
  mobile: '0400 000 000', region: 'Brisbane', isDriverEligible: false, isFirstAidQualified: true, isMedicationCompetent: false, isManualHandlingCompetent: false,
  isOvernightEligible: false, isActive: true, notes: 'Prefers mornings.', firstAidExpiryDate: '2026-10-03', driverLicenceExpiryDate: null,
  manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: 'WS-1', workerScreeningExpiryDate: '2099-01-01', ...o,
})
const render = (mayEditAdmins = true) => renderGroup(() => useComplianceGroup(true, { staff: useStaff({ isActive: 'true' }), today: TODAY, warningDays: 30, mayEditAdmins }))
// The staff list, and each person read fresh at save time (GET /staff/{id}): the record as it is now, which may differ from the list (deep S1).
const answer = (list: Array<ReturnType<typeof member>>, fresh: Record<string, unknown> = {}) =>
  apiGet.mockImplementation((url: string) => Promise.resolve(url === '/staff' ? list : (fresh[url.slice('/staff/'.length)] ?? list.find((m) => url === `/staff/${m.id}`))))
const UPDATE_SAM = 'Update expiry: Sam Lee, first aid'

beforeEach(() => {
  apiGet.mockReset()
  apiPutRaw.mockReset()
})

describe('Staff compliance group — what it lists', () => {
  it('lists one row per credential that needs action: expired first, then today, then soonest, then undated, counted as the old tile counted', async () => {
    apiGet.mockResolvedValue([
      member({ id: 'b', fullName: 'Ben Ito', firstAidExpiryDate: '2026-10-30' }),
      member({ id: 'c', fullName: 'Cy Moss', firstAidExpiryDate: '2027-05-01', isDriverEligible: true }),
      member(),
      member({ id: 'a', fullName: 'Ana Ruiz', firstAidExpiryDate: TODAY }),
    ])
    render()

    await screen.findByText('Sam Lee')
    expect(apiGet).toHaveBeenCalledWith('/staff', { isActive: 'true' })
    expect(subjects()).toEqual(['Sam Lee', 'Ana Ruiz', 'Ben Ito', 'Cy Moss'])
    expect(headers()).toEqual(['Staff', 'Credential', 'Expiry', ''])
    expect(facts('Sam Lee')).toEqual(['First Aid', '3 Oct'])
    expect(facts('Ben Ito')).toEqual(['First Aid', '30 Oct'])
    // Undated: a dash in the table (and nothing on the card).
    expect(facts('Cy Moss')).toEqual(['Driver Licence', '—'])
    for (const flag of ['Expired', 'Expires today', '16 days', 'No date set']) expect(screen.getByText(flag)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Credentials (4)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add expiry: Cy Moss, driver licence' })).toBeInTheDocument()
  })
})

describe('Staff compliance group — a missing screening', () => {
  it('lists an active person with no screening on file as an undated Worker Screening row', async () => {
    apiGet.mockResolvedValue([member({ firstAidExpiryDate: '2099-01-01', workerScreeningExpiryDate: null })])
    render()

    await screen.findByText('Sam Lee')
    expect(facts('Sam Lee')).toEqual(['Worker Screening', '—'])
    expect(screen.getByRole('button', { name: 'Add expiry: Sam Lee, worker screening' })).toBeInTheDocument()
  })
})

describe('Staff compliance group — Update expiry', () => {
  it('saves through useUpdateStaff with the WHOLE staff record (the PUT rewrites it), takes the row away and announces the new date', async () => {
    // Two other dates on the record (a licence not flagged, a screening still current) must survive the save untouched.
    answer([member({ driverLicenceExpiryDate: '2028-06-30', workerScreeningExpiryDate: '2029-01-01' })])
    apiPutRaw.mockResolvedValue({ success: true, data: member({ firstAidExpiryDate: '2027-10-03' }) })
    render()

    fireEvent.click(await screen.findByRole('button', { name: UPDATE_SAM }))
    const field = screen.getByLabelText(/Expiry date/)
    expect(field).toHaveValue('2026-10-03')
    fireEvent.change(field, { target: { value: '2027-10-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // The WHOLE body, written out field by field (toUpdateStaffDto's 20 fields): the PUT rewrites the staff record, so nothing may be dropped.
    await waitFor(() => expect(apiPutRaw).toHaveBeenCalledWith('/staff/s1', {
      firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com', role: 'SupportWorker', position: 'SupportWorker',
      mobile: '0400 000 000', region: 'Brisbane',
      isDriverEligible: false, isFirstAidQualified: true, isMedicationCompetent: false, isManualHandlingCompetent: false, isOvernightEligible: false, isActive: true,
      notes: 'Prefers mornings.',
      firstAidExpiryDate: '2027-10-03', driverLicenceExpiryDate: '2028-06-30', manualHandlingExpiryDate: undefined, medicationCompetencyExpiryDate: undefined,
      workerScreeningNumber: 'WS-1', workerScreeningExpiryDate: '2029-01-01',
    }))
    await waitFor(() => expect(announcement()).toHaveTextContent("Saved Sam Lee's first aid: expires 3 Oct 2027."))
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument()
  })

  it('keeps the row, and says so, when the new date is still inside the window', async () => {
    answer([member()])
    apiPutRaw.mockResolvedValue({ success: true, data: member({ firstAidExpiryDate: '2026-11-01' }) })
    render()

    fireEvent.click(await screen.findByRole('button', { name: UPDATE_SAM }))
    fireEvent.change(screen.getByLabelText(/Expiry date/), { target: { value: '2026-11-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(announcement()).toHaveTextContent("Saved Sam Lee's first aid: expires 1 Nov 2026. It's still due within 30 days."))
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
  })

  it('asks for a date before sending anything, and keeps the date on a refusal', async () => {
    answer([member({ firstAidExpiryDate: null })])
    apiPutRaw.mockRejectedValue({ response: { data: { message: 'Staff member not found.' } } })
    render()

    fireEvent.click(await screen.findByRole('button', { name: 'Add expiry: Sam Lee, first aid' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose the expiry date.')
    expect(apiPutRaw).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/Expiry date/), { target: { value: '2027-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Staff member not found.')
    expect(screen.getByLabelText(/Expiry date/)).toHaveValue('2027-01-01')
  })
})

describe('Staff compliance group — fix round 1', () => {
  it('reads the person fresh before the PUT and builds the body from that, so an archive or a role change made since the list loaded is kept (deep S1)', async () => {
    answer([member()], { s1: member({ isActive: false, role: 'Coordinator', position: 'Coordinator', notes: 'Archived 14 Oct.' }) })
    apiPutRaw.mockResolvedValue({ success: true, data: member({ firstAidExpiryDate: '2027-10-03' }) })
    render()

    fireEvent.click(await screen.findByRole('button', { name: UPDATE_SAM }))
    fireEvent.change(screen.getByLabelText(/Expiry date/), { target: { value: '2027-10-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(apiPutRaw).toHaveBeenCalled())
    const body = apiPutRaw.mock.calls[0][1]
    expect(body).toMatchObject({ isActive: false, role: 'Coordinator', position: 'Coordinator', notes: 'Archived 14 Oct.', firstAidExpiryDate: '2027-10-03' })
    // GET /staff/s1 before the PUT.
    const getCall = apiGet.mock.calls.findIndex(([url]) => url === '/staff/s1')
    expect(getCall).toBeGreaterThanOrEqual(0)
    expect(apiGet.mock.invocationCallOrder[getCall]).toBeLessThan(apiPutRaw.mock.invocationCallOrder[0])
  })

  it("offers a Coordinator no editor on an Admin's credential (the server refuses it): it says an admin updates this, and opens the person (deep S3)", async () => {
    answer([member({ role: 'Admin', position: 'Admin' })])
    render(false)

    const open = await screen.findByRole('link', { name: 'Open staff member: Sam Lee' })
    expect(open).toHaveAttribute('href', '/staff/s1')
    expect(screen.queryByRole('button', { name: UPDATE_SAM })).not.toBeInTheDocument()
    // A neutral flag, never the end of a meta a narrow row cuts.
    expect(screen.getByText('An admin updates this').closest('p')).toBeNull()
  })
})
