import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StaffPicker, type StaffPickerProps } from './StaffPicker'
import { pickerPlacement } from '../lib/rosterDrag'
import { makeShift, makeUnfilledShift } from '../test-fixtures'
import { TONE } from '@/lib/tone'
import type { StaffListDto } from '@/api/types'

// The organisation's weekly-hours setting (Settings > Alert windows); 38 unless a test sets it.
const { weekly } = vi.hoisted(() => ({ weekly: { hours: 38 } }))
vi.mock('@/api/hooks/settings', () => ({ useWeeklyHoursWarning: () => weekly.hours }))

// Mia's Tuesday 18 August, 9am-3pm, Needs staff. Kim is free, Mei is free but flagged and past 38 hours, Jack is on Liam's Published 8am-5pm, Marcus is on leave and Alex's leave is pending.
const target = makeUnfilledShift({ id: 'open', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-18', startTime: '09:00:00', endTime: '15:00:00', status: 'Draft' })
const person = (id: string, fullName: string, hasExpiredQualifications = false) => ({ id, fullName, isActive: true, hasExpiredQualifications }) as StaffListDto
const STAFF = [person('kim', 'Kim Lee'), person('mei', 'Mei Zhang', true), person('jack', "Jack O'Sullivan"), person('marcus', 'Marcus Papadopoulos'), person('alex', 'Alex Ng')]
const JACK_LIAM = makeShift({ id: 'b-1', staffId: 'jack', staffName: "Jack O'Sullivan", participantId: 'p-2', participantName: 'Liam Okafor', serviceDate: '2026-08-18', startTime: '08:00:00', endTime: '17:00:00', status: 'Published' })
const LEAVE = [
  { staffId: 'marcus', from: '2026-08-18', to: '2026-08-18', status: 'Approved' as const },
  { staffId: 'alex', from: '2026-08-18', to: '2026-08-18', status: 'Pending' as const },
]

function renderPicker(props: Partial<StaffPickerProps> = {}, withChip = true) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(
    <>
      {/* The chip the md+ panel anchors to: the board's ShiftChip root carries data-shift-chip, its plus data-shift-plus. */}
      {withChip && <div data-shift-chip="open"><button type="button" data-shift-plus="open">plus</button></div>}
      <StaffPicker target={target} staff={STAFF} staffLoading={false} shifts={[JACK_LIAM]} leave={LEAVE} hours={new Map([['jack', 15], ['mei', 40]])} sheet={false} onPick={onPick} onClose={onClose} {...props} />
    </>,
  )
  return { onPick, onClose, search: () => screen.getByRole('combobox', { name: 'Find staff' }) }
}
const groupLabels = () => screen.queryAllByRole('group').map(g => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent)
const optionNames = (container: HTMLElement) => within(container).getAllByRole('option').map(o => o.getAttribute('aria-label'))

describe('StaffPicker: who is offered, and how (the brief, section 4)', () => {
  afterEach(() => { weekly.hours = 38 })

  it("judges hours against the organisation's weekly figure: 40 of 45 is calm, and named so", () => {
    weekly.hours = 45
    renderPicker()
    expect(screen.getByText('40 / 45 h').className).not.toContain(TONE.warning.ink)
    expect(screen.getByRole('option', { name: /^Mei Zhang, 40 of 45 hours this week/ })).toBeInTheDocument()
  })

  it('opens as a dialog named like the plus, focus in the search, and the groups Free, On another shift, On leave in that order', () => {
    const { search } = renderPicker()
    expect(screen.getByRole('dialog', { name: 'Assign someone to Tuesday 9am to 3pm for Mia' })).toBeInTheDocument()
    expect(search()).toHaveFocus()
    expect(screen.getByRole('listbox', { name: 'Staff' })).toBeInTheDocument()
    expect(groupLabels()).toEqual(['Free at this time', 'On another shift at this time', 'On leave that day'])
    const [free, move, leave] = screen.getAllByRole('group')
    expect(optionNames(free)).toEqual(['Kim Lee, 0 of 38 hours this week', 'Mei Zhang, 40 of 38 hours this week, qualifications expired'])
    expect(optionNames(move)).toEqual(["Jack O'Sullivan, 15 of 38 hours this week, move from Tuesday 8am to 5pm with Liam, published: tells Jack"])
    expect(within(move).getByText('Move from Tue 8am–5pm · Liam')).toBeInTheDocument()
    expect(within(move).getByText('Published: tells Jack')).toBeInTheDocument()
    expect(optionNames(leave)).toEqual(['Marcus Papadopoulos, 0 of 38 hours this week, on leave', 'Alex Ng, 0 of 38 hours this week, leave pending'])
    expect(within(leave).getByText('On leave')).toBeInTheDocument()
    expect(within(leave).getByText('Leave pending')).toBeInTheDocument()
  })

  it("prints the hours as '12 / 38 h', past 38 in the warning ink, with the expired flag before the name", () => {
    renderPicker()
    expect(screen.getByText('40 / 38 h').className).toContain(TONE.warning.ink)
    expect(screen.getByText('Mei Zhang').previousElementSibling?.tagName.toLowerCase()).toBe('svg')
  })

  it('says once, under the search, that a pick on a published shift goes out now', () => {
    renderPicker({ target: { ...target, status: 'Published' } })
    expect(screen.getAllByText('This shift is published, so the change goes out now.')).toHaveLength(1)
  })

  it('shows placeholder rows while staff load, and "No active staff." when there are none', () => {
    const { unmount } = render(<StaffPicker target={target} staff={[]} staffLoading shifts={[]} leave={[]} hours={new Map()} sheet onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('listbox', { name: 'Staff' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    unmount()
    render(<StaffPicker target={target} staff={[]} staffLoading={false} shifts={[]} leave={[]} hours={new Map()} sheet onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('No active staff.')).toBeInTheDocument()
  })

  it('filters every group by any part of the name, and says so when nothing matches', async () => {
    const user = userEvent.setup()
    renderPicker()
    await user.type(screen.getByRole('combobox', { name: 'Find staff' }), 'ng')
    expect(groupLabels()).toEqual(['Free at this time', 'On leave that day'])   // Mei Zhang, Alex Ng
    await user.clear(screen.getByRole('combobox', { name: 'Find staff' }))
    await user.type(screen.getByRole('combobox', { name: 'Find staff' }), 'zz')
    expect(screen.getByText('No staff match “zz”.')).toBeInTheDocument()
    expect(groupLabels()).toEqual([])
  })
})

describe('StaffPicker: keyboard and closing', () => {
  it('moves through the options across the groups with the arrows (nothing active on open), and Enter picks the active one', async () => {
    const user = userEvent.setup()
    const { onPick, search } = renderPicker()
    expect(search()).not.toHaveAttribute('aria-activedescendant')
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')   // Kim, Mei, then past the group label to Jack
    expect(search()).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /^Jack O'Sullivan/ }).id)
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: 'jack:b-1', source: JACK_LIAM }))
  })

  it('wraps, and Home and End go to the first and last option', async () => {
    const user = userEvent.setup()
    const { search } = renderPicker()
    const id = (name: RegExp) => screen.getByRole('option', { name }).id
    await user.keyboard('{ArrowUp}')
    expect(search()).toHaveAttribute('aria-activedescendant', id(/^Alex Ng/))
    await user.keyboard('{ArrowDown}')
    expect(search()).toHaveAttribute('aria-activedescendant', id(/^Kim Lee/))
    await user.keyboard('{End}')
    expect(search()).toHaveAttribute('aria-activedescendant', id(/^Alex Ng/))
    await user.keyboard('{Home}')
    expect(search()).toHaveAttribute('aria-activedescendant', id(/^Kim Lee/))
  })

  it('never assigns on a stray Enter: with nothing active it picks only the one option a search left', async () => {
    const user = userEvent.setup()
    const { onPick } = renderPicker()
    await user.keyboard('{Enter}')
    expect(onPick).not.toHaveBeenCalled()
    await user.type(screen.getByRole('combobox', { name: 'Find staff' }), 'kim{Enter}')
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: 'kim' }))
  })

  it('picks a clicked option, and the click never takes focus out of the search', async () => {
    const user = userEvent.setup()
    const { onPick, search } = renderPicker()
    await user.click(screen.getByRole('option', { name: /^Marcus Papadopoulos/ }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: 'marcus', leave: 'Approved' }))
    expect(search()).toHaveFocus()
  })

  it('closes without a pick on Escape and on a mousedown outside, but not on its own plus; Tab stays in the search', async () => {
    const user = userEvent.setup()
    const { onPick, onClose, search } = renderPicker()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    // The panel runs on useDialogBehavior (lead, 2026-10-15): its Tab trap keeps focus in the search, the panel's only focusable control.
    await user.keyboard('{Tab}')
    expect(search()).toHaveFocus()
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'plus' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('closes when its chip is no longer on the board', () => {
    const { onClose } = renderPicker({}, false)
    expect(onClose).toHaveBeenCalled()
  })

  it('below md is the house SlideOver: "Assign someone", described by the shift, the search focused', async () => {
    renderPicker({ sheet: true })
    const sheet = screen.getByRole('dialog', { name: 'Assign someone' })
    expect(sheet).toHaveAccessibleDescription('Mia Chen, Tue 18 Aug, 9am–3pm')
    await waitFor(() => expect(within(sheet).getByRole('combobox', { name: 'Find staff' })).toHaveFocus())
    expect(within(sheet).getAllByRole('group')).toHaveLength(3)
  })
})

