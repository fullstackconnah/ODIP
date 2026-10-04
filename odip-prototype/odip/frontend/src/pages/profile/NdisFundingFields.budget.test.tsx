import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { NdisFundingFields } from './sharedFieldControls'
import type { ParticipantFormData } from '@/lib/participantSchema'

// Budget phase 1: the Profile wizard shows the shared funding half (NdisFundingFields), which carries the same "Plan budget" card as Intake, for the participant being edited (the profile
// wizard always has one). Not for funding that is not the NDIS.

const { useFundingPlans } = vi.hoisted(() => ({ useFundingPlans: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useFundingPlans,
  useParticipantContactRoles: () => ({ data: [], isLoading: false }),
}))

function Harness({ fundingSource }: { fundingSource: string }) {
  const { control, register, formState: { errors } } = useForm<ParticipantFormData>({ defaultValues: { fundingSource, planType: 'AgencyManaged' } as Partial<ParticipantFormData> as ParticipantFormData })
  return <NdisFundingFields control={control} register={register} errors={errors} participantId="participant-1" />
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  useFundingPlans.mockReturnValue({ data: { plans: [], profilePlanDates: {} }, isLoading: false, isError: false, refetch: vi.fn() })
})
afterEach(() => { localStorage.clear() })

describe('Profile wizard funding fields: the plan budget card', () => {
  it('is there for an NDIS-funded participant, asking about their own plan budget', () => {
    render(<Harness fundingSource="Ndis" />)

    expect(screen.getByRole('heading', { name: 'Plan budget' })).toBeInTheDocument()
    expect(screen.getByText('Not recorded')).toBeInTheDocument()
    expect(useFundingPlans).toHaveBeenCalledWith('participant-1')
  })

  it('is not there for funding that is not the NDIS', () => {
    render(<Harness fundingSource="Other" />)

    expect(screen.queryByRole('heading', { name: 'Plan budget' })).not.toBeInTheDocument()
    expect(useFundingPlans).not.toHaveBeenCalled()
  })
})
