import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ClaimBatchesPage from './ClaimBatchesPage'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseClaimBatches } = vi.hoisted(() => ({ mockUseClaimBatches: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useClaimBatches: mockUseClaimBatches }))

afterEach(() => {
  restoreZone()
  vi.clearAllMocks()
  localStorage.clear()
})

// L4-02. A claim batch created at 15:00 Sydney (05:00Z) printed "03/10/2026, 05:00 am" because the zone-less instant was read as local
// time. The audit line must show the moment in the viewer's zone.
describe.each(['Australia/Sydney', 'UTC'])('Claim batches Created / Submitted in %s', zone => {
  it.each([
    ['with Z', '2026-10-03T05:00:00.1234567Z', '2026-10-03T06:30:00.5Z'],
    ['zone-less (the old wire shape)', '2026-10-03T05:00:00.1234567', '2026-10-03T06:30:00.5'],
  ])('shows the instants %s in the viewer zone', (_label, createdAt, submittedAt) => {
    if (!setZone(zone)) return
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    mockUseClaimBatches.mockReturnValue({
      data: [{ id: 'batch-1', fileName: 'PRODA_1.txt', createdAt, submittedAt, eventCount: 3, totalAmount: 450.5 }],
      isLoading: false,
    })
    const fmt = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

    render(
      <MemoryRouter initialEntries={['/billing/claim-batches']}>
        <Routes><Route path="/billing/claim-batches" element={<ClaimBatchesPage />} /></Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText(fmt('2026-10-03T05:00:00Z'))).toBeInTheDocument()
    expect(screen.getByText(fmt('2026-10-03T06:30:00Z'))).toBeInTheDocument()
  })
})
