import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { WitnessesStep, type WitnessesStepProps } from './WitnessesStep'
import type { IncidentFormData } from '../incidentFormSchema'
import type { IncidentWitnessDto } from '@/api/types/incidents'

const witness = (id: string, name: string, witnessStatus: IncidentWitnessDto['witnessStatus']): IncidentWitnessDto => ({
  id, witnessUserId: `user-${id}`, witnessName: name, isStaffWitness: true, witnessStatus,
  witnessRequestedAt: '2026-08-01T09:00:00Z', witnessRespondedAt: witnessStatus === 'Pending' ? null : '2026-08-01T10:00:00Z', statementText: null,
})
const EXISTING = [witness('w-1', 'Sam Okafor', 'Approved'), witness('w-2', 'Lee Tran', 'Pending')]

function Harness(props: Partial<WitnessesStepProps> & { withNew?: boolean }) {
  const { withNew, ...rest } = props
  const { control, formState: { errors } } = useForm<IncidentFormData>({
    defaultValues: {
      witnesses: [
        { existingId: 'w-1', witnessUserId: 'user-w-1', witnessName: 'Sam Okafor' },
        { existingId: 'w-2', witnessUserId: 'user-w-2', witnessName: 'Lee Tran' },
        ...(withNew ? [{ witnessUserId: 'user-new', witnessName: 'Ana Gomez' }] : []),
      ],
    },
  })
  return <WitnessesStep control={control} errors={errors} reportedByStaffId="staff-1" staff={[]} existingWitnesses={EXISTING} isEdit {...rest} />
}

const removeButtons = () => screen.getAllByRole('button', { name: 'Remove witness' })

describe('WitnessesStep', () => {
  it('addedHint defaults to the create text', () => {
    const { unmount } = render(<Harness withNew />)
    expect(screen.getByText('Will be asked to approve after this report is submitted')).toBeInTheDocument()
    unmount()

    render(<Harness withNew addedHint="Will be asked to approve after you save" />)
    expect(screen.getByText('Will be asked to approve after you save')).toBeInTheDocument()
    expect(screen.queryByText('Will be asked to approve after this report is submitted')).not.toBeInTheDocument()
  })

  it('confirmRemoveAnswered confirms only for Approved or Declined rows', async () => {
    const user = userEvent.setup()
    render(<Harness withNew confirmRemoveAnswered />)

    // A Pending row and a row not saved yet go straight away.
    await user.click(removeButtons()[2])
    expect(screen.queryByText('Ana Gomez')).not.toBeInTheDocument()
    await user.click(removeButtons()[1])
    expect(screen.queryByText('Lee Tran')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Remove /, { selector: 'h2, h3' })).not.toBeInTheDocument()

    // An Approved row asks first; Keep witness keeps it.
    await user.click(removeButtons()[0])
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Remove Sam Okafor?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Keep witness' }))
    expect(screen.getByText('Sam Okafor')).toBeInTheDocument()

    await user.click(removeButtons()[0])
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove witness' }))
    expect(screen.queryByText('Sam Okafor')).not.toBeInTheDocument()
  })

  it('without confirmRemoveAnswered an Approved row goes straight away, as in the create wizard', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(removeButtons()[0])
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Sam Okafor')).not.toBeInTheDocument()
  })
})
