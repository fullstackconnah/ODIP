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
      participantOnboardingWorklist: 'participant-onboarding-worklist',
      portalShiftDetail: 'portal-shift-detail',
      rosteringCompletions: 'rostering-completions',
      participantInquiries: 'participant-inquiries',
      rosterPatterns: 'roster-patterns',
    })
  })
})
