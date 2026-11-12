import { describe, it, expect } from 'vitest'
import { activityLanes } from './groupActivities'
import { makeActivity } from '../test-fixtures'

describe('activityLanes', () => {
  it('(a) one lane per library activity, labelled by its name, whatever the session titles', () => {
    const lanes = activityLanes([
      makeActivity({ id: 'a1', title: 'Swim', activityId: 'lib-1', activityName: 'Swimming', serviceDate: '2026-08-18' }),
      makeActivity({ id: 'a2', title: 'Swim squad', activityId: 'lib-1', activityName: 'Swimming', serviceDate: '2026-08-19' }),
    ])
    expect(lanes).toHaveLength(1)
    expect(lanes[0].label).toBe('Swimming')
    expect(lanes[0].activities.map(a => a.id)).toEqual(['a1', 'a2'])
  })

  it('(b) sessions without a library activity share a lane when their titles match ignoring case and spaces', () => {
    const lanes = activityLanes([makeActivity({ id: 'a1', title: 'Bowling' }), makeActivity({ id: 'a2', title: ' bowling ', serviceDate: '2026-08-18' })])
    expect(lanes).toHaveLength(1)
    expect(lanes[0].label).toBe('Bowling')
  })

  it('(c) lanes run A to Z, whatever the day order', () => {
    const lanes = activityLanes([makeActivity({ id: 'a1', title: 'Bowling', serviceDate: '2026-08-17' }), makeActivity({ id: 'a2', title: 'Art', serviceDate: '2026-08-18' })])
    expect(lanes.map(l => l.label)).toEqual(['Art', 'Bowling'])
  })

  it('(d) no activities, no lanes', () => {
    expect(activityLanes([])).toEqual([])
  })

  it('orders a lane by date, then start time, then id; the label comes from the earliest session', () => {
    const lanes = activityLanes([
      makeActivity({ id: 'b', title: 'Art club', serviceDate: '2026-08-18', startTime: '09:00:00' }),
      makeActivity({ id: 'c', title: 'art club', serviceDate: '2026-08-17', startTime: '13:00:00' }),
      makeActivity({ id: 'a', title: 'ART CLUB', serviceDate: '2026-08-17', startTime: '13:00:00' }),
    ])
    expect(lanes[0].label).toBe('ART CLUB')
    expect(lanes[0].activities.map(x => x.id)).toEqual(['a', 'c', 'b'])
  })
})
