import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SETTINGS_PERMS } from '@/test/fixtures/settingsPermissions'
import SettingsNav from './SettingsNav'
import { visibleSections, type SectionKey } from './settingsSections'

function renderNav(role: keyof typeof SETTINGS_PERMS, current: SectionKey | null, returnFocusTo: SectionKey | null = null) {
  const perms = SETTINGS_PERMS[role]
  return render(
    <MemoryRouter>
      <SettingsNav sections={visibleSections(perms)} current={current} noOrganisation={perms.isSuperAdmin && !perms.hasOrganisation} returnFocusTo={returnFocusTo} />
    </MemoryRouter>,
  )
}

const nav = () => screen.getByRole('navigation', { name: 'Settings' })

describe('SettingsNav', () => {
  it('lists each group as a list named by its label, every section a link to its ?section= URL', () => {
    renderNav('Admin', 'profile')
    const myAccount = within(nav()).getByRole('list', { name: 'My account' })
    expect(within(myAccount).getAllByRole('link').map(l => l.textContent)).toEqual(['Profile', 'Notifications', 'Appearance'])
    expect(within(nav()).getByRole('link', { name: 'Billing details' })).toHaveAttribute('href', '/settings?section=billing')
    // The groups, in rail order, and nothing else.
    const groups = ['My account', 'Organisation', 'Pricing and budgets', 'Content', 'Data'].map(name => within(nav()).getByRole('list', { name }))
    expect(within(nav()).getAllByRole('list')).toEqual(groups)
  })

  it('lights exactly one item on the rail: the open section', () => {
    renderNav('Admin', 'budgets')
    const current = nav().querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('Budgets')
  })

  it('lights nothing on the phone list, where nothing is open', () => {
    renderNav('Coordinator', null)
    expect(nav().querySelectorAll('[aria-current]')).toHaveLength(0)
    expect(within(nav()).getAllByRole('link')).toHaveLength(10)
  })

  it('tells a SuperAdmin with no organisation why the organisation groups are missing, between My account and Platform', () => {
    renderNav('SuperAdminNoOrg', 'profile')
    const line = screen.getByText('Choose an organisation to see its settings.')
    const platform = within(nav()).getByRole('list', { name: 'Platform' })
    expect(line.compareDocumentPosition(platform) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(nav()).getAllByRole('list')).toHaveLength(2)
  })

  it('says nothing about organisations to anyone else', () => {
    renderNav('SuperAdmin', 'profile')
    expect(screen.queryByText('Choose an organisation to see its settings.')).not.toBeInTheDocument()
  })

  it('puts focus back on the row of the section just left when the phone list returns', () => {
    renderNav('Admin', null, 'budgets')
    expect(within(nav()).getByRole('link', { name: 'Budgets' })).toHaveFocus()
  })
})
