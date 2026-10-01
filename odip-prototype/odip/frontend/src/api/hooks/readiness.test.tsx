import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useRosterBoard, useCreateShift, useUpdateShift, useAssignShift } from './rostering'
import { useCreateBooking } from './bookings'
import { useProviderSettings, useUpsertProviderSettings } from './catalogue'
import type { RosterBoardDto, ShiftDto, CreateShiftDto, UpdateShiftDto, AssignShiftDto, CreateBookingDto, UpsertProviderSettingsDto } from '../types'

// WARN mode: in Warn the server lets rostering writes and bookings through and reports what is missing as `readinessIssues`
// (omitted when nothing is). None of these hooks map or select fields, so the data must come out exactly as it went in, and the
// bodies must go up exactly as the caller built them. These tests pin that, so a future `select`/mapping cannot quietly drop
// the field, and a hook cannot quietly add one to a write body.
const { mockApiGet, mockApiPost, mockApiPut, mockApiPostRaw } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
  mockApiPut: vi.fn(),
  mockApiPostRaw: vi.fn(),
}))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiGet: mockApiGet, apiPost: mockApiPost, apiPut: mockApiPut, apiPostRaw: mockApiPostRaw }
})

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const ISSUES = ['Intake not complete', 'Onboarding not complete: profile']

function makeShift(overrides: Partial<ShiftDto> = {}): ShiftDto {
  return {
    id: 'shift-1', participantId: 'p1', participantName: 'Mia Chen', staffId: 'staff-1', staffName: 'Alex Rivera',
    serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false, durationHours: 8,
    ratio: 'OneToOne', nightType: 'None', status: 'Draft', shiftPatternId: null, notes: null, overrideReason: null,
    findings: [], assigneeOnApprovedLeave: false,
    ...overrides,
  }
}

beforeEach(() => {
  mockApiGet.mockReset()
  mockApiPost.mockReset()
  mockApiPut.mockReset()
  mockApiPostRaw.mockReset()
})

describe('useRosterBoard — readinessIssues survives', () => {
  it('participant grouping: on each row and on every shift of a row, and absent where the server omitted it', async () => {
    const board: RosterBoardDto = {
      groupBy: 'Participant',
      weekStart: '2026-08-17',
      days: ['2026-08-17'],
      participantRows: [
        {
          participantId: 'p1', fullName: 'Mia Chen', supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false,
          shifts: [makeShift({ readinessIssues: ISSUES })], tripBars: [], scheduledHours: 8, daysWithoutCover: 6, readinessIssues: ISSUES,
        },
        {
          participantId: 'p2', fullName: 'Noah Reid', supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false,
          shifts: [makeShift({ id: 'shift-2', participantId: 'p2' })], tripBars: [], scheduledHours: 8, daysWithoutCover: 6,
        },
      ],
      exceptions: [],
    }
    mockApiGet.mockResolvedValue(board)
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useRosterBoard('2026-08-17', 'participant'), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/rostering/board', { weekStart: '2026-08-17', groupBy: 'participant' })
    expect(result.current.data).toEqual(board)
    const data = result.current.data as Extract<RosterBoardDto, { groupBy: 'Participant' }>
    expect(data.participantRows[0].readinessIssues).toEqual(ISSUES)
    expect(data.participantRows[0].shifts[0].readinessIssues).toEqual(ISSUES)
    expect(data.participantRows[1]).not.toHaveProperty('readinessIssues')
    expect(data.participantRows[1].shifts[0]).not.toHaveProperty('readinessIssues')
  })

  it('staff grouping: on shifts in a staff row and in the unfilled lane', async () => {
    const board: RosterBoardDto = {
      groupBy: 'Staff',
      weekStart: '2026-08-17',
      days: ['2026-08-17'],
      staffRows: [{
        staffId: 'staff-1', fullName: 'Alex Rivera', role: 'SupportWorker', compliance: 'Ok', complianceNotes: [],
        rosteredHours: 8, targetHours: 38, shifts: [makeShift({ readinessIssues: ISSUES })], tripBars: [], leave: [],
      }],
      unfilled: [makeShift({ id: 'shift-3', staffId: null, staffName: null, readinessIssues: ['No signed service agreement'] })],
      exceptions: [],
    }
    mockApiGet.mockResolvedValue(board)
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useRosterBoard('2026-08-17', 'staff'), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(board)
    const data = result.current.data as Extract<RosterBoardDto, { groupBy: 'Staff' }>
    expect(data.staffRows[0].shifts[0].readinessIssues).toEqual(ISSUES)
    expect(data.unfilled[0].readinessIssues).toEqual(['No signed service agreement'])
  })
})

