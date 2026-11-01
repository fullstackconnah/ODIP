import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SupportTypeField } from './SupportTypeField'
import type { SupportActivityGroupDto, SupportCatalogueItemDto } from '@/api/types'

const { catalogue } = vi.hoisted(() => ({ catalogue: { current: { data: undefined, isLoading: false, isError: false } as { data?: unknown; isLoading: boolean; isError: boolean } } }))
vi.mock('@/api/hooks', () => ({ useSupportCatalogue: () => catalogue.current }))

function item(unit: string, effectiveFrom = '2026-07-01', effectiveTo?: string): SupportCatalogueItemDto {
  return { id: `${unit}-${effectiveFrom}`, itemNumber: '04_X', description: 'x', unit, effectiveFrom, effectiveTo } as SupportCatalogueItemDto
}
function group(groupCode: string, displayName: string, items: SupportCatalogueItemDto[]): SupportActivityGroupDto {
  return { id: groupCode, groupCode, displayName, supportCategory: 4, isActive: true, items }
}

const GROUPS = [
  group('GRP_PARTICIPATION', 'Community participation', [item('H')]),
  group('GRP_ART', 'Art therapy', [item('H')]),
  group('GRP_TRANSPORT', 'Transport', [item('EA')]),
  group('GRP_OLD', 'Respite', [item('H', '2025-07-01', '2026-06-30')]),
]

const DATE = '2026-11-03'
const HINT = 'Claims use its rate for this shift\'s day.'

function show(props: Partial<React.ComponentProps<typeof SupportTypeField>> = {}) {
  const onChange = vi.fn()
  render(<SupportTypeField value="" onChange={onChange} date={DATE} canWrite hint={HINT} {...props} />)
  return { onChange, control: screen.getByRole('combobox', { name: 'Support type' }) }
}

beforeEach(() => { catalogue.current = { data: GROUPS, isLoading: false, isError: false } })

describe('SupportTypeField', () => {
  it('lists community access first, then only the groups with an hourly row valid on the date, by name', async () => {
    const user = userEvent.setup()
    const { control } = show()
    expect(control).toHaveValue('Community access (default)')
    await user.click(control)
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Community access (default)', 'Art therapy', 'Community participation'])
  })

  it('picks a group by typing and reports its code', async () => {
    const user = userEvent.setup()
    const { control, onChange } = show()
    await user.click(control)
    await user.type(control, 'art')
    await user.click(screen.getByRole('option', { name: 'Art therapy' }))
    expect(onChange).toHaveBeenCalledWith('GRP_ART')
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    const { control } = show()
    await user.click(control)
    await user.type(control, 'zzz')
    expect(screen.getByText('No support type matches.')).toBeInTheDocument()
  })

  it('shows the state line as the helper and leaves no alert', () => {
    show()
    expect(screen.getByText(HINT)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a stored type that has no hourly rate on the date, and says so in the alert slot with the date in one piece', () => {
    show({ value: 'GRP_OLD' })
    expect(screen.getByRole('combobox', { name: 'Support type' })).toHaveValue('Respite')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Respite has no hourly rate on Tue 3 Nov 2026. Choose another support type, or import the catalogue for that date.')
    expect(alert.textContent).toContain('Tue 3 Nov 2026')
  })

  it('shows the raw code for a stored type the catalogue does not have', () => {
    show({ value: 'GRP_GONE' })
    expect(screen.getByRole('combobox', { name: 'Support type' })).toHaveValue('GRP_GONE')
    expect(screen.getByRole('alert')).toHaveTextContent('GRP_GONE has no hourly rate on')
  })

  it('is disabled while the shift is on a claim, with the claim in the described-by line', () => {
    const { control } = show({ value: 'GRP_ART', claimReference: 'CLM-0042' })
    expect(control).toBeDisabled()
    expect(control).toHaveValue('Art therapy')
    const described = document.getElementById(control.getAttribute('aria-describedby')!.split(' ')[0])
    expect(described).toHaveTextContent('On claim CLM-0042. Delete that claim to change the support type.')
  })

  it('is disabled and says it is loading while the catalogue loads', () => {
    catalogue.current = { data: undefined, isLoading: true, isError: false }
    const { control } = show()
    expect(control).toBeDisabled()
    expect(control).toHaveAttribute('placeholder', 'Loading support types…')
  })

  it('is disabled with the value shown and an alert when the catalogue fails', () => {
    catalogue.current = { data: undefined, isLoading: false, isError: true }
    const { control } = show({ value: 'GRP_ART' })
    expect(control).toBeDisabled()
    expect(control).toHaveValue('GRP_ART')
    expect(screen.getByRole('alert')).toHaveTextContent("Support types didn't load. Close the panel and open it again.")
  })

  it('is disabled for a reader who cannot write', () => {
    const { control } = show({ canWrite: false, value: 'GRP_ART' })
    expect(control).toBeDisabled()
    expect(control).toHaveValue('Art therapy')
  })

  it('points to the catalogue import when it has no hourly types', () => {
    catalogue.current = { data: [group('GRP_TRANSPORT', 'Transport', [item('EA')])], isLoading: false, isError: false }
    show()
    expect(screen.getByText('The catalogue has no hourly support types. Import it under Support catalogue.')).toBeInTheDocument()
  })
})
