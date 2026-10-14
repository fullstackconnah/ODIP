import { describe, expect, it } from 'vitest'
import type { ServiceAgreementDraftLineDto } from '@/api/types'
import { renewalComparison, renewalTotals } from './renewalComparison'

const line = (over: Partial<ServiceAgreementDraftLineDto>): ServiceAgreementDraftLineDto => ({
  serviceType: 'Community access', hours: 120, itemCode: '04_104_0125_6_1', unitPrice: 73.58, catalogueVersion: '2026-27', catalogueEffectiveFrom: '2026-07-01', catalogueEffectiveTo: null,
  blockId: 'weekdays', band: 'Daytime', unit: 'H', total: 8829.6, occurrences: 30, flags: 'None', ...over,
})
const saturday = { blockId: 'sat', band: 'Saturday', itemCode: '04_105_0125_6_1', unitPrice: 103.14, total: 2475.36 }

describe('renewalComparison', () => {
  it('matches lines on block, item, band and unit, in the renewal\'s order, with each side\'s price and catalogue version', () => {
    const rows = renewalComparison(
      [line({ unitPrice: 70.23, total: 8427.6, catalogueVersion: '2025-26', catalogueEffectiveFrom: '2025-07-01' }), line(saturday)],
      [line(saturday), line({})],
    )

    expect(rows.map(row => [row.blockId, row.itemCode, row.old?.unitPrice, row.renewal?.unitPrice, row.old?.catalogueVersion, row.renewal?.catalogueVersion])).toEqual([
      ['sat', '04_105_0125_6_1', 103.14, 103.14, '2026-27', '2026-27'],
      ['weekdays', '04_104_0125_6_1', 70.23, 73.58, '2025-26', '2026-27'],
    ])
  })

  it('shows a key with several price rows at its newest row, with the summed total', () => {
    const [row] = renewalComparison([
      line({ unitPrice: 70.23, total: 702.3, catalogueVersion: '2025-26', catalogueEffectiveFrom: '2025-07-01' }),
      line({ unitPrice: 73.58, total: 294.32, catalogueVersion: '2026-27', catalogueEffectiveFrom: '2026-07-01' }),
    ], [line({})])

    expect(row.old).toEqual({ unitPrice: 73.58, total: 996.62, catalogueVersion: '2026-27' })
  })

  it('an old line the new price list has not got comes last, marked missing', () => {
    const rows = renewalComparison([line({}), line(saturday)], [line({ blockId: 'night', itemCode: '01_002_0107_1_1', band: 'Night' }), line({})])

    // The renewal's own lines first, a new one included; the old Saturday line it has not got comes last, with no renewal side.
    expect(rows.map(row => [row.blockId, row.old === null, row.renewal === null])).toEqual([['night', true, false], ['weekdays', false, false], ['sat', false, true]])
  })

  it('adds up both sides to the cent', () => {
    const rows = renewalComparison([line({ total: 0.1 }), line({ blockId: 'b', total: 0.2 })], [line({ total: 0.2 }), line({ blockId: 'b', total: 0.1 })])

    expect(renewalTotals(rows)).toEqual({ old: 0.3, renewal: 0.3 })
  })
})
