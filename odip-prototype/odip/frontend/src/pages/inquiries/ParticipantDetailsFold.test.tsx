import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { pickAddress } from '@/test/addressPick'
import { ParticipantDetailsFold, type DetailsForm } from './ParticipantDetailsFold'
vi.mock('@/api/client', async (real) => (await import('@/test/addressPick')).withAddressApi(await real<typeof import('@/api/client')>()))

const form: DetailsForm = { addressStreet: '', addressSuburb: '', addressState: '', addressPostcode: '', dateOfBirth: '', ndisNumber: '', planType: '', planStartDate: '', planEndDate: '' }
const fold = (open: boolean) => <ParticipantDetailsFold form={form} errors={{}} open={open} today="2026-10-28" onToggle={() => undefined} onChange={() => undefined} />

describe('ParticipantDetailsFold motion', () => {
  it('marks a fold that is open when it mounts as static, so it appears at once', () => {
    const { container } = render(fold(true))
    expect(container.querySelector('details')).toHaveAttribute('data-fold-static')
  })

  it('leaves a fold that mounts closed unmarked, so it still fades when the user opens it', () => {
    const { container, rerender } = render(fold(false))
    rerender(fold(true))
    expect(container.querySelector('details')).not.toHaveAttribute('data-fold-static')
  })
})

describe('ParticipantDetailsFold address lookup (caller D)', () => {
  it('a pick fills the street (cut to 200) and the other three address fields', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ParticipantDetailsFold form={form} errors={{}} open today="2026-10-28" onToggle={() => undefined} onChange={onChange} />)
    await pickAddress(user, screen.getByRole('combobox', { name: 'Street' }))
    expect(onChange.mock.calls).toEqual(expect.arrayContaining([
      ['addressStreet', '12 Example Street'], ['addressSuburb', 'Brisbane City'], ['addressState', 'QLD'], ['addressPostcode', '4000'],
    ]))
    expect(screen.getByRole('combobox', { name: 'Street' })).toHaveAttribute('maxlength', '200')
  })
})
