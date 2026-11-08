import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm, useWatch } from 'react-hook-form'
import { ParticipantDetailsStep } from './ParticipantDetailsStep'
import { resetAddressLookup } from '@/lib/addressLookupState'
import type { ParticipantFormData } from '@/lib/participantSchema'

const { apiPost, apiGet } = vi.hoisted(() => ({ apiPost: vi.fn(), apiGet: vi.fn() }))
vi.mock('@/api/client', () => ({ apiPost, apiGet }))

/** The step in a real form, with the values and dirty fields printed so a pick can be read back. */
function Harness() {
  const { control, register, setValue, formState: { errors, dirtyFields } } = useForm<ParticipantFormData>({ defaultValues: {} as ParticipantFormData })
  const w = useWatch({ control })
  return (
    <>
      <ParticipantDetailsStep control={control} register={register} setValue={setValue} errors={errors} livingArrangementValue={undefined} />
      <output data-testid="values">{JSON.stringify({ street: w.addressStreet, suburb: w.addressSuburb, state: w.addressState, postcode: w.addressPostcode })}</output>
      <output data-testid="dirty">{JSON.stringify(Object.keys(dirtyFields).sort())}</output>
    </>
  )
}

beforeEach(() => {
  resetAddressLookup()
  apiPost.mockReset().mockResolvedValue([{ placeId: 'p1', mainText: '12 Example Street', secondaryText: 'Brisbane City QLD' }])
  apiGet.mockReset().mockResolvedValue({ street: '12 Example Street', suburb: 'Brisbane City', state: 'QLD', postcode: '4000', formattedAddress: '12 Example Street, Brisbane City QLD 4000' })
})

describe('ParticipantDetailsStep — field limits', () => {
  it('stops First name at the 100 characters the server accepts', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const first = screen.getByLabelText(/first name/i)
    await user.click(first)
    await user.paste('x'.repeat(150))

    expect(first).toHaveValue('x'.repeat(100))
  })
})

describe('ParticipantDetailsStep — address lookup', () => {
  it('a picked suggestion sets street, suburb, state and postcode in the form, all dirty', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByLabelText('Street'), '12 Exam')
    await user.click(await screen.findByRole('option', { name: /12 Example Street/ }))

    expect(JSON.parse(screen.getByTestId('values').textContent ?? '')).toEqual({ street: '12 Example Street', suburb: 'Brisbane City', state: 'QLD', postcode: '4000' })
    expect(JSON.parse(screen.getByTestId('dirty').textContent ?? '')).toEqual(['addressPostcode', 'addressState', 'addressStreet', 'addressSuburb'])
    expect(screen.getByLabelText('Suburb')).toHaveValue('Brisbane City')
  })

  it('typing the street by hand still works with the lookup refused (no key)', async () => {
    const user = userEvent.setup()
    apiPost.mockRejectedValue({ response: { status: 404 } })
    render(<Harness />)

    await user.type(screen.getByLabelText('Street'), '5 Hand Street')

    expect(JSON.parse(screen.getByTestId('values').textContent ?? '').street).toBe('5 Hand Street')
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
