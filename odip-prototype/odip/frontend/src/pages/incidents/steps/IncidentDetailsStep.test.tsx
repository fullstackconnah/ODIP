import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm, useWatch } from 'react-hook-form'
import { IncidentDetailsStep } from './IncidentDetailsStep'
import type { IncidentFormData } from '../incidentFormSchema'

function Harness({ called = true, services = [] as ('Police' | 'Ambulance' | 'Fire')[] }) {
  const { register, control, setValue, formState } = useForm<IncidentFormData>({
    defaultValues: { wereEmergencyServicesCalled: called, emergencyServices: services, injuries: [] },
  })
  return (
    <>
      <IncidentDetailsStep register={register} control={control} setValue={setValue} errors={formState.errors} incidentType="Illness"
        wereEmergencyServicesCalled={useWatch({ control, name: 'wereEmergencyServicesCalled' })} emergencyServices={useWatch({ control, name: 'emergencyServices' })} />
      <output data-testid="police">{useWatch({ control, name: 'policeOfficerName' }) ?? ''}</output>
    </>
  )
}

describe('IncidentDetailsStep emergency services', () => {
  it('shows nothing below the gate while it is unticked', () => {
    render(<Harness called={false} />)

    expect(screen.queryByRole('group', { name: 'Which services?' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Other details')).not.toBeInTheDocument()
  })

  it('offers Police, Ambulance, Fire in that order once the gate is ticked, with no fields until one is ticked', () => {
    render(<Harness />)

    const group = screen.getByRole('group', { name: 'Which services?' })
    expect(Array.from(group.querySelectorAll('input[type=checkbox]')).map((i) => i.parentElement?.textContent)).toEqual(['Police', 'Ambulance', 'Fire'])
    expect(screen.queryByLabelText("Police officer's name")).not.toBeInTheDocument()
    expect(screen.getByLabelText('Other details')).toBeInTheDocument()
  })

  it('adds the name and reference fields for each ticked service, in order', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('checkbox', { name: 'Fire' }))
    await user.click(screen.getByRole('checkbox', { name: 'Police' }))

    const labels = screen.getAllByLabelText(/officer's name|reference number/).map((e) => e.getAttribute('placeholder'))
    expect(labels).toEqual(['Who attended or who you spoke to', 'Event or case number', 'Who attended or who you spoke to', 'Event or case number'])
    expect(screen.getByLabelText("Police officer's name")).toBeInTheDocument()
    expect(screen.getByLabelText('Fire reference number')).toBeInTheDocument()
  })

  it('clears a service\'s fields when it is unticked', async () => {
    const user = userEvent.setup()
    render(<Harness services={['Police']} />)
    await user.type(screen.getByLabelText("Police officer's name"), 'Sgt Jane Doe')
    expect(screen.getByTestId('police')).toHaveTextContent('Sgt Jane Doe')

    await user.click(screen.getByRole('checkbox', { name: 'Police' }))

    expect(screen.queryByLabelText("Police officer's name")).not.toBeInTheDocument()
    expect(screen.getByTestId('police')).toHaveTextContent('')
  })
})
