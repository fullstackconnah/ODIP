import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DraftBlock, ServiceAgreementDraftDto, ServiceAgreementDraftLineDto } from '@/api/types'
import { formatCurrency } from '@/lib/utils'
import { RenewalReview } from './RenewalReview'

const line = (over: Partial<ServiceAgreementDraftLineDto>): ServiceAgreementDraftLineDto => ({
  serviceType: 'Community access', hours: 120, itemCode: '04_104_0125_6_1', unitPrice: 73.58, catalogueVersion: '2026-27', catalogueEffectiveFrom: '2026-07-01', catalogueEffectiveTo: null,
  blockId: 'weekdays', band: 'Daytime', unit: 'H', total: 8829.6, occurrences: 30, flags: 'None', ...over,
})
const revision = (version: number, from: string, to: string, lines: ServiceAgreementDraftLineDto[]) => ({
  id: `d-${version}`, participantId: 'p-1', version, state: 'NSW', planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: from, agreementEndDate: to,
  blocks: [], lines, isSummary: false, blockCount: 1, lineCount: lines.length, total: 0, caveats: [],
}) as ServiceAgreementDraftDto

const oldLines = [line({ unitPrice: 70.23, total: 8427.6, catalogueVersion: '2025-26' }), line({ blockId: 'sat', itemCode: '04_105_0125_6_1', band: 'Saturday', unitPrice: 103.14, total: 618.84 })]
const renewedFrom = { ...revision(1, '2026-10-12', '2026-11-22', []), isSummary: true }
// The price list has withdrawn the Saturday item: the renewal's own pricing says so for that block.
const renewal = { ...revision(2, '2026-11-23', '2027-01-03', [line({})]), pricing: { issues: [{ blockId: 'sat', reason: 'CatalogueNotFound', message: 'No price list item.', count: 6 }] } } as unknown as ServiceAgreementDraftDto

