import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm, useWatch } from 'react-hook-form'
import { RestrictivePracticeStep } from './RestrictivePracticeStep'
import type { IncidentFormData } from '../incidentFormSchema'
import type { RestrictivePracticeDto } from '@/api/types/restrictive-practices'

const { mockActive, mockAll, mockState, mockRefetch } = vi.hoisted(() => ({ mockRefetch: vi.fn(), mockActive: { current: [] as unknown[] }, mockAll: { current: [] as unknown[] }, mockState: { current: { isLoading: false, isError: false, isRefetching: false } } }))

vi.mock('@/api/hooks', () => ({
  useRestrictivePractices: (_participantId: string | undefined, includeInactive?: boolean) => ({ data: includeInactive ? mockAll.current : mockActive.current, refetch: mockRefetch, ...mockState.current }),
  useParticipantMedications: () => ({ data: [], isLoading: false }),
  useBulkCreateRestrictivePractices: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const entry = (over: Partial<RestrictivePracticeDto>): RestrictivePracticeDto => ({
  id: 'rp', participantId: 'p1', type: 'Seclusion', description: 'Desc', authorisedBy: 'Dr Chen', authorisationDate: '2026-09-01', reviewDate: null,
  isActive: true, isAuthorised: true, ...over,
} as RestrictivePracticeDto)

const SECLUSION = entry({ id: 'rp-1', type: 'Seclusion', description: 'Quiet room during crisis' })
const HOLD = entry({ id: 'rp-2', type: 'PhysicalRestraint', description: 'Two-person hold' })
const HOLD_B = entry({ id: 'rp-3', type: 'PhysicalRestraint', description: 'Arm guide at the kerb' })
const RETIRED = entry({ id: 'rp-4', type: 'ChemicalRestraint', description: 'Old PRN plan', isActive: false })

function Harness({ participantId = 'p1', defaults = {} }: { participantId?: string; defaults?: Partial<IncidentFormData> }) {
  const { getValues, setValue, control, formState } = useForm<IncidentFormData>({ defaultValues: { restrictivePracticeType: '', restrictivePracticeId: '', unapprovedRestrictivePracticeDetails: '', ...defaults } })
  const w = useWatch({ control })
  return (
    <>
      <output data-testid="values">{JSON.stringify({ type: w.restrictivePracticeType, id: w.restrictivePracticeId, details: w.unapprovedRestrictivePracticeDetails })}</output>
      <RestrictivePracticeStep getValues={getValues} setValue={setValue} errors={formState.errors} involvedParticipantId={participantId || undefined}
        restrictivePracticeType={w.restrictivePracticeType} restrictivePracticeId={w.restrictivePracticeId} unapprovedRestrictivePracticeDetails={w.unapprovedRestrictivePracticeDetails}
        usedWithoutAuthorisation={w.usedWithoutAuthorisation} rpUseVaried={w.rpUseVaried} description={w.description} isEdit={false} existingIncident={undefined} />
    </>
  )
}
const values = () => JSON.parse(screen.getByTestId('values').textContent ?? '{}')
const typeDropdown = () => screen.queryByLabelText(/Restrictive Practice Type/i)
const noneRadio = () => screen.getByRole('radio', { name: /None of these/i })

beforeEach(() => { mockRefetch.mockClear(); mockState.current = { isLoading: false, isError: false, isRefetching: false }; mockActive.current = [SECLUSION, HOLD_B, HOLD]; mockAll.current = [SECLUSION, HOLD_B, HOLD, RETIRED] })

describe('RestrictivePracticeStep register list', () => {
  it('lists every active entry of every kind, kind first, sorted by kind then description, with "None of these" last and no type dropdown', () => {
    render(<Harness />)

    const rows = within(screen.getByRole('radiogroup', { name: 'Which practice was used?' })).getAllByRole('radio').map((r) => r.closest('label')?.textContent ?? '')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatch(/^Physical restraintArm guide at the kerb/)
    expect(rows[1]).toMatch(/^Physical restraintTwo-person hold/)
    expect(rows[2]).toMatch(/^SeclusionQuiet room during crisis/)
    expect(rows[3]).toMatch(/^None of these/)
    expect(typeDropdown()).not.toBeInTheDocument()
  })

  it('picking an entry sets the type to its kind and keeps the type dropdown hidden', async () => {
    render(<Harness />)

    await userEvent.setup().click(screen.getByRole('radio', { name: /Quiet room during crisis/ }))

    expect(values()).toMatchObject({ type: 'Seclusion', id: 'rp-1', details: '' })
    expect(typeDropdown()).not.toBeInTheDocument()
  })

  it('"None of these" shows the type dropdown and the details box, keeps the type the entry set, and clears the link', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('radio', { name: /Quiet room during crisis/ }))

    await user.click(noneRadio())

    expect(values()).toMatchObject({ type: 'Seclusion', id: '' })
    expect(typeDropdown()).toBeInTheDocument()
    expect(screen.getByLabelText(/Describe the restrictive practice that was used/)).toBeInTheDocument()
  })

  it('an empty register shows only "None of these", already picked, with the type dropdown and the details box', () => {
    mockActive.current = []
    render(<Harness />)

    expect(screen.getAllByRole('radio')).toHaveLength(1)
    expect(noneRadio()).toBeChecked()
    expect(typeDropdown()).toBeInTheDocument()
    expect(screen.getByLabelText(/Describe the restrictive practice that was used/)).toBeInTheDocument()
  })

  it('with no participant chosen the type dropdown comes first, as before', () => {
    render(<Harness participantId="" />)

    expect(typeDropdown()).toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('with no participant, picking a type then "None of these" still shows exactly one type field', async () => {
    const user = userEvent.setup()
    render(<Harness participantId="" />)
    await user.click(screen.getByLabelText(/Restrictive Practice Type/i))
    await user.click(await screen.findByRole('option', { name: /Seclusion/ }))

    await user.click(noneRadio())

    expect(screen.getAllByLabelText(/Restrictive Practice Type/i)).toHaveLength(1)
  })

  it('in edit mode, while the register loads, the type dropdown does not flash', () => {
    mockState.current = { isLoading: true, isError: false }
    mockActive.current = []
    render(<Harness defaults={{ restrictivePracticeType: 'Seclusion', restrictivePracticeId: 'rp-1' }} />)

    expect(typeDropdown()).not.toBeInTheDocument()
  })

  it('a failed register load shows the error, not the empty-register line, and keeps "None of these" usable', async () => {
    mockState.current = { isLoading: false, isError: true }
    mockActive.current = []
    render(<Harness />)

    expect(screen.getByText("Couldn't load this participant's register. You can still choose None of these and describe the practice.")).toBeInTheDocument()
    expect(screen.queryByText(/No active practices are on this participant/)).not.toBeInTheDocument()
    expect(noneRadio()).not.toBeChecked()
    await userEvent.setup().click(noneRadio())
    expect(screen.getByLabelText(/Describe the restrictive practice that was used/)).toBeInTheDocument()
  })

  it('a failed background refetch over a populated register keeps the list and shows no error', () => {
    mockState.current = { isLoading: false, isError: true, isRefetching: false }
    render(<Harness />)

    expect(screen.queryByText(/Couldn't load this participant's register/)).not.toBeInTheDocument()
    expect(screen.getByText(/Seclusion/)).toBeInTheDocument()
  })

  it('the register error has a Try again that refetches once; while refetching it is disabled and reads Trying again', async () => {
    mockState.current = { isLoading: false, isError: true, isRefetching: false }
    mockActive.current = []
    const { unmount } = render(<Harness />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
    unmount()

    mockState.current = { isLoading: false, isError: true, isRefetching: true }
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Trying again…' })).toHaveAttribute('aria-disabled', 'true')
    expect(noneRadio()).toBeEnabled()
  })

  it('the inactive disclosure lists every inactive entry with its kind', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: /Show inactive\/retired practices/ }))

    const retired = await screen.findByText('Old PRN plan')
    expect(retired.parentElement).toHaveTextContent('Chemical restraint')
  })
})