describe('StaffPicker: the md+ panel follows a reflowing board', () => {
  it('re-places itself after a re-render, not only on scroll and resize (a refetch can move the chip)', () => {
    let top = 100
    const rect = () => ({ top, bottom: top + 40, left: 200, right: 500, width: 300, height: 40, x: 200, y: top, toJSON: () => ({}) }) as DOMRect
    const chipRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect())
    const props = { target, staff: STAFF, staffLoading: false, shifts: [JACK_LIAM], leave: LEAVE, hours: new Map<string, number>(), sheet: false, onPick: vi.fn(), onClose: vi.fn() }
    const ui = (staff: StaffListDto[]) => <><div data-shift-chip="open"><button type="button" data-shift-plus="open">plus</button></div><StaffPicker {...props} staff={staff} /></>
    const { rerender } = render(ui(STAFF))
    const before = screen.getByRole('dialog').style.top
    top = 300
    rerender(ui(STAFF.slice(0, 2)))
    chipRect.mockRestore()
    expect(before).not.toBe('')
    expect(screen.getByRole('dialog').style.top).not.toBe(before)
  })
})

// The md+ panel's place (the brief, section 4). jsdom has no layout, so the rule is a pure function; captures 3, 4 and 6 measure it in a browser.
describe('pickerPlacement', () => {
  const view = { width: 1440, height: 900 }
  const chip = (left: number, top: number, width = 127, height = 28) => ({ left, top, right: left + width, bottom: top + height })

  it('sits 4px under its chip, left edges together, 320px wide and at most 26rem tall', () => {
    expect(pickerPlacement(chip(300, 200), view)).toEqual({ left: 300, width: 320, top: 232, maxHeight: 416 })
  })

  it('flips above the chip when the room below is under 18rem and the room above is larger', () => {
    expect(pickerPlacement(chip(300, 700), view)).toEqual({ left: 300, width: 320, bottom: 204, maxHeight: 416 })
  })

  it("puts its right edge on the chip's when 320px would pass the window's right edge (Saturday and Sunday)", () => {
    expect(pickerPlacement(chip(1250, 200), view).left).toBe(1250 + 127 - 320)
  })

  it('stays 8px inside the window', () => {
    expect(pickerPlacement(chip(2, 200, 100), { width: 330, height: 900 }).left).toBe(8)
  })
})

describe('StaffPicker: Employment Hero start date', () => {
  it("lists someone who starts after the shift date under Not started yet, with the reason, and not as free", () => {
    renderPicker({ staff: [person('kim', 'Kim Lee'), { ...person('new', 'Nia Starter'), employmentStartDate: '2026-08-19' } as StaffListDto] })
    expect(groupLabels()).toEqual(['Free at this time', 'Not started yet'])
    const [, notStarted] = screen.getAllByRole('group')
    expect(optionNames(notStarted)).toEqual(["Nia Starter, 0 of 38 hours this week, hasn't started yet"])
    expect(within(notStarted).getByText("Hasn't started yet")).toBeInTheDocument()
  })
})
