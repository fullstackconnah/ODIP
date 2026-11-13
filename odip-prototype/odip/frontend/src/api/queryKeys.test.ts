import { describe, expect, it } from 'vitest'
import { QK } from '@/api/queryKeys'

describe('QK', () => {
  it('keeps the exact root strings the cache and its tests use', () => {
    expect(QK).toEqual({
      rosterBoard: 'roster-board',
      participant: 'participant',
      dashboard: 'dashboard',
      tasks: 'tasks',
      tripItinerary: 'trip-itinerary',
      participants: 'participants',
    })
  })
})
