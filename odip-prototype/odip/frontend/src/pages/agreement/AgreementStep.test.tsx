import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { AgreementStep } from './AgreementStep'
import type { Details } from '@/lib/agreementDetails'

const base: Details = { state: 'NSW', zone: 'Standard', agreementStartDate: '2026-11-01', agreementEndDate: '2027-02-01', ongoing: false, representative: '', planOverride: null } as unknown as Details

function Harness({ initial, recorded = { start: '2026-10-01', end: '2027-09-30' } }: { initial: Details; recorded?: { start: string; end: string } | null }) {
  const [details, setDetails] = useState(initial)
  return <AgreementStep details={details} onEdit={patch => setDetails(d => ({ ...d, ...patch }))} recorded={recorded} plan={details.planOverride ?? { start: '2026-10-01', end: '2027-09-30' }} errors={{}} readOnly={false} fundingTab="/funding" />
}

const fold = () => screen.getByText('Different NDIS plan dates?').closest('details') as HTMLDetailsElement

describe('AgreementStep — plan dates fold', () => {
  it('is closed with no override and open with one', () => {
    const { unmount } = render(<Harness initial={base} />)
    expect(fold().open).toBe(false)
    unmount()
    render(<Harness initial={{ ...base, planOverride: { start: '2026-12-01', end: '2027-06-30' } }} />)
    expect(fold().open).toBe(true)
  })

  it('stays open after "Use the recorded dates" clears the override', async () => {
    render(<Harness initial={{ ...base, planOverride: { start: '2026-12-01', end: '2027-06-30' } }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Use the recorded dates' }))
    expect(fold().open).toBe(true)
  })
})

const endBox = () => screen.getByLabelText('Agreement ends') as HTMLInputElement
const length = () => screen.getByLabelText('Length') as HTMLSelectElement

describe('AgreementStep: Length presets and Ongoing', () => {
  it('a preset ends the day before the same date N months on', async () => {
    render(<Harness initial={{ ...base, agreementStartDate: '2026-01-01', agreementEndDate: '' }} />)
    await userEvent.selectOptions(length(), '1 month')
    expect(endBox().value).toBe('2026-01-31')
    await userEvent.selectOptions(length(), '12 months')
    expect(endBox().value).toBe('2026-12-31')
  })

  it('pins the clamped month end: 31 Jan + 1 month is 27 Feb in 2026', async () => {
    render(<Harness initial={{ ...base, agreementStartDate: '2026-01-31', agreementEndDate: '' }} />)
    await userEvent.selectOptions(length(), '1 month')
    expect(endBox().value).toBe('2026-02-27')
  })

  it('pins 31 Jan + 1 month as 28 Feb in a leap year', async () => {
    render(<Harness initial={{ ...base, agreementStartDate: '2028-01-31', agreementEndDate: '' }} />)
    await userEvent.selectOptions(length(), '1 month')
    expect(endBox().value).toBe('2028-02-28')
  })

  it('reads the preset back from the dates, and a hand edit switches Length to the custom choice', async () => {
    render(<Harness initial={{ ...base, agreementStartDate: '2026-11-01', agreementEndDate: '2027-01-31' }} />)
    expect(length().value).toBe('3')
    await userEvent.clear(endBox())
    await userEvent.type(endBox(), '2027-02-10')
    expect(length().value).toBe('custom')
  })

  it('disables the presets until a start is chosen', () => {
    render(<Harness initial={{ ...base, agreementStartDate: '', agreementEndDate: '' }} />)
    expect((screen.getByRole('option', { name: '6 months' }) as HTMLOptionElement).disabled).toBe(true)
    expect(screen.getByText('Choose the start first.')).toBeTruthy()
  })

  it('Ongoing swaps the end box for the plan end in words and stores the plan end', async () => {
    render(<Harness initial={base} />)
    await userEvent.selectOptions(length(), 'ongoing')
    expect(screen.queryByLabelText('Agreement ends')?.tagName).not.toBe('INPUT')
    expect(screen.getByText('Ongoing, to the plan end')).toBeTruthy()
    expect(screen.getByText(/Reviewed when the NDIS plan ends on .*2027/)).toBeTruthy()
  })

  it('Ongoing is disabled with no NDIS plan dates', () => {
    render(<MemoryRouter><Harness initial={base} recorded={null} /></MemoryRouter>)
    expect((screen.getByRole('option', { name: /^Ongoing/ }) as HTMLOptionElement).disabled).toBe(true)
    expect(screen.getByText('Add the NDIS plan dates to choose Ongoing.')).toBeTruthy()
  })

  it('the read-only list says ongoing', () => {
    render(<AgreementStep details={{ ...base, ongoing: true }} onEdit={() => {}} recorded={null} plan={{ start: '2026-10-01', end: '2027-09-30' }} errors={{}} readOnly fundingTab="/funding" />)
    expect(screen.getByText(/ongoing, repeating every week/)).toBeTruthy()
  })
})
