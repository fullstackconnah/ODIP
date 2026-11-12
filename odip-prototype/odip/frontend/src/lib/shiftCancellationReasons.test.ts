import { describe, expect, it } from 'vitest'
import { SHIFT_CANCELLATION_REASON_VALUES } from '@/api/types/enums'
import { SHIFT_CANCELLATION_REASONS, shiftCancellationReasonLabel } from './shiftCancellationReasons'

describe('shift cancellation reasons', () => {
  it('lists the ten reasons in the order the server enum and the report use', () => {
    expect(SHIFT_CANCELLATION_REASONS.map(r => r.value)).toEqual([...SHIFT_CANCELLATION_REASON_VALUES])
    expect(SHIFT_CANCELLATION_REASONS.map(r => r.label)).toEqual([
      'Participant unwell', 'Participant family matter', 'Participant transport unavailable', 'Participant did not attend', 'Participant cancelled, other reason',
      'Staff unavailable', 'Cancelled by the provider', 'Weather or emergency', 'Rostered by mistake', 'Other',
    ])
  })

  it('labels a reason, and a missing one as Not recorded', () => {
    expect(shiftCancellationReasonLabel('Weather')).toBe('Weather or emergency')
    expect(shiftCancellationReasonLabel(null)).toBe('Not recorded')
    expect(shiftCancellationReasonLabel(undefined)).toBe('Not recorded')
  })

  it('has no blank item, so a set reason cannot be cleared from the menu', () => {
    expect(SHIFT_CANCELLATION_REASONS.every(r => r.value !== '' && r.label !== '')).toBe(true)
  })
})
