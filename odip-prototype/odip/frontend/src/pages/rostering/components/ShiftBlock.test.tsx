import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ShiftDto } from '@/api/types'
import { makeShift } from '../test-fixtures'
import { participantWeekHref, staffWeekHref } from '../lib/roster'
import { segmentsOf } from '../lib/weekGrid'
import { ShiftBlock } from './ShiftBlock'

function draw(shift: ShiftDto, opts: { h?: number; w?: number; part?: 'first' | 'second'; context?: 'staff' | 'participant' } = {}) {
  const onOpen = vi.fn()
  const segs = segmentsOf(shift)
  const seg = opts.part ? segs.find(s => s.part === opts.part)! : segs[0]
  render(
    <MemoryRouter>
      <ShiftBlock seg={seg} context={opts.context ?? 'staff'} style={{ top: 0 }} heightPx={opts.h ?? 48} laneWidthPx={opts.w ?? 120} onOpen={onOpen} />
    </MemoryRouter>,
  )
  return { onOpen }
}

const base = { serviceDate: '2026-11-02', startTime: '09:00:00', endTime: '17:00:00' }

describe('ShiftBlock', () => {
  it('a 48px block shows time and name', () => {
    draw(makeShift(base), { h: 48 })
    expect(screen.getByText('9am')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mia Chen' })).toBeInTheDocument()
  })

  it('at 24px there is no Link and the name is in the accessible name', () => {
    draw(makeShift(base), { h: 24 })
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Mia Chen')
  })

  it("the name Link goes to the other person's week and does not open", async () => {
    const { onOpen } = draw(makeShift({ ...base, participantId: 'p1' }))
    const link = screen.getByRole('link', { name: 'Mia Chen' })
    expect(link).toHaveAttribute('href', participantWeekHref('p1', '2026-11-02'))
    await userEvent.click(link)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('participant context links the staff member', () => {
    draw(makeShift({ ...base, staffId: 's1' }), { context: 'participant' })
    expect(screen.getByRole('link', { name: 'Alex Rivera' })).toHaveAttribute('href', staffWeekHref('s1', '2026-11-02'))
  })

  it('Enter and Space open', async () => {
    const { onOpen } = draw(makeShift(base))
    screen.getByRole('button').focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('Enter on the name link follows the link and does not open', async () => {
    const { onOpen } = draw(makeShift(base))
    screen.getByRole('link', { name: 'Mia Chen' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a wide lane shows the full range with no gap before the end ("9am–5pm")', () => {
    draw(makeShift(base))
    expect(screen.getByText('9am').parentElement).toHaveClass('gap-x-0')
    expect(screen.getByText('–5pm')).toBeInTheDocument()
  })

  it('under 56 px the time line is the start alone, without am/pm; the accessible name keeps the range', () => {
    draw(makeShift({ ...base, startTime: '10:30:00', endTime: '17:00:00' }), { w: 40 })
    expect(screen.getByText('10:30')).toBeInTheDocument()
    expect(screen.queryByText(/pm/)).toBeNull()
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('10:30am–5pm')
  })

  it('a narrow lane moves the icons down to the name line', () => {
    draw(makeShift({ ...base, isRegular: true, findings: [{ code: 'X', severity: 'Warning', message: 'm' }] as ShiftDto['findings'] }), { w: 40, h: 48 })
    expect(document.querySelector('.top-5')).not.toBeNull()
    expect(document.querySelector('.top-1')).toBeNull()
  })

  it('a click opens', async () => {
    const { onOpen } = draw(makeShift(base))
    await userEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('Draft shows the word and the warning tint', () => {
    draw(makeShift({ ...base, status: 'Draft' }), { h: 60 })
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByRole('button').className).toContain('warning')
  })

  it('Needs staff is dashed with italic text', () => {
    draw(makeShift({ ...base, staffId: null, staffName: null }), { context: 'participant' })
    expect(screen.getByText('Needs staff')).toHaveClass('italic')
    expect(screen.getByRole('button').className).toContain('border-dashed')
  })

  it('Cancelled strikes the time and shows Lock and the word', () => {
    draw(makeShift({ ...base, status: 'Cancelled' }), { h: 60 })
    expect(screen.getByText('9am')).toHaveClass('line-through')
    expect(screen.getByRole('button').querySelector('svg')).not.toBeNull()
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('findings put the severity label first in the name', () => {
    const f = { code: 'X', severity: 'Blocking', message: 'm' } as ShiftDto['findings'][number]
    draw(makeShift({ ...base, findings: [f] }))
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/^1 blocking issue, 9am–5pm, Mia Chen/)
  })

  it('a first segment reads "to Tue" and "continues on Tuesday 3 November"; a second reads "from Sun"', () => {
    const night = makeShift({ id: 'n', serviceDate: '2026-11-02', startTime: '22:00:00', endTime: '06:00:00', endsNextDay: true })
    draw(night, { part: 'first' })
    expect(screen.getByText('to Tue')).toBeInTheDocument()
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('continues on Tuesday 3 November')
  })

  it('a second segment reads from the day before', () => {
    const night = makeShift({ id: 'n', serviceDate: '2026-11-01', startTime: '22:00:00', endTime: '06:00:00', endsNextDay: true })
    draw(night, { part: 'second' })
    expect(screen.getByText('from Sun')).toBeInTheDocument()
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('continued from Sunday 1 November')
  })

  it("a 2:1 sleepover's tags line reads 2:1 and Sleepover when 52px tall", () => {
    draw(makeShift({ ...base, ratio: 'TwoToOne', nightType: 'Sleepover' }), { h: 52 })
    expect(screen.getByText('2:1')).toBeInTheDocument()
    expect(screen.getByText('Sleepover')).toBeInTheDocument()
  })

  it('under 60px lane width there is no Link even when tall', () => {
    draw(makeShift(base), { h: 96, w: 50 })
    expect(screen.queryByRole('link')).toBeNull()
  })
})
