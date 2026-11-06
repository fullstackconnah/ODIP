import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import QuickAddBand from './QuickAddBand'
import { quickAddSpans } from './quickAddLayout'

const { useFundingPlans } = vi.hoisted(() => ({ useFundingPlans: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useFundingPlans: (...args: unknown[]) => useFundingPlans(...args) }))

const ALL = ['Add a note', 'Add a routine', 'Add a restrictive practice', 'Add a medication', 'Add a contact', 'Open the plan budget', 'Open agreements']
// Each role's tiles, from the gates the tabs themselves use (permissions.ts): SuperAdmin, Admin and Coordinator add everything; a Support Worker writes notes and
// routines (and the agreement draft is not a page it may open); ReadOnly writes nothing and is refused the agreement draft, so its band is not drawn.
const BY_ROLE: Record<string, string[]> = {
  SuperAdmin: ALL, Admin: ALL, Coordinator: ALL,
  SupportWorker: ['Add a note', 'Add a routine'],
  ReadOnly: [],
}

const renderBand = (onGo = vi.fn()) => ({ onGo, ...render(<MemoryRouter><QuickAddBand participantId="p-1" onGo={onGo} /></MemoryRouter>) })
const names = () => screen.queryAllByRole('link').map(a => a.getAttribute('aria-label'))

beforeEach(() => { useFundingPlans.mockReturnValue({ data: undefined, isSuccess: false }) })
afterEach(() => { localStorage.clear() })

describe('QuickAddBand', () => {
  for (const [role, tiles] of Object.entries(BY_ROLE)) {
    it(`${role} sees ${tiles.length ? tiles.join(', ') : 'no band'}`, () => {
      localStorage.setItem('odip_user', JSON.stringify({ role }))
      renderBand()
      expect(names()).toEqual(tiles)
      expect(screen.queryByRole('heading', { name: 'Quick add' }) !== null).toBe(tiles.length > 0)
    })
  }

  it('asks for the plans only for a role that can open them', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    renderBand()
    expect(useFundingPlans).toHaveBeenCalledWith('p-1', false)
  })

  it('links each tile to its section with add=1, the medication to its add page, the agreement to its tab only', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    renderBand()
    const href = (n: string) => screen.getByRole('link', { name: n }).getAttribute('href')
    expect(href('Add a note')).toBe('/?tab=records&section=notes&add=1')
    expect(href('Add a routine')).toBe('/?tab=daily&section=routines&add=1')
    expect(href('Add a restrictive practice')).toBe('/?tab=health&section=restrictive-practices&add=1')
    expect(href('Add a medication')).toBe('/medications/new?participantId=p-1')
    expect(href('Add a contact')).toBe('/?tab=people&section=contacts&add=1')
    expect(href('Open the plan budget')).toBe('/?tab=funding&section=plan-budget')
    expect(href('Open agreements')).toBe('/?tab=agreements')
  })

  it('Plan budget records only when the plans answered with none; otherwise it just opens the section', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    useFundingPlans.mockReturnValue({ data: { plans: [] }, isSuccess: true })
    renderBand()
    expect(screen.getByRole('link', { name: 'Record the plan budget' })).toHaveAttribute('href', '/?tab=funding&section=plan-budget&add=1')
  })

  it('a plain click goes through onGo (the page guards unsaved edits); a modified click is left to the browser', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    const { onGo } = renderBand()
    const user = userEvent.setup()
    await user.click(screen.getByRole('link', { name: 'Add a note' }))
    expect(onGo).toHaveBeenCalledWith('?tab=records&section=notes&add=1')
    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('link', { name: 'Add a contact' }))
    await user.keyboard('{/Control}')
    expect(onGo).toHaveBeenCalledTimes(1)
  })
})

describe('quickAddSpans', () => {
  const at = (n: number, step: number) => quickAddSpans(n).map(s => s[step])
  it('1280: one row of equal shares', () => { expect(at(7, 2)).toEqual(Array(7).fill(60)); expect(at(2, 2)).toEqual([210, 210]) })
  it('768: seven deal 4 + 3', () => { expect(at(7, 1)).toEqual([105, 105, 105, 105, 140, 140, 140]) })
  it('390: two columns, an odd last tile spans both, one tile spans both', () => {
    expect(at(7, 0)).toEqual([210, 210, 210, 210, 210, 210, 420])
    expect(at(2, 0)).toEqual([210, 210])
    expect(at(1, 0)).toEqual([420])
  })
})
