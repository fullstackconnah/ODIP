import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm, useWatch } from 'react-hook-form'
import type { FieldErrors } from 'react-hook-form'
import { BasicsStep } from './BasicsStep'
import type { IncidentFormData } from '../incidentFormSchema'
import { INCIDENT_SEVERITY_DEFINITIONS } from '@/api/types/enums'

vi.mock('@/components/ParticipantPicker', () => ({ ParticipantPicker: () => null }))

/** A new form: nothing chosen yet (the page seeds incidentType and severity as ''). */
function Harness({ errors }: { errors?: FieldErrors<IncidentFormData> }) {
  const { register, setValue, control, formState } = useForm<IncidentFormData>({ defaultValues: { incidentType: '', severity: '' } })
  return (
    <BasicsStep register={register} setValue={setValue} errors={errors ?? formState.errors} serviceType={undefined} incidentType={useWatch({ control, name: 'incidentType' })}
      severity={useWatch({ control, name: 'severity' })} tripInstanceId={undefined} involvedParticipantId={undefined} reportedByStaffId={undefined} involvedStaffId={undefined}
      trips={[]} staff={[]} incidentServiceTypes={[]} />
  )
}

describe('BasicsStep', () => {
  // Guard: FormField passes aria-required to a custom child, so a screen reader hears that Severity is required.
  it('marks the Severity group as required', () => {
    render(<Harness />)

    expect(screen.getByRole('radiogroup', { name: /Severity/ })).toHaveAttribute('aria-required', 'true')
  })

  it('starts a new form with the type unchosen, so "Specify Incident Type" is not asked', () => {
    render(<Harness />)

    expect(screen.getByRole('button', { name: /Incident Type/ })).toHaveTextContent('Choose a type')
    expect(screen.queryByLabelText(/Specify Incident Type/)).not.toBeInTheDocument()
  })

  it('asks to specify only once Other is picked', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: /Incident Type/ }))
    await user.click(screen.getByRole('option', { name: 'Other' }))
    expect(screen.getByLabelText(/Specify Incident Type/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Incident Type/ }))
    await user.click(screen.getByRole('option', { name: 'Injury' }))
    expect(screen.queryByLabelText(/Specify Incident Type/)).not.toBeInTheDocument()
  })

  it('lists the owner\'s types in order, with Sexual Abuse', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: /Incident Type/ }))

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Injury', 'Medication Error', 'Illness', 'Restrictive Practice Use', 'Sexual Abuse', 'Abuse', 'Neglect',
      'Behaviour of Concern', 'Missing Person', 'Property Damage', 'Death', 'Other',
    ])
  })

  it('shows both choose-errors from the form', () => {
    render(<Harness errors={{
      incidentType: { type: 'custom', message: 'Choose an incident type.' },
      severity: { type: 'custom', message: 'Choose a severity level.' },
    }} />)

    expect(screen.getByText('Choose an incident type.')).toBeInTheDocument()
    expect(screen.getByText('Choose a severity level.')).toBeInTheDocument()
  })

  it('offers severity 1 to 4 with none checked, each titled with its definition', () => {
    render(<Harness />)

    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual(['1 Low', '2 Medium', '3 High', '4 Critical'])
    expect(radios.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(radios.map((r) => r.getAttribute('title'))).toEqual(Object.values(INCIDENT_SEVERITY_DEFINITIONS))
  })

  it('hints how to read the scale, then the chosen level\'s definition', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByText('1 is the least serious, 4 the most.')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: '3 High' }))

    expect(screen.getByText(INCIDENT_SEVERITY_DEFINITIONS.High)).toBeInTheDocument()
    expect(screen.queryByText('1 is the least serious, 4 the most.')).not.toBeInTheDocument()
  })
})
