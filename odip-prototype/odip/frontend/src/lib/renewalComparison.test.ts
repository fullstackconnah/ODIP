import { describe, expect, it } from 'vitest'
import type { DraftBlock, ServiceAgreementDraftLineDto } from '@/api/types'
import { matchBlocks, renewalComparison, renewalTotals } from './renewalComparison'

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

// Fix round 1 (deep S2, CR-A S1): the agreement builder renumbers block ids on every save, so an edited renewal's ids no longer name v1's supports.
const block = (id: string, days: string[], start = '09:00') => ({ block: { id, supportType: 'PersonalCare', days, start, end: '15:00' }, requirements: {} }) as unknown as DraftBlock

describe('matchBlocks', () => {
  it('pairs the blocks of the same support whatever their ids, and leaves out a block the renewal no longer has', () => {
    const was = [block('b1', ['Monday', 'Friday']), block('b2', ['Saturday']), block('b3', ['Sunday'])]
    const now = [block('b1', ['Friday', 'Monday']), block('b2', ['Sunday']), block('b3', ['Saturday'], '10:00')]   // Saturday now starts at 10:00: a changed support

    expect([...matchBlocks(was, now)]).toEqual([['b1', 'b1'], ['b3', 'b2']])
  })

  it('pairs the lines through it, so a renumbered block still lines up and a removed one pairs with nothing', () => {
    const was = [block('b1', ['Monday']), block('b2', ['Saturday']), block('b3', ['Sunday'])]
    const now = [block('b1', ['Monday']), block('b2', ['Sunday'])]
    const rows = renewalComparison(
      [line({ blockId: 'b1' }), line({ blockId: 'b2', band: 'Saturday', itemCode: '01_013' }), line({ blockId: 'b3', band: 'Sunday', itemCode: '01_014' })],
      [line({ blockId: 'b1' }), line({ blockId: 'b2', band: 'Sunday', itemCode: '01_014' })],
      matchBlocks(was, now),
    )

    expect(rows.map(row => [row.itemCode, row.blockId, row.old !== null, row.renewal !== null])).toEqual([
      ['04_104_0125_6_1', 'b1', true, true], ['01_014', 'b2', true, true], ['01_013', null, true, false],
    ])
  })
})
