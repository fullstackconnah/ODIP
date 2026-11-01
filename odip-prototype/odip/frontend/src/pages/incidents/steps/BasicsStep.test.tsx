import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { BasicsStep } from './BasicsStep'
import type { IncidentFormData } from '../incidentFormSchema'

vi.mock('@/components/ParticipantPicker', () => ({ ParticipantPicker: () => null }))

function Harness() {
  const { register, setValue, formState } = useForm<IncidentFormData>()
  return (
    <BasicsStep register={register} setValue={setValue} errors={formState.errors} serviceType={undefined} incidentType={undefined}
      severity="Low" tripInstanceId={undefined} involvedParticipantId={undefined} reportedByStaffId={undefined} involvedStaffId={undefined}
      trips={[]} staff={[]} incidentServiceTypes={[]} />
  )
}

describe('BasicsStep', () => {
  // Guard: FormField passes aria-required to a custom child, so a screen reader hears that Severity is required.
  it('marks the Severity group as required', () => {
    render(<Harness />)

    expect(screen.getByRole('radiogroup', { name: /Severity/ })).toHaveAttribute('aria-required', 'true')
  })
})
