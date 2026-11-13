/** Query key roots used in several files. Use these, never the string, so a renamed root is a compile error. */
export const QK = {
  rosterBoard: 'roster-board',
  participant: 'participant',
  dashboard: 'dashboard',
  tasks: 'tasks',
  tripItinerary: 'trip-itinerary',
  participants: 'participants',
} as const
