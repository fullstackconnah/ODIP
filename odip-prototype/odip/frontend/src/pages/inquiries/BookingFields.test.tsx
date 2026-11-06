import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { pickAddress } from '@/test/addressPick'
import { BookingFields } from './BookingFields'
import type { BookingField, BookingForm } from '@/lib/intakeBooking'

vi.mock('@/api/client', async (real) => (await import('@/test/addressPick')).withAddressApi(await real<typeof import('@/api/client')>()))

const staff = { items: [], loading: false } as never
function Harness({ onChange }: { onChange: (f: BookingField, v: string) => void }) {
  const [form, setForm] = useState({ date: '', time: '', duration: '60', location: '', staffUserId: '', notes: '' } as BookingForm)
  return <BookingFields form={form} errors={{}} zone="Australia/Sydney" staff={staff} onChange={(f, v) => { onChange(f, v); setForm(s => ({ ...s, [f]: v })) }} />
}

describe('BookingFields address lookup (caller J, "Where")', () => {
  it('a pick puts the formatted address in Where (max 300)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const field = screen.getByRole('combobox', { name: /^Where/ })
    expect(field).toHaveAttribute('maxlength', '300')
    await pickAddress(user, field)
    expect(onChange).toHaveBeenLastCalledWith('location', '12 Example Street, Brisbane City QLD 4000')
    expect(field).toHaveValue('12 Example Street, Brisbane City QLD 4000')
  })
})
