import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ParticipantDetailsFold, type DetailsForm } from './ParticipantDetailsFold'

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
