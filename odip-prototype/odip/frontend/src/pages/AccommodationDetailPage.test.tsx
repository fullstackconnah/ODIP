import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AccommodationDetailPage from './AccommodationDetailPage'

const { mockUseAccommodationDetail } = vi.hoisted(() => ({
  mockUseAccommodationDetail: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useAccommodationDetail: mockUseAccommodationDetail,
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accommodation/acc-1']}>
      <Routes>
        <Route path="/accommodation/:id" element={<AccommodationDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockUseAccommodationDetail.mockReset()
})

describe('AccommodationDetailPage — fetch failure vs. not-found (PP-66)', () => {
  it('shows a distinct, retryable error when the request fails (isError), not "Property not found"', () => {
    const mockRefetch = vi.fn()
    mockUseAccommodationDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mockRefetch })
    renderPage()

    expect(screen.queryByText(/property not found/i)).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to load this property/i)
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('calls refetch when "Try again" is clicked', async () => {
    const user = userEvent.setup()
    const mockRefetch = vi.fn()
    mockUseAccommodationDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mockRefetch })
    renderPage()

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('still shows "Property not found" when the fetch succeeds but returns nothing', () => {
    mockUseAccommodationDetail.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText(/property not found/i)).toBeInTheDocument()
  })
})