describe('RenewalReview', () => {
  it('says so when neither agreement has lines to compare', () => {
    render(<RenewalReview renewal={revision(2, '2026-11-23', '2027-01-03', [])} renewedFrom={renewedFrom} oldLines={[]} oldFailed={false} onRetry={vi.fn()} />)
    expect(screen.getByText('Neither agreement has lines to compare.')).toBeInTheDocument()
  })

  it('sets the renewal beside the agreement it renews, line by line, with both totals', () => {
    render(<RenewalReview renewal={renewal} renewedFrom={renewedFrom} oldLines={oldLines} oldFailed={false} onRetry={vi.fn()} />)

    expect(screen.getByRole('heading', { level: 3, name: 'Renewal of v1' })).toBeInTheDocument()
    expect(screen.getByText('v2 runs from Mon 23 Nov 2026 to Sun 3 Jan 2027, priced from the price list as it is now. v1 ran from Mon 12 Oct 2026 to Sun 22 Nov 2026.')).toBeInTheDocument()
    const [weekdays, saturday] = screen.getAllByRole('row').slice(1)
    for (const text of [formatCurrency(70.23), formatCurrency(73.58), formatCurrency(8427.6), formatCurrency(8829.6), '2025-26 to 2026-27']) expect(within(weekdays).getByText(text)).toBeInTheDocument()
    expect(within(saturday).getByText('Not in the new price list')).toBeInTheDocument()
    // Fix round 2 (finish 3): the callout defers to To look at, which gives the one remedy.
    expect(screen.getByText('1 line of v1 is not in the new price list, so v2 cannot be approved yet: To look at, below, says what to change.')).toBeInTheDocument()
    expect(screen.getByText(`v1 came to ${formatCurrency(9046.44)}; v2 comes to ${formatCurrency(8829.6)}.`)).toBeInTheDocument()
  })

  it('does not set the totals of a tail-only revision beside a full-term renewal (a pattern change covers only its last weeks)', () => {
    // v2 was a pattern change on 2026-11-02: the revision renewed covers 2 Nov to 22 Nov only, while the agreement began on 12 Oct.
    const tail = { ...revision(2, '2026-11-02', '2026-11-22', []), isSummary: true }
    render(<RenewalReview renewal={revision(3, '2026-11-23', '2027-01-03', [line({})])} renewedFrom={tail} termStart="2026-10-12" oldLines={oldLines} oldFailed={false} onRetry={vi.fn()} />)

    expect(screen.getByText(/v2 only covers the end of the agreement \(Mon 2 Nov 2026 to Sun 22 Nov 2026; the agreement began on Mon 12 Oct 2026\), so its total is not compared with v3.s\. The unit prices are\./)).toBeInTheDocument()
    expect(screen.queryByText(/came to/)).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'v2 total' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'v2 unit price' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'v3 total' })).toBeInTheDocument()
  })

  it('compares the totals as usual when the term starts the day the revision renewed starts', () => {
    render(<RenewalReview renewal={renewal} renewedFrom={renewedFrom} termStart="2026-10-12" oldLines={oldLines} oldFailed={false} onRetry={vi.fn()} />)

    expect(screen.getByText(/v1 ran from/)).toBeInTheDocument()
    expect(screen.queryByText(/only covers the end/)).not.toBeInTheDocument()
    expect(screen.getByText(/v1 came to/)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'v1 total' })).toBeInTheDocument()
  })

  it('marks an old line the renewal\u0027s dates do not reach as such, not as missing, and says nothing blocks approval', () => {
    // A public holiday in v1's dates and none in v2's: the line has no partner, but nothing is withdrawn.
    const holiday = line({ band: 'Public Holiday', itemCode: '04_102_0125_6_1', unitPrice: 163.46, total: 653.84 })
    render(<RenewalReview renewal={revision(2, '2026-11-23', '2027-01-03', [line({})])} renewedFrom={renewedFrom} oldLines={[line({}), holiday]} oldFailed={false} onRetry={vi.fn()} />)

    const [, holidayRow] = screen.getAllByRole('row').slice(1)
    expect(within(holidayRow).getByText("Not in v2's dates")).toBeInTheDocument()
    expect(screen.queryByText('Not in the new price list')).not.toBeInTheDocument()
    expect(screen.queryByText(/cannot be approved yet/)).not.toBeInTheDocument()
  })

  it('still pairs the lines once the renewal is edited and saved, though the builder renumbered its blocks (fix round 1, deep S2)', () => {
    const block = (id: string, days: string[]) => ({ block: { id, supportType: 'PersonalCare', days, start: '09:00', end: '15:00' }, requirements: {} }) as unknown as DraftBlock
    const saturday = line({ blockId: 'b2', itemCode: '01_013_0107_1_1', band: 'Saturday', unitPrice: 103.14, total: 618.84 })
    const sunday = line({ blockId: 'b3', itemCode: '01_014_0107_1_1', band: 'Sunday', unitPrice: 132.69, total: 796.14 })
    // v1 had weekdays, Saturday and Sunday. The renewal was edited to drop Saturday and saved: Sunday is b2 now, and the new price list has withdrawn its item.
    const edited = {
      ...revision(2, '2026-11-23', '2027-01-03', [line({ blockId: 'b1' })]), blocks: [block('b1', ['Monday']), block('b2', ['Sunday'])],
      pricing: { issues: [{ blockId: 'b2', reason: 'CatalogueNotFound', message: 'No price list item.', count: 6 }] },
    } as unknown as ServiceAgreementDraftDto
    render(<RenewalReview renewal={edited} renewedFrom={renewedFrom} oldBlocks={[block('b1', ['Monday']), block('b2', ['Saturday']), block('b3', ['Sunday'])]}
      oldLines={[line({ blockId: 'b1', unitPrice: 70.23, total: 8427.6 }), saturday, sunday]} oldFailed={false} onRetry={vi.fn()} />)

    const [weekdays, removed, withdrawn] = screen.getAllByRole('row').slice(1)
    expect(within(weekdays).getByText(formatCurrency(70.23))).toBeInTheDocument()                     // paired: the old price beside the new
    expect(within(weekdays).getByText(formatCurrency(73.58))).toBeInTheDocument()
    expect(within(weekdays).getByText('2026-27')).toBeInTheDocument()                                 // one version when the price list did not change (fix round 2, finish 4)
    expect(within(weekdays).queryByText('2026-27 to 2026-27')).not.toBeInTheDocument()
    expect(within(removed).getByText('01_013_0107_1_1 · Saturday')).toBeInTheDocument()
    expect(within(removed).getByText("Not in v2's dates")).toBeInTheDocument()                      // removed on purpose: nothing withdrawn
    expect(within(withdrawn).getByText('01_014_0107_1_1 · Sunday')).toBeInTheDocument()
    expect(within(withdrawn).getByText('Not in the new price list')).toBeInTheDocument()
    expect(screen.getByText(/^1 line of v1 is not in the new price list/)).toBeInTheDocument()
  })

  it('says nothing about lines while the old ones are read, and offers a retry when they could not be', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<RenewalReview renewal={renewal} renewedFrom={renewedFrom} oldLines={undefined} oldFailed={false} onRetry={onRetry} />)
    expect(screen.queryByText('Not in the new price list')).not.toBeInTheDocument()

    rerender(<RenewalReview renewal={renewal} renewedFrom={renewedFrom} oldLines={undefined} oldFailed onRetry={onRetry} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('The lines of v1 could not be read')).toBeInTheDocument()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
