/**
 * Realistic API JSON for screens the mock API has no data for (see the `fixture: true` shots).
 * Shapes follow the real response DTOs under frontend/src/api/types. Names, codes and dates are the mock's
 * fictional sample set (mock-api/server.js): trips t-0001..t-0004, participants p-0001..p-0006, staff s-0001..s-0005.
 */

// ---- Portal: My Shifts (GET portal/my-shifts) + pending witness requests (GET portal/witness-requests) -------------
// Week Mon 7 - Sun 13 Sep 2026. shift-0001/0002/0003 are the mock's own portal shifts (same dates, times, participants);
// shift-0004 is an extra day shift so the week reads like a real roster. Statuses follow the shift-completion flow:
// Completed (finished and approved) -> Published (upcoming).
export const myShiftsWeek = {
  shifts: [
    {
      id: 'shift-0001', participantId: 'p-0001', participantName: 'Liam Okafor', serviceDate: '2026-09-08',
      startTime: '08:00:00', endTime: '17:00:00', endsNextDay: false, durationHours: 8,
      ratio: 'OneToOne', nightType: 'None', status: 'Completed', notes: null,
    },
    {
      id: 'shift-0002', participantId: 'p-0004', participantName: 'Grace Palmer-Hughes', serviceDate: '2026-09-10',
      startTime: '19:00:00', endTime: '07:00:00', endsNextDay: true, durationHours: 12,
      ratio: 'OneToOne', nightType: 'ActiveNight', status: 'Completed', notes: null,
    },
    {
      id: 'shift-0004', participantId: 'p-0006', participantName: 'Aisha Rahimi', serviceDate: '2026-09-11',
      startTime: '10:00:00', endTime: '15:00:00', endsNextDay: false, durationHours: 5,
      ratio: 'OneToOne', nightType: 'None', status: 'Published', notes: null,
    },
    {
      id: 'shift-0003', participantId: 'p-0002', participantName: 'Sienna Whitfield', serviceDate: '2026-09-13',
      startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false, durationHours: 6,
      ratio: 'OneToOne', nightType: 'None', status: 'Published', notes: null,
    },
  ],
  tripAssignments: [],
}

export const pendingWitnessRequests = [
  {
    id: 'wr-0001', sourceType: 'Incident', participantId: 'p-0001', participantName: 'Liam Okafor',
    medicationId: null, medicationName: null, strength: null, doseDescription: null, doseGiven: null,
    incidentReportId: 'inc-0001', incidentTitle: 'Minor graze from beach walk slip', incidentType: 'Injury',
    incidentSeverity: 'Low', recordedByName: 'Priya Nadarajah', administeredAt: null, administeredAtTimeZone: null,
    incidentDateTime: '2026-07-11T10:30:00', witnessStatus: 'Pending', witnessRespondedAt: null,
    createdAt: '2026-09-10T16:20:00Z',
  },
]

// ---- Participant risk alerts (GET participants/{id}/alerts) -----------------------------------------------------
// Grace Palmer-Hughes (p-0004): the mock's inc-0003 is her open High incident with an overdue QSC report; the mock
// profile also records an authorised environmental restrictive practice. Wording follows ParticipantAlertsService
// (backend), ranked Critical first. The plan end date and the practice review date are not in the mock: they are
// fixture values chosen to fall relative to the pinned clock (2026-08-04).
export const graceAlerts = {
  participantId: 'p-0004',
  participantName: 'Gracie Palmer-Hughes',
  isActive: true,
  alerts: [
    { type: 'qsc-report-overdue', severity: 'Critical', message: 'QSC report overdue: Escalation during pre-trip meet and greet', deepLinkTab: 'history', linkTo: '/incidents/inc-0003' },
    { type: 'open-serious-incident', severity: 'Warning', message: 'Open High incident: Escalation during pre-trip meet and greet (29 Jul)', deepLinkTab: 'history', linkTo: '/incidents/inc-0003' },
    { type: 'restrictive-practice-review-overdue', severity: 'Warning', message: 'Environmental restrictive practice review was due 2026-07-15 and is overdue', deepLinkTab: 'restrictive-practices', linkTo: null },
    { type: 'plan-expiring-soon', severity: 'Warning', message: 'NDIS plan ends 2026-08-21', deepLinkTab: 'details', linkTo: null },
  ],
  criticalCount: 1,
  warningCount: 3,
  infoCount: 0,
}
