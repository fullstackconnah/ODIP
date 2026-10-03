import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { NdisFundingStep } from './NdisFundingStep'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { PACE_CATEGORIES, plan } from '@/test/fixtures/funding'

// Budget phase 1: Intake's NDIS & Funding step carries a "Plan budget" card for NDIS-funded participants. A participant who does not exist yet cannot have a budget recorded (the card says
// to save them first), a participant who is not NDIS-funded has no plan budget to record (no card), and "Plan not shared yet" is the explicit skip that simply closes the editor.

const { useFundingPlans, create, update } = vi.hoisted(() => ({ useFundingPlans: vi.fn(), create: vi.fn(), update: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useFundingPlans,
  useCreateFundingPlan: () => ({ mutate: create, isPending: false }),
  useUpdateFundingPlan: () => ({ mutate: update, isPending: false }),
  usePaceCategories: () => ({ data: PACE_CATEGORIES }),
  useBillingSourcesHint: () => ({ data: { total: 0, rows: [] } }),
}))

function Harness({ fundingSource = 'Ndis', participantId }: { fundingSource?: string; participantId?: string }) {
  const { control, register, formState: { errors } } = useForm<ParticipantFormData>({ defaultValues: { fundingSource, planType: 'PlanManaged', serviceStreams: [] } as Partial<ParticipantFormData> as ParticipantFormData })
  return <NdisFundingStep control={control} register={register} errors={errors} fundingSourceValue={fundingSource} planTypeComplianceWarningValue={null} participantId={participantId} />
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  useFundingPlans.mockReturnValue({ data: { plans: [], profilePlanDates: {} }, isLoading: false, isError: false, refetch: vi.fn() })
})
afterEach(() => { localStorage.clear() })

describe('Intake NDIS & Funding step: the plan budget card', () => {
  it('says to save the participant first on a brand-new intake', () => {
    render(<Harness />)

    expect(screen.getByRole('heading', { name: 'Plan budget' })).toBeInTheDocument()
    expect(screen.getByText('Save as draft first, then record the plan budget on the participant’s Funding tab.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record plan budget' })).not.toBeInTheDocument()
  })

  it('offers to record the budget once the participant exists, and "Plan not shared yet" simply closes the editor without saving', async () => {
    const user = userEvent.setup()
    render(<Harness participantId="participant-1" />)

    expect(screen.getByText('Not recorded')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Record plan budget' }))
    expect(screen.getByRole('dialog', { name: 'Record plan budget' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Plan not shared yet' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(screen.getByText('Not recorded')).toBeInTheDocument()   // nothing was recorded, and nothing is wrong
  })

  it('summarises a recorded plan with Edit', () => {
    useFundingPlans.mockReturnValue({ data: { plans: [plan({ planStart: '2020-01-01', planEnd: '2099-12-31' })], profilePlanDates: {} }, isLoading: false, isError: false, refetch: vi.fn() })
    render(<Harness participantId="participant-1" />)

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByText('Not recorded')).not.toBeInTheDocument()
  })

  it('is not on the step for a participant whose funding is not the NDIS', () => {
    render(<Harness fundingSource="Other" participantId="participant-1" />)

    expect(screen.queryByRole('heading', { name: 'Plan budget' })).not.toBeInTheDocument()
    expect(screen.queryByText('Not recorded')).not.toBeInTheDocument()
  })

  it('is not on the step for a role that may not see money', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    render(<Harness participantId="participant-1" />)

    expect(screen.queryByRole('heading', { name: 'Plan budget' })).not.toBeInTheDocument()
    expect(useFundingPlans).not.toHaveBeenCalled()
  })
})
