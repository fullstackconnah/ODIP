import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GroupActivityCard } from './GroupActivityCard'
import { ActivityContext, dayItems, type ActivityBoardState } from '../lib/groupActivities'
import { DropStateContext } from '../lib/rosterDrag'
import { makeActivity, makeFinding, makeShift } from '../test-fixtures'

const noop = () => {}
const card = (activity = makeActivity()) =>
  render(<GroupActivityCard activity={activity} participantId="participant-1" canWrite onOpen={noop} />)

describe('GroupActivityCard', () => {
  it('names itself with the title and the staff count', () => {
    card(makeActivity({ staffNeeded: 3, staffAssigned: 3 }))
    expect(screen.getByRole('button', { name: /^Group activity, Bowling, .*3 of 3 staff$/ })).toBeInTheDocument()
  })

  it('shows the short pill in the name, and the marker never repeats ACTIVITY_STAFF_SHORT', () => {
    card(makeActivity({ staffNeeded: 3, staffAssigned: 1, findings: [makeFinding({ code: 'ACTIVITY_STAFF_SHORT' })] }))
    expect(screen.getByRole('button', { name: /1 short/ })).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('draws the marker for any other finding', () => {
    card(makeActivity({ findings: [makeFinding({ code: 'DOUBLE_BOOKED' })] }))
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('leads a Draft title with the word Draft', () => {
    card(makeActivity({ status: 'Draft' }))
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Draft$/ })).toBeInTheDocument()
  })

  it('reads Cancelled in the box with no pill and no menu', () => {
    card(makeActivity({ status: 'Cancelled', staffNeeded: 3, staffAssigned: 1 }))
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Group activity/ }).getAttribute('aria-label')).not.toMatch(/short/)
  })

  it('shows the times-differ glyph only when this participant differs', () => {
    const differs = makeActivity({ participants: [{ participantId: 'participant-1', participantName: 'Mia Chen', ratio: 'OneToOne', shiftIds: ['s'], timesDiffer: true, didNotAttend: false }] })
    const { container, unmount } = card(differs)
    expect(container.querySelector('[data-times-differ]')).not.toBeNull()
    expect(screen.getByRole('button', { name: /times differ from agreement/ })).toBeInTheDocument()
    unmount()
    const plain = card()
    expect(plain.container.querySelector('[data-times-differ]')).toBeNull()
  })

  it('opens from the card and removes the person from the menu', async () => {
    const onOpen = vi.fn()
    const removePerson = vi.fn()
    const board: ActivityBoardState = { byId: new Map(), open: onOpen, removePerson, addShift: noop, busyIds: new Set() }
    const activity = makeActivity()
    render(
      <ActivityContext.Provider value={board}>
        <GroupActivityCard activity={activity} participantId="participant-1" canWrite onOpen={onOpen} />
      </ActivityContext.Provider>,
    )
    await userEvent.click(screen.getByRole('button', { name: /^Group activity, Bowling/ }))
    expect(onOpen).toHaveBeenCalledWith(activity)
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Bowling' }))
    await userEvent.click(await screen.findByText('Remove Mia from activity'))
    expect(removePerson).toHaveBeenCalledWith(activity, activity.participants[0])
  })

  it('says Adding {first name} while a join is out', () => {
    render(
      <DropStateContext.Provider value={{ disabled: true, pending: { targetId: 'activity-1', staffName: 'Sam Wilson' } }}>
        <GroupActivityCard activity={makeActivity()} participantId="participant-1" canWrite onOpen={noop} />
      </DropStateContext.Provider>,
    )
    expect(screen.getByText('Adding Sam…')).toBeInTheDocument()
  })
})

describe('dayItems', () => {
  it('draws a 2:1 pair as one card, in start order', () => {
    const activity = makeActivity({ id: 'a', startTime: '12:00:00' })
    const shifts = [
      makeShift({ id: 's1', startTime: '13:00:00', groupActivityId: 'a' }),
      makeShift({ id: 's2', startTime: '13:00:00', groupActivityId: 'a' }),
      makeShift({ id: 's3', startTime: '08:00:00' }),
    ]
    const items = dayItems(shifts, new Map([['a', activity]]))
    expect(items).toHaveLength(2)
    expect(items.map(i => (i.kind === 'shift' ? i.shift.id : i.activity.id))).toEqual(['s3', 'a'])
  })
})
