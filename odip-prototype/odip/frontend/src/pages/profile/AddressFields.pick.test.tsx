import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm, useWatch } from 'react-hook-form'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { pickAddress } from '@/test/addressPick'
import { AddressFields } from './sharedFieldControls'

vi.mock('@/api/client', async (real) => (await import('@/test/addressPick')).withAddressApi(await real<typeof import('@/api/client')>()))

function Harness() {
  const { control, register, setValue, formState: { errors, dirtyFields } } = useForm<ParticipantFormData>({ defaultValues: { addressStreet: '', addressSuburb: 'Old Suburb', addressState: 'NSW', addressPostcode: '2000' } })
  return (
    <>
      <AddressFields control={control} register={register} setValue={setValue} errors={errors} />
      <output data-testid="saved">{JSON.stringify(useWatch({ control, name: ['addressStreet', 'addressSuburb', 'addressState', 'addressPostcode'] }))}</output>
      <output data-testid="dirty">{Object.keys(dirtyFields).sort().join(',')}</output>
    </>
  )
}

describe('AddressFields (Profile wizard, caller C)', () => {
  it('a pick fills street, suburb, state and postcode, and marks them dirty', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await pickAddress(user, screen.getByRole('combobox', { name: 'Street' }))
    expect(screen.getByTestId('saved')).toHaveTextContent('["12 Example Street","Brisbane City","QLD","4000"]')
    expect(screen.getByTestId('dirty')).toHaveTextContent('addressPostcode,addressState,addressStreet,addressSuburb')
  })

  it('typed text with no pick is the street, as before', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole('combobox', { name: 'Street' }), '7 Own Lane')
    expect(screen.getByTestId('saved')).toHaveTextContent('["7 Own Lane","Old Suburb","NSW","2000"]')
  })
})