describe('shift writes — the Warn-mode response keeps readinessIssues, and the body goes up exactly as built', () => {
  it('useCreateShift POSTs /rostering/shifts with the caller\'s body and resolves the shift with its readinessIssues', async () => {
    const created = makeShift({ readinessIssues: ISSUES })
    mockApiPost.mockResolvedValue(created)
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateShift(), { wrapper: wrapper(queryClient) })

    const body: CreateShiftDto = {
      participantId: 'p1', staffId: null, serviceDate: '2026-08-17', startTime: '09:00', endTime: '17:00', endsNextDay: false,
      ratio: 'OneToOne', nightType: 'None', status: 'Draft', notes: null, overrideReason: null, acknowledgedFindingCodes: [],
    }
    result.current.mutate(body)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiPost).toHaveBeenCalledWith('/rostering/shifts', body)
    expect(result.current.data).toEqual(created)
    expect(result.current.data?.readinessIssues).toEqual(ISSUES)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['roster-board'] })
  })

  it('useUpdateShift PUTs /rostering/shifts/{id} with the caller\'s body and resolves the shift with its readinessIssues', async () => {
    const updated = makeShift({ readinessIssues: ISSUES })
    mockApiPut.mockResolvedValue(updated)
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useUpdateShift(), { wrapper: wrapper(queryClient) })

    const data: UpdateShiftDto = {
      participantId: 'p1', staffId: 'staff-1', serviceDate: '2026-08-17', startTime: '09:00', endTime: '17:00', endsNextDay: false,
      ratio: 'OneToOne', nightType: 'None', status: 'Published', notes: 'Swap', overrideReason: null, acknowledgedFindingCodes: [],
    }
    result.current.mutate({ id: 'shift-1', data })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiPut).toHaveBeenCalledWith('/rostering/shifts/shift-1', data)
    expect(result.current.data?.readinessIssues).toEqual(ISSUES)
  })

  it('useAssignShift POSTs /rostering/shifts/{id}/assign with the caller\'s body and resolves the shift with its readinessIssues', async () => {
    const assigned = makeShift({ readinessIssues: ISSUES })
    mockApiPost.mockResolvedValue(assigned)
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useAssignShift(), { wrapper: wrapper(queryClient) })

    const data: AssignShiftDto = { staffId: 'staff-1', overrideReason: null, acknowledgedFindingCodes: [] }
    result.current.mutate({ id: 'shift-1', data })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiPost).toHaveBeenCalledWith('/rostering/shifts/shift-1/assign', data)
    expect(result.current.data?.readinessIssues).toEqual(ISSUES)
  })
})

describe('useCreateBooking — the Warn-mode response keeps readinessIssues', () => {
  it('POSTs /bookings with the caller\'s body and resolves the envelope with the booking\'s readinessIssues', async () => {
    const envelope = { success: true, data: { id: 'booking-1', participantId: 'p1', readinessIssues: ISSUES }, message: null, errors: null }
    mockApiPostRaw.mockResolvedValue(envelope)
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useCreateBooking(), { wrapper: wrapper(queryClient) })

    const body: CreateBookingDto = {
      tripInstanceId: 'trip-1', participantId: 'p1', bookingStatus: 'Enquiry', nightSupportRequired: false, wheelchairRequired: false,
      highSupportRequired: false, hasRestrictivePracticeFlag: false,
    }
    result.current.mutate(body)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiPostRaw).toHaveBeenCalledWith('/bookings', body)
    expect(result.current.data).toEqual(envelope)
    expect((result.current.data?.data as { readinessIssues?: string[] }).readinessIssues).toEqual(ISSUES)
  })
})

describe('provider settings hooks — the readiness mode', () => {
  const settings = {
    id: 'ps-1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sunrise', address: '1 Wattle St', state: 'QLD',
    gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null,
    managerName: null, managerPhone: null,
  }

  it('useProviderSettings resolves participantReadinessMode as the server sent it', async () => {
    mockApiGet.mockResolvedValue({ ...settings, participantReadinessMode: 'Enforce' })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useProviderSettings(), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/provider-settings')
    expect(result.current.data?.participantReadinessMode).toBe('Enforce')
  })

  it('useProviderSettings resolves null for an organisation with no row yet', async () => {
    mockApiGet.mockResolvedValue(null)
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useProviderSettings(), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('useUpsertProviderSettings PUTs exactly the body it is given: no mode is added for a body without one, and one the caller set goes through', async () => {
    mockApiPut.mockResolvedValue({ ...settings, participantReadinessMode: 'Warn' })
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpsertProviderSettings(), { wrapper: wrapper(queryClient) })

    const withoutMode: UpsertProviderSettingsDto = {
      registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sunrise', address: '1 Wattle St', gstRegistered: true, isPaceProvider: false,
    }
    result.current.mutate(withoutMode)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiPut).toHaveBeenLastCalledWith('/provider-settings', withoutMode)
    expect(mockApiPut.mock.calls[0][1]).not.toHaveProperty('participantReadinessMode')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['provider-settings'] })

    const withMode: UpsertProviderSettingsDto = { ...withoutMode, participantReadinessMode: 'Enforce' }
    result.current.mutate(withMode)
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(mockApiPut).toHaveBeenLastCalledWith('/provider-settings', withMode)
  })
})
