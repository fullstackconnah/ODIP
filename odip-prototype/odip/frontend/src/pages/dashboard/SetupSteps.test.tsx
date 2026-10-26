import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ProviderSettingsDto, SetupStatusDto } from '@/api/types'
import { SetupSteps } from './SetupSteps'

const empty: SetupStatusDto = { staffCount: 0, participantCount: 0, participantsWithPlanCount: 0, firstPublishedWeekStart: null, hasInvoice: false, employmentHeroAvailable: false }
const provider = (over: Partial<ProviderSettingsDto> = {}) => ({ organisationName: 'Sunrise Care', address: '1 Main St', state: 'NSW', ...over }) as ProviderSettingsDto

function show(status: SetupStatusDto, prov: ProviderSettingsDto | null, role = 'Admin', card: 'steps' | 'done' = 'steps', onHide = () => {}) {
  localStorage.setItem('odip_user', JSON.stringify({ role, tenantId: 't1' }))
  return render(
    <MemoryRouter>
      <div id="dashboard-alerts" tabIndex={-1} />
      <SetupSteps status={status} provider={prov} card={card} onHide={onHide} />
    </MemoryRouter>,
  )
}
// The one primary is the link whose class carries the house primary fill.
const primaries = () => screen.queryAllByRole('link').filter((a) => a.className.includes('bg-[var(--color-primary)]'))

beforeEach(() => localStorage.clear())

describe('SetupSteps', () => {
  it('0 of 5: Review details is the only primary; plans row says Add participants first with no action', () => {
    show(empty, null)
    expect(screen.getByText('0 of 5 done')).toBeInTheDocument()
    expect(primaries().map((a) => a.textContent)).toEqual(['Review details'])
    expect(screen.getByText('Add participants first')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Import plans' })).toBeNull()
  })

  it('rows 1-2 done fold with no actions; Import participants is the only primary', () => {
    show({ ...empty, staffCount: 20 }, provider())
    expect(screen.getByText('2 of 5 done')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Review details' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Import staff' })).toBeNull()
    expect(screen.getByText('20 staff members, not counting Admins')).toBeInTheDocument()
    expect(primaries().map((a) => a.textContent)).toEqual(['Import participants'])
  })

  it('plans partial: 4 of 5, row 4 reads the fact, Open roster is the only primary', () => {
    show({ ...empty, staffCount: 20, participantCount: 40, participantsWithPlanCount: 36 }, provider())
    expect(screen.getByText('4 of 5 done')).toBeInTheDocument()
    expect(screen.getByText('36 of 40 participants have a plan')).toBeInTheDocument()
    expect(primaries().map((a) => a.textContent)).toEqual(['Open roster'])
  })

  it('Employment Hero connected: EH status and Open integrations, no Import staff or Add one', () => {
    show({ ...empty, employmentHeroAvailable: true }, provider({ employmentHeroConnected: true }))
    expect(screen.getByText('Waiting for the first check from Employment Hero')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open integrations' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Import staff' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Add one' })?.getAttribute('href')).not.toBe('/staff/new')
  })

  it('no Connect Employment Hero when it is not available, or the viewer cannot manage integrations', () => {
    const { unmount } = show(empty, provider())
    expect(screen.queryByRole('link', { name: 'Connect Employment Hero' })).toBeNull()
    unmount()
    show({ ...empty, employmentHeroAvailable: true }, provider(), 'Coordinator')
    expect(screen.queryByRole('link', { name: 'Connect Employment Hero' })).toBeNull()
  })

  it('available and Admin: Connect Employment Hero is offered', () => {
    show({ ...empty, employmentHeroAvailable: true }, provider())
    expect(screen.getByRole('link', { name: 'Connect Employment Hero' })).toBeInTheDocument()
  })

  it('done card: one row, no primary, no list', () => {
    show({ ...empty, firstPublishedWeekStart: '2026-10-19' }, provider(), 'Admin', 'done')
    expect(screen.getByText("You're set up. Your first week is published.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide setup steps' })).toBeInTheDocument()
    expect(primaries()).toHaveLength(0)
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('Hide writes the key, calls onHide and moves focus to #dashboard-alerts', async () => {
    const hidden: boolean[] = []
    show(empty, null, 'Admin', 'steps', () => hidden.push(true))
    await userEvent.click(screen.getByRole('button', { name: 'Hide setup steps' }))
    expect(hidden).toEqual([true])
    expect(localStorage.getItem('bunya-setup-hidden:t1')).toBe('1')
    expect(document.getElementById('dashboard-alerts')).toHaveFocus()
  })

  it('steps are an ol with one li per row and the heading is an h2', () => {
    show(empty, null)
    expect(screen.getByRole('heading', { level: 2, name: 'Get set up' })).toBeInTheDocument()
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText('Optional')).toBeInTheDocument()
  })
})
