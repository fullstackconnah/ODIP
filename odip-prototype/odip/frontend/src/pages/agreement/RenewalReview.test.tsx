import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ServiceAgreementDraftDto, ServiceAgreementDraftLineDto } from '@/api/types'
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
  it('sets the renewal beside the agreement it renews, line by line, with both totals', () => {
    render(<RenewalReview renewal={renewal} renewedFrom={renewedFrom} oldLines={oldLines} oldFailed={false} onRetry={vi.fn()} />)

    expect(screen.getByRole('heading', { level: 3, name: 'Renewal of v1' })).toBeInTheDocument()
    expect(screen.getByText('v2 runs from Mon 23 Nov 2026 to Sun 3 Jan 2027, priced from the price list as it is now. v1 ran from Mon 12 Oct 2026 to Sun 22 Nov 2026.')).toBeInTheDocument()
    const [weekdays, saturday] = screen.getAllByRole('row').slice(1)
    for (const text of [formatCurrency(70.23), formatCurrency(73.58), formatCurrency(8427.6), formatCurrency(8829.6), '2025-26 to 2026-27']) expect(within(weekdays).getByText(text)).toBeInTheDocument()
    expect(within(saturday).getByText('Not in the new price list')).toBeInTheDocument()
    expect(screen.getByText('1 line of v1 is not in the new price list, so v2 cannot be approved yet. Change that support on the Week step: To look at, below, names it.')).toBeInTheDocument()
    expect(screen.getByText(`v1 came to ${formatCurrency(9046.44)}; v2 comes to ${formatCurrency(8829.6)}.`)).toBeInTheDocument()
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
