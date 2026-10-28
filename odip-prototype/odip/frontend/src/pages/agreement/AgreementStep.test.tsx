import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgreementStep } from './AgreementStep'
import type { Details } from '@/lib/agreementDetails'

const base: Details = { state: 'NSW', zone: 'Standard', agreementStartDate: '2026-11-01', agreementEndDate: '2027-02-01', representative: '', planOverride: null } as unknown as Details

function Harness({ initial }: { initial: Details }) {
  const [details, setDetails] = useState(initial)
  return <AgreementStep details={details} onEdit={patch => setDetails(d => ({ ...d, ...patch }))} recorded={{ start: '2026-10-01', end: '2027-09-30' }} plan={details.planOverride ?? { start: '2026-10-01', end: '2027-09-30' }} errors={{}} readOnly={false} fundingTab="/funding" />
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
