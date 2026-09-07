import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CompatibilityPage from './CompatibilityPage'

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canWrite: true }),
}))

vi.mock('@/api/hooks', () => ({
  useParticipants: () => ({
    data: [
      { id: 'p1', fullName: 'Alex Rivera' },
      { id: 'p2', fullName: 'Jamie Chen' },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useStaff: () => ({
    data: [
      { id: 's1', fullName: 'Sam Taylor' },
      { id: 's2', fullName: 'Morgan Lee' },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpsertCompatibility: () => ({ mutate: vi.fn() }),
}))

vi.mock('./lib/useCompatibilityMatrix', () => ({
  useCompatibilityMatrix: () => ({
    byKey: new Map(),
    isLoading: false,
    isError: false,
    refetchAll: vi.fn(),
  }),
}))

describe('CompatibilityPage — PP-53 staff/participant filters', () => {
  it('filters staff rows by the staff filter text', async () => {
    const user = userEvent.setup()
    render(<CompatibilityPage />)

    expect(screen.getByText('Sam Taylor')).toBeInTheDocument()
    expect(screen.getByText('Morgan Lee')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Filter staff'), 'Sam')

    expect(screen.getByText('Sam Taylor')).toBeInTheDocument()
    expect(screen.queryByText('Morgan Lee')).not.toBeInTheDocument()
  })

  it('filters participant columns by the participant filter text', async () => {
    const user = userEvent.setup()
    render(<CompatibilityPage />)

    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.getByText('Jamie Chen')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Filter participants'), 'Jamie')

    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()
    expect(screen.getByText('Jamie Chen')).toBeInTheDocument()
  })
})
