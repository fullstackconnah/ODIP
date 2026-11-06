import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm, useWatch } from 'react-hook-form'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { pickAddress } from '@/test/addressPick'
import { AddressFields } from './sharedFieldControls'

vi.mock('@/api/client', async (real) => (await import('@/test/addressPick')).withAddressApi(await real<typeof import('@/api/client')>()))

function Harness({ postcodeError = false }: { postcodeError?: boolean }) {
  const { control, register, setValue, setError, formState: { errors, dirtyFields } } = useForm<ParticipantFormData>({ defaultValues: { addressStreet: '', addressSuburb: 'Old Suburb', addressState: 'NSW', addressPostcode: '2000' } })
  useEffect(() => { if (postcodeError) setError('addressPostcode', { message: 'Enter a 4-digit postcode' }) }, [postcodeError, setError])
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

  it('a pick clears an existing error on a field it fills (validated, not only dirtied)', async () => {
    const user = userEvent.setup()
    render(<Harness postcodeError />)
    expect(await screen.findByText('Enter a 4-digit postcode')).toBeInTheDocument()
    await pickAddress(user, screen.getByRole('combobox', { name: 'Street' }))
    await waitFor(() => expect(screen.queryByText('Enter a 4-digit postcode')).toBeNull())
  })

  it('typed text with no pick is the street, as before', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole('combobox', { name: 'Street' }), '7 Own Lane')
    expect(screen.getByTestId('saved')).toHaveTextContent('["7 Own Lane","Old Suburb","NSW","2000"]')
  })
})
