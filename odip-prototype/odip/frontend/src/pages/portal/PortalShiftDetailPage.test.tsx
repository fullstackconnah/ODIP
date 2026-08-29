import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PortalShiftDetailPage from './PortalShiftDetailPage'
import type { PortalShiftDetailDto } from '@/api/types'

const { mockUsePortalShiftDetail } = vi.hoisted(() => ({
  mockUsePortalShiftDetail: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  usePortalShiftDetail: mockUsePortalShiftDetail,
}))

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/portal/shifts/${id}`]}>
      <Routes>
        <Route path="/portal/shifts/:id" element={<PortalShiftDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function makeDetail(overrides: Partial<PortalShiftDetailDto> = {}): PortalShiftDetailDto {
  return {
    id: 'shift-1',
    serviceDate: '2026-08-17',
    startTime: '09:00:00',
    endTime: '17:00:00',
    endsNextDay: false,
    durationHours: 8,
    ratio: 'OneToOne',
    nightType: 'None',
    status: 'Published',
    notes: null,
    participant: {
      id: 'participant-1',
      fullName: 'Mia Chen',
      isHighSupport: true,
      isIntensiveSupport: false,
      hasRestrictivePracticeFlag: false,
      supportRatio: 'OneToOne',
      overnightSupport: 'None',
      mobilityAidWheelchair: true,
      mobilityAidWalker: false,
      mobilitySupportOptions: [],
      requiresHiLoBed: false,
      requiresHoist: true,
      requiresShowerChair: false,
      requiresCommode: false,
      requiresStandingMachine: false,
      mobilityNotes: 'Two-person transfer required.',
      equipmentRequirements: null,
      transportRequirements: null,
      medicalSummary: null,
      behaviourRiskSummary: null,
    },
    routines: [
      {
        id: 'routine-1',
        participantId: 'participant-1',
        title: 'Morning routine',
        description: 'Gentle wake, warm drink.',
        category: 'PersonalCare',
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        isCritical: true,
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'routine-2',
        participantId: 'participant-1',
        title: 'Wednesday evening routine',
        description: 'Only relevant on Wednesday evenings — should be filtered out for this Monday day shift.',
        category: 'Sleep',
        dayOfWeek: 'Wednesday',
        startTime: '20:00:00',
        endTime: '21:00:00',
        isCritical: false,
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    medications: [
      {
        id: 'med-1',
        name: 'Paracetamol',
        strength: '500mg',
        doseDescription: '2 tablets',
        type: 'Regular',
        timesOfDay: '08:00,20:00',
        isHighRisk: true,
        isPsychotropic: false,
        isChemicalRestraint: false,
        drugSchedule: 'Unscheduled',
        supportLevel: 'Assist',
        prnIndication: null,
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  mockUsePortalShiftDetail.mockReset()
})

describe('PortalShiftDetailPage', () => {
  it('renders the shift time/status and participant summary flags', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail(), isLoading: false, isError: false })
    renderAt('shift-1')

    expect(screen.getByRole('heading', { name: 'Mia Chen' })).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.getByText(/high support/i)).toBeInTheDocument()
    expect(screen.getByText(/wheelchair/i)).toBeInTheDocument()
    expect(screen.getByText(/hoist/i)).toBeInTheDocument()
    expect(screen.getByText('Two-person transfer required.')).toBeInTheDocument()
  })

  it('shows only the shift-relevant routine (untimed critical), filtering out the unrelated one', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail(), isLoading: false, isError: false })
    renderAt('shift-1')

    expect(screen.getByText('Morning routine')).toBeInTheDocument()
    expect(screen.queryByText('Wednesday evening routine')).not.toBeInTheDocument()
  })

  it('renders the active medications summary with badges', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail(), isLoading: false, isError: false })
    renderAt('shift-1')

    expect(screen.getByText(/Paracetamol 500mg/)).toBeInTheDocument()
    expect(screen.getByText(/2 tablets/)).toBeInTheDocument()
    expect(screen.getByText(/high risk/i)).toBeInTheDocument()
  })

  it('shows a not-found message when the shift errors (foreign/nonexistent shift id)', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    renderAt('someone-elses-shift')

    expect(screen.getByText(/couldn't be found/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
