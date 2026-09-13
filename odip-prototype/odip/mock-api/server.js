// ODIP Mock API Server — zero dependencies, plain Node http.
// Run: node server.js   (listens on http://localhost:5062 — the port Vite's
// dev proxy targets — base path /api/v1; override with MOCK_PORT)
// Serves the ApiResponse<T> envelope the React frontend expects:
//   { success, data, message, errors }
// All names/organisations are fictional.

const http = require('http')

const PORT = Number(process.env.MOCK_PORT) || 5062
const BASE = '/api/v1'

// ── Envelope helper ──────────────────────────────────────────
const ok = (data) => ({ success: true, data, message: null, errors: null })
const paged = (items) => ({
  items,
  totalCount: items.length,
  page: 1,
  pageSize: 50,
  totalPages: 1,
  hasNext: false,
  hasPrevious: false,
})

// ── Sample data ──────────────────────────────────────────────

// Participants (ParticipantListDto)
const participants = [
  {
    id: 'p-0001', firstName: 'Liam', lastName: 'Okafor', preferredName: null,
    fullName: 'Liam Okafor', maskedNdisNumber: '43•••••89', planType: 'PlanManaged',
    region: 'Greater Brisbane', isRepeatClient: true, isActive: true,
    wheelchairRequired: false, isHighSupport: false, isIntensiveSupport: false,
    requiresOvernightSupport: false, hasRestrictivePracticeFlag: false, supportRatio: 'OneToTwo',
  },
  {
    id: 'p-0002', firstName: 'Sienna', lastName: 'Whitfield', preferredName: 'Sisi',
    fullName: 'Sienna Whitfield', maskedNdisNumber: '43•••••12', planType: 'AgencyManaged',
    region: 'Gold Coast', isRepeatClient: true, isActive: true,
    wheelchairRequired: true, isHighSupport: true, isIntensiveSupport: false,
    requiresOvernightSupport: true, hasRestrictivePracticeFlag: false, supportRatio: 'OneToOne',
  },
  {
    id: 'p-0003', firstName: 'Marcus', lastName: 'Tran', preferredName: null,
    fullName: 'Marcus Tran', maskedNdisNumber: '43•••••57', planType: 'SelfManaged',
    region: 'Sunshine Coast', isRepeatClient: false, isActive: true,
    wheelchairRequired: false, isHighSupport: false, isIntensiveSupport: false,
    requiresOvernightSupport: false, hasRestrictivePracticeFlag: false, supportRatio: 'OneToThree',
  },
  {
    id: 'p-0004', firstName: 'Grace', lastName: 'Palmer-Hughes', preferredName: 'Gracie',
    fullName: 'Grace Palmer-Hughes', maskedNdisNumber: '43•••••34', planType: 'PlanManaged',
    region: 'Greater Brisbane', isRepeatClient: true, isActive: true,
    wheelchairRequired: false, isHighSupport: true, isIntensiveSupport: true,
    requiresOvernightSupport: true, hasRestrictivePracticeFlag: true, supportRatio: 'TwoToOne',
  },
  {
    id: 'p-0005', firstName: 'Dylan', lastName: 'Marchetti', preferredName: null,
    fullName: 'Dylan Marchetti', maskedNdisNumber: '43•••••78', planType: 'AgencyManaged',
    region: 'Ipswich & West Moreton', isRepeatClient: false, isActive: true,
    wheelchairRequired: false, isHighSupport: false, isIntensiveSupport: false,
    requiresOvernightSupport: false, hasRestrictivePracticeFlag: false, supportRatio: 'OneToTwo',
  },
  {
    id: 'p-0006', firstName: 'Aisha', lastName: 'Rahimi', preferredName: null,
    fullName: 'Aisha Rahimi', maskedNdisNumber: '43•••••91', planType: 'PlanManaged',
    region: 'Logan', isRepeatClient: true, isActive: false,
    wheelchairRequired: true, isHighSupport: false, isIntensiveSupport: false,
    requiresOvernightSupport: false, hasRestrictivePracticeFlag: false, supportRatio: 'OneToOne',
  },
]

const participantDetailExtras = {
  'p-0001': {
    dateOfBirth: '1998-03-14', ndisNumber: '430158289', fundingOrganisation: 'MyPlan Partners',
    mobilityNotes: null, equipmentRequirements: null,
    transportRequirements: 'Prefers front passenger seat, gets car sick in rear.',
    medicalSummary: 'Mild asthma — carries own inhaler.', behaviourRiskSummary: null,
    notes: 'Loves fishing and footy. Keen for coastal trips.',
    preferredStaffId: 's-0002', preferredStaffName: 'Priya Nadarajah',
  },
  'p-0002': {
    dateOfBirth: '1995-11-02', ndisNumber: '430255312', fundingOrganisation: 'Horizon Plan Management',
    mobilityNotes: 'Full-time manual wheelchair user. Independent transfers with slide board.',
    equipmentRequirements: 'Shower commode required at accommodation. Pressure care mattress.',
    transportRequirements: 'Wheelchair-accessible vehicle with rear hoist.',
    medicalSummary: 'Epilepsy — midazolam plan in place. PRN chart current.',
    behaviourRiskSummary: null,
    notes: 'Enjoys markets, live music and photography.',
    preferredStaffId: null, preferredStaffName: null,
  },
  'p-0003': {
    dateOfBirth: '2001-07-21', ndisNumber: '430352057', fundingOrganisation: null,
    mobilityNotes: null, equipmentRequirements: null, transportRequirements: null,
    medicalSummary: 'Nil significant.', behaviourRiskSummary: 'Can become anxious in crowds — quiet space strategy documented.',
    notes: 'First trip with us — buddy with a repeat client.',
    preferredStaffId: null, preferredStaffName: null,
  },
  'p-0004': {
    dateOfBirth: '1992-01-30', ndisNumber: '430451134', fundingOrganisation: 'MyPlan Partners',
    mobilityNotes: 'Ambulant, fatigues quickly — wheelchair for long outings.',
    equipmentRequirements: 'Weighted blanket for overnight stays.',
    transportRequirements: '2:1 support in vehicle, sits behind driver.',
    medicalSummary: 'Type 1 diabetes — staff must be medication competent.',
    behaviourRiskSummary: 'BSP in place; environmental restrictive practice authorised (locked pantry overnight).',
    notes: null,
    preferredStaffId: 's-0001', preferredStaffName: 'Callum Radford',
  },
  'p-0005': {
    dateOfBirth: '2003-09-08', ndisNumber: '430548778', fundingOrganisation: 'Horizon Plan Management',
    mobilityNotes: null, equipmentRequirements: null, transportRequirements: null,
    medicalSummary: 'Nil significant.', behaviourRiskSummary: null,
    notes: 'Interested in theme-park trips.', preferredStaffId: null, preferredStaffName: null,
  },
  'p-0006': {
    dateOfBirth: '1989-05-17', ndisNumber: '430649291', fundingOrganisation: 'MyPlan Partners',
    mobilityNotes: 'Power wheelchair user.', equipmentRequirements: 'Hoist and sling (own sling travels with her).',
    transportRequirements: 'WAV with tie-downs, ramp access.',
    medicalSummary: 'PEG feeding overnight — nursing handover required.',
    behaviourRiskSummary: null, notes: 'Currently inactive — plan under review.',
    preferredStaffId: null, preferredStaffName: null,
  },
}

function participantDetail(p) {
  return {
    ...p,
    ...(participantDetailExtras[p.id] || {
      dateOfBirth: null, ndisNumber: null, fundingOrganisation: null,
      mobilityNotes: null, equipmentRequirements: null, transportRequirements: null,
      medicalSummary: null, behaviourRiskSummary: null, notes: null,
      preferredStaffId: null, preferredStaffName: null,
    }),
    requiresOvernightSupport: !!p.requiresOvernightSupport,
    hasRestrictivePracticeFlag: !!p.hasRestrictivePracticeFlag,
    createdAt: '2026-02-10T09:15:00Z',
    updatedAt: '2026-07-28T14:40:00Z',
  }
}

// Trips (TripListDto)
const trips = [
  {
    id: 't-0001', tripName: 'Sunshine Coast Beach Escape', tripCode: 'SCB-2608',
    destination: 'Caloundra QLD', region: 'Sunshine Coast',
    startDate: '2026-08-14', endDate: '2026-08-17', durationDays: 4,
    status: 'Confirmed', maxParticipants: 6, currentParticipantCount: 5,
    waitlistCount: 1, leadCoordinatorName: 'Priya Nadarajah',
  },
  {
    id: 't-0002', tripName: 'Tamborine Mountain Getaway', tripCode: 'TMG-2608',
    destination: 'Mount Tamborine QLD', region: 'Gold Coast Hinterland',
    startDate: '2026-08-28', endDate: '2026-08-30', durationDays: 3,
    status: 'OpenForBookings', maxParticipants: 8, currentParticipantCount: 3,
    waitlistCount: 0, leadCoordinatorName: 'Callum Radford',
  },
  {
    id: 't-0003', tripName: 'Toowoomba Carnival of Flowers', tripCode: 'TCF-2609',
    destination: 'Toowoomba QLD', region: 'Darling Downs',
    startDate: '2026-09-18', endDate: '2026-09-21', durationDays: 4,
    status: 'Planning', maxParticipants: 6, currentParticipantCount: 0,
    waitlistCount: 0, leadCoordinatorName: 'Priya Nadarajah',
  },
  {
    id: 't-0004', tripName: 'Byron Bay Winter Weekender', tripCode: 'BBW-2607',
    destination: 'Byron Bay NSW', region: 'Northern Rivers',
    startDate: '2026-07-10', endDate: '2026-07-12', durationDays: 3,
    status: 'Completed', maxParticipants: 5, currentParticipantCount: 5,
    waitlistCount: 0, leadCoordinatorName: 'Callum Radford',
  },
]

const tripDetailExtras = {
  't-0001': {
    oopDueDate: '2026-08-07', bookingCutoffDate: '2026-08-05',
    leadCoordinatorId: 's-0002', minParticipants: 4, requiredWheelchairCapacity: 1,
    requiredBeds: 8, requiredBedrooms: 5, minStaffRequired: 3, calculatedStaffRequired: 3,
    notes: 'Beachfront house confirmed. Check hoist availability for Sienna.',
    highSupportCount: 2, wheelchairCount: 1, overnightSupportCount: 2,
    staffAssignedCount: 3, outstandingTaskCount: 2,
    insuranceConfirmedCount: 4, insuranceOutstandingCount: 1,
    departureTime: '09:00', returnTime: '15:30',
  },
  't-0002': {
    oopDueDate: '2026-08-21', bookingCutoffDate: '2026-08-19',
    leadCoordinatorId: 's-0001', minParticipants: 4, requiredWheelchairCapacity: 0,
    requiredBeds: 10, requiredBedrooms: 6, minStaffRequired: 3, calculatedStaffRequired: 2,
    notes: 'Winery lunch booked for Saturday. Awaiting accommodation confirmation.',
    highSupportCount: 0, wheelchairCount: 0, overnightSupportCount: 1,
    staffAssignedCount: 1, outstandingTaskCount: 3,
    insuranceConfirmedCount: 1, insuranceOutstandingCount: 2,
    departureTime: '10:00', returnTime: '14:00',
  },
  't-0003': {
    oopDueDate: '2026-09-11', bookingCutoffDate: '2026-09-09',
    leadCoordinatorId: 's-0002', minParticipants: 4, requiredWheelchairCapacity: 2,
    requiredBeds: 8, requiredBedrooms: 5, minStaffRequired: 3, calculatedStaffRequired: 3,
    notes: 'Draft itinerary only — festival program released mid-August.',
    highSupportCount: 0, wheelchairCount: 0, overnightSupportCount: 0,
    staffAssignedCount: 0, outstandingTaskCount: 1,
    insuranceConfirmedCount: 0, insuranceOutstandingCount: 0,
    departureTime: null, returnTime: null,
  },
  't-0004': {
    oopDueDate: '2026-07-03', bookingCutoffDate: '2026-07-01',
    leadCoordinatorId: 's-0001', minParticipants: 4, requiredWheelchairCapacity: 1,
    requiredBeds: 9, requiredBedrooms: 5, minStaffRequired: 3, calculatedStaffRequired: 3,
    notes: 'Completed — debrief done 15 Jul. Claims generated.',
    highSupportCount: 1, wheelchairCount: 1, overnightSupportCount: 1,
    staffAssignedCount: 3, outstandingTaskCount: 0,
    insuranceConfirmedCount: 5, insuranceOutstandingCount: 0,
    departureTime: '08:30', returnTime: '16:00',
  },
}

function tripDetail(t) {
  return {
    ...t,
    eventTemplateId: null, eventTemplateName: null,
    activeHoursPerDay: 12,
    createdAt: '2026-05-02T10:00:00Z',
    updatedAt: '2026-07-30T11:20:00Z',
    ...(tripDetailExtras[t.id] || {}),
  }
}

// Staff (StaffListDto)
const staff = [
  {
    id: 's-0001', firstName: 'Callum', lastName: 'Radford', fullName: 'Callum Radford',
    role: 'Coordinator', email: 'callum.radford@example.com.au', mobile: '0412 555 101',
    region: 'Greater Brisbane', isDriverEligible: true, isFirstAidQualified: true,
    isMedicationCompetent: true, isManualHandlingCompetent: true, isOvernightEligible: true,
    isActive: true, firstAidExpiryDate: '2027-03-15', driverLicenceExpiryDate: '2028-06-30',
    manualHandlingExpiryDate: '2026-09-10', medicationCompetencyExpiryDate: '2027-01-22',
    hasExpiredQualifications: false, notes: 'Lead coordinator, Brisbane team.',
  },
  {
    id: 's-0002', firstName: 'Priya', lastName: 'Nadarajah', fullName: 'Priya Nadarajah',
    role: 'TeamLeader', email: 'priya.nadarajah@example.com.au', mobile: '0412 555 102',
    region: 'Sunshine Coast', isDriverEligible: true, isFirstAidQualified: true,
    isMedicationCompetent: true, isManualHandlingCompetent: true, isOvernightEligible: true,
    isActive: true, firstAidExpiryDate: '2026-11-05', driverLicenceExpiryDate: '2029-02-14',
    manualHandlingExpiryDate: '2027-04-18', medicationCompetencyExpiryDate: '2026-12-01',
    hasExpiredQualifications: false, notes: null,
  },
  {
    id: 's-0003', firstName: 'Jack', lastName: "O'Sullivan", fullName: "Jack O'Sullivan",
    role: 'SupportWorker', email: 'jack.osullivan@example.com.au', mobile: '0412 555 103',
    region: 'Gold Coast', isDriverEligible: true, isFirstAidQualified: true,
    isMedicationCompetent: false, isManualHandlingCompetent: true, isOvernightEligible: true,
    isActive: true, firstAidExpiryDate: '2026-08-20', driverLicenceExpiryDate: '2027-10-09',
    manualHandlingExpiryDate: '2026-10-30', medicationCompetencyExpiryDate: null,
    hasExpiredQualifications: false, notes: 'First aid renewal booked for 18 Aug.',
  },
  {
    id: 's-0004', firstName: 'Mei', lastName: 'Zhang', fullName: 'Mei Zhang',
    role: 'SeniorSupportWorker', email: 'mei.zhang@example.com.au', mobile: '0412 555 104',
    region: 'Greater Brisbane', isDriverEligible: false, isFirstAidQualified: true,
    isMedicationCompetent: true, isManualHandlingCompetent: true, isOvernightEligible: true,
    isActive: true, firstAidExpiryDate: '2027-05-27', driverLicenceExpiryDate: null,
    manualHandlingExpiryDate: '2027-02-12', medicationCompetencyExpiryDate: '2027-06-03',
    hasExpiredQualifications: false, notes: 'Auslan fluent.',
  },
  {
    id: 's-0005', firstName: 'Tom', lastName: 'Beattie', fullName: 'Tom Beattie',
    role: 'SupportWorker', email: 'tom.beattie@example.com.au', mobile: '0412 555 105',
    region: 'Logan', isDriverEligible: true, isFirstAidQualified: true,
    isMedicationCompetent: true, isManualHandlingCompetent: false, isOvernightEligible: false,
    isActive: true, firstAidExpiryDate: '2026-07-01', driverLicenceExpiryDate: '2027-12-25',
    manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: '2026-09-15',
    hasExpiredQualifications: true, notes: 'First aid expired 1 Jul 2026 — rostered off trips until renewed.',
  },
]

// Vehicles (VehicleListDto / VehicleDetailDto)
const vehicles = [
  {
    id: 'v-0001', vehicleName: 'Big Red', registration: '278 TQK',
    vehicleType: 'AccessibleVan', totalSeats: 10, wheelchairPositions: 2,
    isInternal: true, isActive: true,
    serviceDueDate: '2026-10-02', registrationDueDate: '2027-01-31',
  },
  {
    id: 'v-0002', vehicleName: 'Coastal Cruiser', registration: '641 WPB',
    vehicleType: 'MiniBus', totalSeats: 12, wheelchairPositions: 0,
    isInternal: true, isActive: true,
    serviceDueDate: '2026-08-25', registrationDueDate: '2026-11-15',
  },
  {
    id: 'v-0003', vehicleName: 'Hire WAV (Coastline Rentals)', registration: '119 XDF',
    vehicleType: 'AccessibleVan', totalSeats: 7, wheelchairPositions: 1,
    isInternal: false, isActive: true,
    serviceDueDate: null, registrationDueDate: null,
  },
]

const vehicleDetailExtras = {
  'v-0001': {
    rampHoistDetails: 'Rear electric hoist, 300 kg SWL. Manual ramp backup stored under rear seat.',
    driverRequirements: 'LR licence preferred; hoist induction required.',
    notes: 'Fleet vehicle — booked via office calendar.',
  },
  'v-0002': {
    rampHoistDetails: null, driverRequirements: 'Standard C class licence.',
    notes: 'Service due late August — avoid bookings 25–27 Aug.',
  },
  'v-0003': {
    rampHoistDetails: 'Fold-out rear ramp.',
    driverRequirements: 'Hire agreement — drivers must be listed with rental company.',
    notes: 'External hire; confirm availability at least 2 weeks out.',
  },
}

// Tasks (TaskDto)
const tasks = [
  {
    id: 'task-0001', tripInstanceId: 't-0001', tripName: 'Sunshine Coast Beach Escape',
    participantBookingId: null, accommodationReservationId: 'res-0001',
    vehicleAssignmentId: null, staffAssignmentId: null,
    taskType: 'AccommodationConfirmation', title: 'Confirm hoist hire delivery to Caloundra house',
    ownerId: 's-0002', ownerName: 'Priya Nadarajah', priority: 'High',
    dueDate: '2026-08-07', status: 'InProgress', completedDate: null,
    notes: 'Hire company to confirm drop-off window Thursday 13 Aug.',
  },
  {
    id: 'task-0002', tripInstanceId: 't-0001', tripName: 'Sunshine Coast Beach Escape',
    participantBookingId: 'b-0002', accommodationReservationId: null,
    vehicleAssignmentId: null, staffAssignmentId: null,
    taskType: 'InsuranceConfirmation', title: 'Chase travel insurance certificate — Sienna W.',
    ownerId: 's-0001', ownerName: 'Callum Radford', priority: 'Urgent',
    dueDate: '2026-07-31', status: 'Overdue', completedDate: null,
    notes: 'Plan manager emailed 24 Jul, no response yet.',
  },
  {
    id: 'task-0003', tripInstanceId: 't-0002', tripName: 'Tamborine Mountain Getaway',
    participantBookingId: null, accommodationReservationId: 'res-0002',
    vehicleAssignmentId: null, staffAssignmentId: null,
    taskType: 'AccommodationRequest', title: 'Request quote — Hinterland Lodge 28–30 Aug',
    ownerId: 's-0001', ownerName: 'Callum Radford', priority: 'Medium',
    dueDate: '2026-08-08', status: 'NotStarted', completedDate: null, notes: null,
  },
  {
    id: 'task-0004', tripInstanceId: 't-0002', tripName: 'Tamborine Mountain Getaway',
    participantBookingId: null, accommodationReservationId: null,
    vehicleAssignmentId: 'va-0002', staffAssignmentId: null,
    taskType: 'VehicleRequest', title: 'Book Coastal Cruiser for Tamborine trip',
    ownerId: 's-0002', ownerName: 'Priya Nadarajah', priority: 'Medium',
    dueDate: '2026-08-14', status: 'NotStarted', completedDate: null,
    notes: 'Check service schedule clash first.',
  },
  {
    id: 'task-0005', tripInstanceId: 't-0004', tripName: 'Byron Bay Winter Weekender',
    participantBookingId: null, accommodationReservationId: null,
    vehicleAssignmentId: null, staffAssignmentId: null,
    taskType: 'GenerateNdisClaims', title: 'Generate NDIS claims for Byron Bay trip',
    ownerId: 's-0001', ownerName: 'Callum Radford', priority: 'High',
    dueDate: '2026-07-20', status: 'Completed', completedDate: '2026-07-18',
    notes: 'Claims submitted via PRODA 18 Jul.',
  },
  // Item 9 (tasks as the obligation engine) — task-0006 is trip-less: tripInstanceId/tripName are
  // omitted entirely (not sent as null) to match the real "field omitted from JSON when absent"
  // contract. Its linkTo/shiftId/leaveRequestId tie it to Mei Zhang's approved leave and the
  // board-shift-0002 hole it creates (see rosterBoard() and sampleOverlapShift above).
  {
    id: 'task-0006',
    participantBookingId: null, accommodationReservationId: null,
    vehicleAssignmentId: null, staffAssignmentId: null,
    taskType: 'LeaveCoverage', title: "Find cover for Grace Palmer-Hughes' overnight shift (Mei Zhang on leave)",
    ownerId: 's-0001', ownerName: 'Callum Radford', priority: 'Urgent',
    dueDate: '2026-09-08', status: 'NotStarted', completedDate: null,
    notes: "Mei Zhang's approved sick leave (8-9 Sep) covers this shift.",
    linkTo: '/rostering/leave', leaveRequestId: 'leave-0002', shiftId: 'board-shift-0002',
  },
  // task-0007 keeps its trip (t-0004) — the contrasting case, showing tripInstanceId/tripName are
  // merely optional now, not always absent for the new obligation-engine task types.
  {
    id: 'task-0007', tripInstanceId: 't-0004', tripName: 'Byron Bay Winter Weekender',
    participantBookingId: null, accommodationReservationId: null,
    vehicleAssignmentId: null, staffAssignmentId: null,
    taskType: 'IncidentQscReport', title: 'File QSC report — missed evening medication dose',
    ownerId: 's-0002', ownerName: 'Priya Nadarajah', priority: 'High',
    dueDate: '2026-07-13', status: 'Overdue', completedDate: null,
    notes: 'QSC reporting window closes 72h after the incident.',
    linkTo: '/incidents/inc-0002/edit', incidentReportId: 'inc-0002',
  },
]

// Incidents (IncidentListDto)
const incidents = [
  {
    id: 'inc-0001', tripInstanceId: 't-0004', tripName: 'Byron Bay Winter Weekender',
    incidentType: 'Injury', severity: 'Low', status: 'Closed',
    title: 'Minor graze from beach walk slip',
    incidentDateTime: '2026-07-11T10:45:00Z', location: 'Main Beach boardwalk, Byron Bay',
    reportedByName: "Jack O'Sullivan", involvedParticipantId: 'p-0001', involvedParticipantName: 'Liam Okafor',
    qscReportingStatus: 'NotRequired', isOverdue24h: false, createdAt: '2026-07-11T11:30:00Z',
    // Connection map: no medication/shift/shift-note link on this one.
    medicationAdministrationId: null, shiftId: null, shiftNoteId: null,
  },
  {
    id: 'inc-0002', tripInstanceId: 't-0004', tripName: 'Byron Bay Winter Weekender',
    incidentType: 'MedicationError', severity: 'Medium', status: 'UnderReview',
    title: 'Missed evening medication dose',
    incidentDateTime: '2026-07-11T20:15:00Z', location: 'Accommodation — Byron Bay',
    reportedByName: 'Mei Zhang', involvedParticipantId: 'p-0004', involvedParticipantName: 'Grace Palmer-Hughes',
    qscReportingStatus: 'ReportedWithin24h', isOverdue24h: false, createdAt: '2026-07-11T21:05:00Z',
    // Connection map: this is the one incident fixture carrying a medication context, so the
    // Context panel has something real to show in the offline preview.
    medicationAdministrationId: 'admin-0001', shiftId: null, shiftNoteId: null,
  },
  {
    id: 'inc-0003', tripInstanceId: 't-0001', tripName: 'Sunshine Coast Beach Escape',
    incidentType: 'BehaviourOfConcern', severity: 'High', status: 'Submitted',
    title: 'Escalation during pre-trip meet and greet',
    incidentDateTime: '2026-07-29T14:00:00Z', location: 'Head office, Brisbane',
    reportedByName: 'Callum Radford', involvedParticipantId: 'p-0004', involvedParticipantName: 'Grace Palmer-Hughes',
    qscReportingStatus: 'Pending', isOverdue24h: true, createdAt: '2026-07-29T16:20:00Z',
    medicationAdministrationId: null, shiftId: null, shiftNoteId: null,
  },
]

// Medication administrations (AdministrationDto) — backs both /medications/mar (as MarEntryDto's
// nested `administration`) and /participants/:id/administrations. 'admin-0001' is the one linked
// to inc-0002 above (its narrative — "evening insulin dose administered late" — is the same
// event); the rest are unrelated fixtures covering the "already has an incident" / "no incident
// yet" / "Administered, no incident UI at all" cases the frontend's MarTab/MedicationsTab render.
const medicationAdministrations = [
  {
    id: 'admin-0001', participantMedicationId: 'med-0001', participantId: 'p-0004', participantName: 'Grace Palmer-Hughes',
    medicationName: 'Insulin', doseDescription: '18 units', tripInstanceId: 't-0004',
    scheduledAt: '2026-07-11T20:00:00Z', administeredAt: '2026-07-11T20:15:00Z', administeredAtTimeZone: 'Australia/Brisbane',
    status: 'Missed', doseGiven: null, recordedByName: 'Tom Beattie', recordedByUserId: 's-0005',
    witnessName: null, witnessStaffId: null, witnessStatus: 'NotRequired', witnessRequestedAt: null, witnessRespondedAt: null,
    reason: 'Dinner ran over schedule; dose given 90 minutes late.', prnReason: null, prnOutcome: null, prnOutcomeAt: null,
    limitBreachAcknowledged: false, notes: null, createdAt: '2026-07-11T20:20:00Z',
    incidentId: 'inc-0002',
  },
  {
    id: 'admin-0002', participantMedicationId: 'med-0002', participantId: 'p-0001', participantName: 'Liam Okafor',
    medicationName: 'Levetiracetam', doseDescription: '500mg', tripInstanceId: null,
    scheduledAt: '2026-09-12T22:00:00Z', administeredAt: '2026-09-12T22:05:00Z', administeredAtTimeZone: 'Australia/Brisbane',
    status: 'Administered', doseGiven: '500mg', recordedByName: "Jack O'Sullivan", recordedByUserId: 's-0003',
    witnessName: null, witnessStaffId: null, witnessStatus: 'NotRequired', witnessRequestedAt: null, witnessRespondedAt: null,
    reason: null, prnReason: null, prnOutcome: null, prnOutcomeAt: null, limitBreachAcknowledged: false, notes: null,
    createdAt: '2026-09-12T22:05:00Z', incidentId: null,
  },
  {
    id: 'admin-0003', participantMedicationId: 'med-0003', participantId: 'p-0004', participantName: 'Grace Palmer-Hughes',
    medicationName: 'Risperidone', doseDescription: '2mg', tripInstanceId: null,
    scheduledAt: '2026-09-12T20:00:00Z', administeredAt: null, administeredAtTimeZone: null,
    status: 'Refused', doseGiven: null, recordedByName: 'Mei Zhang', recordedByUserId: 's-0004',
    witnessName: null, witnessStaffId: null, witnessStatus: 'NotRequired', witnessRequestedAt: null, witnessRespondedAt: null,
    reason: 'Participant declined after prompting.', prnReason: null, prnOutcome: null, prnOutcomeAt: null,
    limitBreachAcknowledged: false, notes: null, createdAt: '2026-09-12T20:10:00Z', incidentId: null,
  },
]

// MarEntryDto rows built off the administrations above — see the /medications/mar route: like
// /leave and /staff-availability, the date/participantId query string isn't read here, so this
// always returns the same fixed day regardless of what's requested.
const marEntries = [
  {
    medicationId: 'med-0002', participantId: 'p-0001', participantName: 'Liam Okafor',
    medicationName: 'Levetiracetam', strength: '500mg', doseDescription: '1 tablet',
    form: 'Tablet', route: 'Oral', packaging: 'WebsterPack',
    pharmacyName: 'Riverside Pharmacy', pharmacyPhone: '07 3000 1111',
    scheduledTime: '22:00', scheduledAt: '2026-09-12T22:00:00Z',
    isHighRisk: false, supportLevel: 'Administer', isOverdue: false,
    administration: medicationAdministrations[1],
    incidentId: medicationAdministrations[1].incidentId,
  },
  {
    medicationId: 'med-0003', participantId: 'p-0004', participantName: 'Grace Palmer-Hughes',
    medicationName: 'Risperidone', strength: '2mg', doseDescription: '1 tablet',
    form: 'Tablet', route: 'Oral', packaging: 'DosetteBox',
    pharmacyName: 'Riverside Pharmacy', pharmacyPhone: '07 3000 1111',
    scheduledTime: '20:00', scheduledAt: '2026-09-12T20:00:00Z',
    isHighRisk: true, supportLevel: 'Administer', isOverdue: false,
    administration: medicationAdministrations[2],
    incidentId: medicationAdministrations[2].incidentId,
  },
]

const marDay = { date: '2026-09-12', entries: marEntries, prnMedications: [] }

const incidentDetailExtras = {
  'inc-0001': {
    participantBookingId: 'b-0004', involvedParticipantId: 'p-0001',
    involvedStaffId: null, involvedStaffName: null, reportedByStaffId: 's-0003',
    description: 'Participant slipped on wet boardwalk and grazed left knee. First aid applied on site.',
    immediateActionsTaken: 'Wound cleaned and dressed; participant monitored for remainder of outing.',
    wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
    witnessNames: 'Mei Zhang', witnessStatements: 'Confirmed accidental slip; surface was wet from rain.',
    qscReportedAt: null, qscReferenceNumber: null,
    reviewedByStaffId: 's-0001', reviewedByName: 'Callum Radford',
    reviewedAt: '2026-07-14T09:00:00Z', reviewNotes: 'No further action. Footwear check added to pre-walk checklist.',
    correctiveActions: 'Added wet-weather route alternative to itinerary template.',
    resolvedAt: '2026-07-14T09:00:00Z',
    familyNotified: true, familyNotifiedAt: '2026-07-11T12:00:00Z',
    supportCoordinatorNotified: false, supportCoordinatorNotifiedAt: null,
    updatedAt: '2026-07-14T09:00:00Z',
    medicationContext: null, shiftContext: null, shiftNoteContext: null,
  },
  'inc-0002': {
    participantBookingId: 'b-0003', involvedParticipantId: 'p-0004',
    involvedStaffId: 's-0005', involvedStaffName: 'Tom Beattie', reportedByStaffId: 's-0004',
    description: 'Evening insulin dose administered 90 minutes late after dinner ran over schedule.',
    immediateActionsTaken: 'BGL checked, on-call nurse consulted, dose given per protocol.',
    wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
    witnessNames: null, witnessStatements: null,
    qscReportedAt: '2026-07-12T09:10:00Z', qscReferenceNumber: 'QSC-2026-48213',
    reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null,
    correctiveActions: null, resolvedAt: null,
    familyNotified: true, familyNotifiedAt: '2026-07-12T08:30:00Z',
    supportCoordinatorNotified: true, supportCoordinatorNotifiedAt: '2026-07-12T08:45:00Z',
    updatedAt: '2026-07-25T10:00:00Z',
    // Connection map: the one incident fixture that carries a real medication context, matching
    // medicationAdministrationId above and admin-0001's own record.
    medicationContext: {
      medicationAdministrationId: 'admin-0001', medicationName: 'Insulin', status: 'Missed',
      administeredAt: '2026-07-11T20:15:00Z', recordedByName: 'Tom Beattie',
    },
    shiftContext: null, shiftNoteContext: null,
  },
  'inc-0003': {
    participantBookingId: null, involvedParticipantId: 'p-0004',
    involvedStaffId: null, involvedStaffName: null, reportedByStaffId: 's-0001',
    description: 'Participant became distressed during group briefing; property damage to meeting-room chair.',
    immediateActionsTaken: 'Quiet-space strategy used per BSP; participant settled within 20 minutes.',
    wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
    witnessNames: 'Priya Nadarajah', witnessStatements: null,
    qscReportedAt: null, qscReferenceNumber: null,
    reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null,
    correctiveActions: null, resolvedAt: null,
    familyNotified: true, familyNotifiedAt: '2026-07-29T17:00:00Z',
    supportCoordinatorNotified: true, supportCoordinatorNotifiedAt: '2026-07-29T17:15:00Z',
    updatedAt: '2026-07-30T08:00:00Z',
    medicationContext: null, shiftContext: null, shiftNoteContext: null,
  },
}

// Shift notes (NOTES-01/02, ShiftNoteDto) — offline preview fixtures for the portal
// ShiftNotesSection and the roster slide-over's read-only list. Keyed by shiftId so
// GET /portal/shifts/:id/notes and GET /rostering/shifts/:id/notes below can share them.
// note-0003 already carries an incidentId (connection map item 4) — the portal renders
// "Incident filed" instead of the dismiss/file prompt for it.
const shiftNotesByShiftId = {
  'shift-0001': [
    {
      id: 'note-0001', shiftId: 'shift-0001', authorUserId: 's-0003', authorName: "Jack O'Sullivan",
      body: 'Quiet shift, no concerns.', createdAt: '2026-09-08T09:30:00Z', updatedAt: '2026-09-08T09:30:00Z',
      flaggedCategories: [], flagsAcknowledgedAt: null, incidentId: null,
    },
    {
      id: 'note-0002', shiftId: 'shift-0001', authorUserId: 's-0003', authorName: "Jack O'Sullivan",
      body: 'Liam had a fall near the bathroom — no injury, monitored for the rest of the shift.',
      createdAt: '2026-09-09T14:10:00Z', updatedAt: '2026-09-09T14:10:00Z',
      flaggedCategories: ['Falls'], flagsAcknowledgedAt: null, incidentId: null,
    },
  ],
  'shift-0002': [
    {
      id: 'note-0003', shiftId: 'shift-0002', authorUserId: 's-0004', authorName: 'Mei Zhang',
      body: 'Grace refused her evening medication — settled after a short break.',
      createdAt: '2026-09-10T20:05:00Z', updatedAt: '2026-09-10T20:05:00Z',
      flaggedCategories: ['Medication'], flagsAcknowledgedAt: '2026-09-11T08:00:00Z', incidentId: 'inc-0002',
    },
  ],
  'shift-0003': [
    {
      id: 'note-0004', shiftId: 'shift-0003', authorUserId: 's-0005', authorName: 'Tom Beattie',
      body: 'Sienna bumped her arm transferring into the WAV — small graze, cleaned and dressed.',
      createdAt: '2026-09-11T11:20:00Z', updatedAt: '2026-09-11T11:20:00Z',
      flaggedCategories: ['Injury'], flagsAcknowledgedAt: null, incidentId: null,
    },
  ],
}

// shiftId -> participant, for the flagged-notes projection below (a shift note fixture only
// carries authorUserId/authorName — the participant comes from which shift it's on).
const shiftParticipant = {
  'shift-0001': { id: 'p-0001', name: 'Liam Okafor' },
  'shift-0002': { id: 'p-0004', name: 'Grace Palmer-Hughes' },
  'shift-0003': { id: 'p-0002', name: 'Sienna Whitfield' },
}

// shiftId -> schedule, for the flagged-notes projection's startTime/endTime/endsNextDay
// (connection map seam follow-up: IncidentsPage's "File incident" hand-off carries the shift's
// real time range instead of a fake full-day window). shift-0002 is the one overnight example.
const shiftSchedule = {
  'shift-0001': { startTime: '08:00:00', endTime: '17:00:00', endsNextDay: false },
  'shift-0002': { startTime: '19:00:00', endTime: '07:00:00', endsNextDay: true },
  'shift-0003': { startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false },
}

// Flagged-notes queue (connection map item 4) — GET /rostering/flagged-notes?withoutIncident=&from=&to=,
// coordinator roles only. Oldest first. Derived from shiftNotesByShiftId's flagged notes rather
// than duplicated by hand, so the two fixtures can't drift. Three sample rows (note-0002/3/4).
const flaggedShiftNotes = Object.values(shiftNotesByShiftId)
  .flat()
  .filter((n) => n.flaggedCategories.length > 0)
  .map((n) => ({
    shiftNoteId: n.id,
    shiftId: n.shiftId,
    shiftDate: n.createdAt.slice(0, 10),
    participantId: shiftParticipant[n.shiftId].id,
    participantName: shiftParticipant[n.shiftId].name,
    staffId: n.authorUserId,
    staffName: n.authorName,
    // Wire shape: FlaggedShiftNoteDto.FlaggedCategories is a real string[] — same
    // ShiftNoteKeywordVocabulary.ToCategoryNames-produced shape as ShiftNoteDto's own
    // flaggedCategories, not the raw [Flags] enum.
    flaggedCategories: n.flaggedCategories,
    excerpt: n.body,
    createdAt: n.createdAt,
    incidentId: n.incidentId,
    startTime: shiftSchedule[n.shiftId].startTime,
    endTime: shiftSchedule[n.shiftId].endTime,
    endsNextDay: shiftSchedule[n.shiftId].endsNextDay,
  }))
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

// Shift completions (design spec §2, ShiftCompletionDto) — backs GET rostering/completions
// (queue), GET rostering/shifts/:id/completion (detail), GET/POST portal/shifts/:id(/start|/finish)
// and the rostering completion/approve/return/approve-batch routes below.
const shiftCompletions = [
  {
    id: 'sc-0001', shiftId: 'shift-0001', actualStart: '2026-09-08T08:58:00Z', actualEnd: '2026-09-08T17:05:00Z',
    timeZoneId: 'Australia/Brisbane', geolocationDeclined: false, startWasManual: false,
    submittedByUserId: 's-0003', submittedByName: "Jack O'Sullivan",
    startedAt: '2026-09-08T08:58:00Z', submittedAt: '2026-09-08T17:05:00Z',
    reviewedByUserId: 's-0001', reviewedByName: 'Callum Radford', reviewedAt: '2026-09-08T18:00:00Z',
    reviewOutcome: 'Approved', returnReason: null,
    varianceMinutesStart: -2, varianceMinutesEnd: 5, isOutlierVariance: false, varianceReviewMinutes: 15,
    returnCount: 0, incidents: [],
  },
  {
    id: 'sc-0002', shiftId: 'shift-0002', actualStart: '2026-09-10T19:32:00Z', actualEnd: '2026-09-10T23:50:00Z',
    timeZoneId: 'Australia/Brisbane', geolocationDeclined: false, startWasManual: false,
    submittedByUserId: 's-0004', submittedByName: 'Mei Zhang',
    startedAt: '2026-09-10T19:32:00Z', submittedAt: '2026-09-10T23:50:00Z',
    reviewedByUserId: null, reviewedByName: null, reviewedAt: null,
    reviewOutcome: null, returnReason: null,
    varianceMinutesStart: 32, varianceMinutesEnd: -10, isOutlierVariance: true, varianceReviewMinutes: 15,
    returnCount: 0,
    incidents: [
      { id: 'inc-0002', title: 'Missed evening medication dose', severity: 'Medium', status: 'UnderReview', incidentDateTime: '2026-07-11T20:15:00Z' },
    ],
  },
]

// Portal shift detail (design spec §2, PortalShiftDetailDto) — backs GET/POST
// portal/shifts/:id(/start|/finish). Keyed by the same three shiftIds as shiftNotesByShiftId/
// shiftCompletions/shiftSchedule above, one per completion-flow stage: shift-0001 already
// Approved (Completed), shift-0002 submitted and awaiting review (PendingReview), shift-0003
// never started (Published) — so the Start flow has something to act on. Stateless like every
// other fixture in this file: POST start/finish return a plausible new object, they don't mutate
// this base.
const portalShiftBase = {
  'shift-0001': {
    id: 'shift-0001', participantId: shiftParticipant['shift-0001'].id, serviceDate: '2026-09-08',
    startTime: shiftSchedule['shift-0001'].startTime, endTime: shiftSchedule['shift-0001'].endTime,
    endsNextDay: shiftSchedule['shift-0001'].endsNextDay, durationHours: 8, ratio: 'OneToOne', nightType: 'None',
    notes: null, status: 'Completed',
  },
  'shift-0002': {
    id: 'shift-0002', participantId: shiftParticipant['shift-0002'].id, serviceDate: '2026-09-10',
    startTime: shiftSchedule['shift-0002'].startTime, endTime: shiftSchedule['shift-0002'].endTime,
    endsNextDay: shiftSchedule['shift-0002'].endsNextDay, durationHours: 12, ratio: 'OneToOne', nightType: 'ActiveNight',
    notes: null, status: 'PendingReview',
  },
  'shift-0003': {
    id: 'shift-0003', participantId: shiftParticipant['shift-0003'].id, serviceDate: '2026-09-13',
    startTime: shiftSchedule['shift-0003'].startTime, endTime: shiftSchedule['shift-0003'].endTime,
    endsNextDay: shiftSchedule['shift-0003'].endsNextDay, durationHours: 6, ratio: 'OneToOne', nightType: 'None',
    notes: null, status: 'Published',
  },
}

/** Maps a `participants` fixture row (+ its participantDetailExtras) onto the narrower
 * PortalParticipantSummaryDto shape — reusing the one fixture rather than maintaining a second
 * hand-written participant summary per shift. */
function portalParticipantSummary(participantId) {
  const p = participants.find((x) => x.id === participantId) || participants[0]
  const extra = participantDetailExtras[p.id] || {}
  return {
    id: p.id, fullName: p.fullName,
    isHighSupport: p.isHighSupport, isIntensiveSupport: p.isIntensiveSupport,
    hasRestrictivePracticeFlag: p.hasRestrictivePracticeFlag, supportRatio: p.supportRatio,
    overnightSupport: p.requiresOvernightSupport ? 'ActiveNight' : 'None',
    mobilityAidWheelchair: p.wheelchairRequired, mobilityAidWalker: false, mobilitySupportOptions: [],
    requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false,
    requiresStandingMachine: false,
    mobilityNotes: extra.mobilityNotes ?? null, equipmentRequirements: extra.equipmentRequirements ?? null,
    transportRequirements: extra.transportRequirements ?? null, medicalSummary: extra.medicalSummary ?? null,
    behaviourRiskSummary: extra.behaviourRiskSummary ?? null,
  }
}

/** Builds a PortalShiftDetailDto for one fixture shift, optionally overriding `status` and the
 * active `completion` (used by the start/finish POST handlers below to hand back a plausible
 * post-action shape without mutating portalShiftBase/shiftCompletions). */
function buildPortalShiftDetail(shiftId, overrides = {}) {
  const base = portalShiftBase[shiftId] || portalShiftBase['shift-0003']
  const status = overrides.status ?? base.status
  const completion = Object.prototype.hasOwnProperty.call(overrides, 'completion')
    ? overrides.completion
    : shiftCompletions.find((c) => c.shiftId === base.id) || null
  return {
    id: base.id, serviceDate: base.serviceDate, startTime: base.startTime, endTime: base.endTime,
    endsNextDay: base.endsNextDay, durationHours: base.durationHours, ratio: base.ratio, nightType: base.nightType,
    status, notes: base.notes,
    participant: portalParticipantSummary(base.participantId),
    routines: [], riskEntries: [], medications: [],
    completion,
    returnCount: completion ? completion.returnCount : 0,
    lastReturnReason: null,
  }
}

/** CompletionQueueItemDto rows (design spec §2/§4) for GET rostering/completions — derived from
 * portalShiftBase + shiftCompletions rather than a third hand-maintained fixture. Every fixture
 * shift with an active completion is included regardless of status (this mock's GET routes don't
 * read the query string — see the leave/staff-availability routes above for the same caveat) —
 * the real endpoint filters to one status at a time server-side.
 */
function rosteredEndDate(serviceDate, endsNextDay) {
  if (!endsNextDay) return serviceDate
  const d = new Date(`${serviceDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

const completionQueueItems = Object.values(portalShiftBase)
  .map((base) => {
    const completion = shiftCompletions.find((c) => c.shiftId === base.id)
    if (!completion) return null
    const participant = participants.find((p) => p.id === base.participantId)
    return {
      shiftId: base.id, completionId: completion.id,
      participantName: participant ? participant.fullName : 'Unknown participant',
      staffName: completion.submittedByName,
      serviceDate: base.serviceDate,
      rosteredStart: `${base.serviceDate}T${base.startTime}Z`,
      rosteredEnd: `${rosteredEndDate(base.serviceDate, base.endsNextDay)}T${base.endTime}Z`,
      actualStart: completion.actualStart, actualEnd: completion.actualEnd,
      varianceMinutesStart: completion.varianceMinutesStart, varianceMinutesEnd: completion.varianceMinutesEnd,
      status: base.status, timeZoneId: completion.timeZoneId,
      isOutlierVariance: completion.isOutlierVariance, varianceReviewMinutes: completion.varianceReviewMinutes,
      returnCount: completion.returnCount,
    }
  })
  .filter(Boolean)

// Bookings (BookingListDto)
const bookings = [
  {
    id: 'b-0001', tripInstanceId: 't-0001', tripName: 'Sunshine Coast Beach Escape',
    participantId: 'p-0001', participantName: 'Liam Okafor',
    bookingStatus: 'Confirmed', bookingDate: '2026-06-20',
    wheelchairRequired: false, highSupportRequired: false, nightSupportRequired: false,
    hasRestrictivePracticeFlag: false, supportRatioOverride: null,
    actionRequired: false, insuranceStatus: 'Confirmed', paymentStatus: 'Paid',
  },
  {
    id: 'b-0002', tripInstanceId: 't-0001', tripName: 'Sunshine Coast Beach Escape',
    participantId: 'p-0002', participantName: 'Sienna Whitfield',
    bookingStatus: 'Confirmed', bookingDate: '2026-06-22',
    wheelchairRequired: true, highSupportRequired: true, nightSupportRequired: true,
    hasRestrictivePracticeFlag: false, supportRatioOverride: 'OneToOne',
    actionRequired: true, insuranceStatus: 'Pending', paymentStatus: 'InvoiceSent',
  },
  {
    id: 'b-0003', tripInstanceId: 't-0002', tripName: 'Tamborine Mountain Getaway',
    participantId: 'p-0004', participantName: 'Grace Palmer-Hughes',
    bookingStatus: 'Held', bookingDate: '2026-07-15',
    wheelchairRequired: false, highSupportRequired: true, nightSupportRequired: true,
    hasRestrictivePracticeFlag: true, supportRatioOverride: 'TwoToOne',
    actionRequired: true, insuranceStatus: 'None', paymentStatus: 'NotInvoiced',
  },
  {
    id: 'b-0004', tripInstanceId: 't-0004', tripName: 'Byron Bay Winter Weekender',
    participantId: 'p-0003', participantName: 'Marcus Tran',
    bookingStatus: 'Completed', bookingDate: '2026-05-30',
    wheelchairRequired: false, highSupportRequired: false, nightSupportRequired: false,
    hasRestrictivePracticeFlag: false, supportRatioOverride: null,
    actionRequired: false, insuranceStatus: 'Confirmed', paymentStatus: 'Paid',
  },
]

function bookingDetail(b) {
  return {
    ...b,
    planTypeOverride: null,
    fundingNotes: null,
    roomPreference: b.wheelchairRequired ? 'Ground floor, accessible bathroom' : null,
    transportNotes: null,
    equipmentNotes: null,
    riskSupportNotes: null,
    bookingNotes: null,
    cancellationReason: null,
    createdAt: '2026-06-20T09:00:00Z',
    updatedAt: '2026-07-28T13:00:00Z',
    insuranceProvider: b.insuranceStatus === 'Confirmed' ? 'TravelSafe Mutual' : null,
    insurancePolicyNumber: b.insuranceStatus === 'Confirmed' ? 'TSM-2026-77412' : null,
    insuranceCoverageStart: b.insuranceStatus === 'Confirmed' ? '2026-08-13' : null,
    insuranceCoverageEnd: b.insuranceStatus === 'Confirmed' ? '2026-08-18' : null,
    isInsuranceValid: b.insuranceStatus === 'Confirmed',
  }
}

// Accommodation (AccommodationListDto)
const accommodation = [
  {
    id: 'a-0001', propertyName: 'Seabreeze Accessible House',
    location: 'Caloundra', region: 'Sunshine Coast',
    address: '12 Esplanade Court', suburb: 'Kings Beach', state: 'QLD', postcode: '4551',
    isFullyModified: true, isSemiModified: false, isWheelchairAccessible: true,
    bedroomCount: 5, bedCount: 8, maxCapacity: 9, isActive: true,
  },
  {
    id: 'a-0002', propertyName: 'Hinterland Lodge Retreat',
    location: 'Mount Tamborine', region: 'Gold Coast Hinterland',
    address: '48 Gallery Walk Road', suburb: 'Eagle Heights', state: 'QLD', postcode: '4272',
    isFullyModified: false, isSemiModified: true, isWheelchairAccessible: false,
    bedroomCount: 6, bedCount: 10, maxCapacity: 12, isActive: true,
  },
]

const accommodationDetailExtras = {
  'a-0001': {
    providerOwner: 'Coastline Accessible Stays Pty Ltd',
    contactPerson: 'Renee Calloway', email: 'bookings@example.com.au',
    phone: '07 5400 1122', mobile: '0400 222 331', website: 'https://example.com.au/seabreeze',
    accessibilityNotes: 'Step-free throughout. Ceiling hoist in bedroom 1, roll-in shower x2.',
    beddingConfiguration: '2x king single (adjustable), 4x single, 1x queen, 1x sofa bed.',
    hoistBathroomNotes: 'Ceiling hoist bedroom 1 only; mobile hoist can be hired locally.',
    generalNotes: 'Preferred property for coastal trips. Books out school holidays.',
  },
  'a-0002': {
    providerOwner: 'Tamborine Escapes',
    contactPerson: 'Bruce Hollis', email: 'stay@example.com.au',
    phone: '07 5545 8890', mobile: null, website: null,
    accessibilityNotes: 'Two steps at front entry with portable ramp available. Not suitable for power chairs.',
    beddingConfiguration: '6 bedrooms: 2x queen, 8x single.',
    hoistBathroomNotes: 'No hoist. One semi-modified bathroom with grab rails.',
    generalNotes: 'Great deck views; log fire in winter.',
  },
}

// Schedule (ScheduleOverviewDto)
const scheduleOverview = {
  trips: trips.map((t) => ({
    id: t.id, tripName: t.tripName, tripCode: t.tripCode, destination: t.destination,
    region: t.region, startDate: t.startDate, endDate: t.endDate,
    durationDays: t.durationDays, status: t.status, maxParticipants: t.maxParticipants,
    currentParticipantCount: t.currentParticipantCount,
    minStaffRequired: (tripDetailExtras[t.id] || {}).minStaffRequired ?? null,
    staffRequired: (tripDetailExtras[t.id] || {}).calculatedStaffRequired ?? null,
    staffAssignedCount: (tripDetailExtras[t.id] || {}).staffAssignedCount ?? 0,
    vehicleAssignedCount: t.id === 't-0001' || t.id === 't-0004' ? 1 : 0,
    leadCoordinatorName: t.leadCoordinatorName,
    preferenceMatchCount: t.id === 't-0001' ? 2 : 0,
  })),
  staff: staff.map((s) => ({
    id: s.id, firstName: s.firstName, lastName: s.lastName, fullName: s.fullName,
    role: s.role, region: s.region, isDriverEligible: s.isDriverEligible,
    isFirstAidQualified: s.isFirstAidQualified, isMedicationCompetent: s.isMedicationCompetent,
    isManualHandlingCompetent: s.isManualHandlingCompetent, isOvernightEligible: s.isOvernightEligible,
    tripStatuses:
      s.id === 's-0002'
        ? [{ tripId: 't-0001', status: 'Assigned', assignmentRole: 'Team Leader', assignmentStatus: 'Confirmed', assignmentId: 'sa-0001' }]
        : s.id === 's-0003'
          ? [{ tripId: 't-0001', status: 'Assigned', assignmentRole: 'Support Worker / Driver', assignmentStatus: 'Confirmed', assignmentId: 'sa-0002' }]
          : s.id === 's-0004'
            ? [{ tripId: 't-0001', status: 'Assigned', assignmentRole: 'Support Worker', assignmentStatus: 'Proposed', assignmentId: 'sa-0003' }]
            : [],
    availability:
      s.id === 's-0005'
        ? [{
            id: 'av-0001', staffId: 's-0005',
            startDateTime: '2026-08-10T00:00:00Z', endDateTime: '2026-08-21T23:59:00Z',
            availabilityType: 'Leave', isRecurring: false, recurrenceNotes: null,
            notes: 'Annual leave — overseas.',
          }]
        : [],
    preferredForTrips: s.id === 's-0002' ? [{ tripId: 't-0001', participantCount: 2 }] : [],
  })),
  vehicles: vehicles.map((v) => ({
    id: v.id, vehicleName: v.vehicleName, registration: v.registration,
    vehicleType: v.vehicleType, totalSeats: v.totalSeats,
    wheelchairPositions: v.wheelchairPositions, isInternal: v.isInternal,
    tripStatuses:
      v.id === 'v-0001'
        ? [{ tripId: 't-0001', status: 'Assigned', assignmentStatus: 'Confirmed' }]
        : [],
  })),
}

// Public holidays (PublicHolidayDto) — QLD, 2026
const publicHolidays = [
  { id: 'ph-0001', date: '2026-08-12', name: 'Royal Queensland Show (Brisbane area)', state: 'QLD' },
  { id: 'ph-0002', date: '2026-10-05', name: "King's Birthday", state: 'QLD' },
  { id: 'ph-0003', date: '2026-12-25', name: 'Christmas Day', state: 'QLD' },
  { id: 'ph-0004', date: '2026-12-26', name: 'Boxing Day', state: 'QLD' },
  { id: 'ph-0005', date: '2026-05-04', name: 'Labour Day', state: 'QLD' },
]

// Dashboard summary (DashboardSummaryDto)
const dashboardSummary = {
  upcomingTripCount: 3,
  activeParticipantCount: 5,
  outstandingTaskCount: 4,
  overdueTaskCount: 1,
  conflictCount: 1,
  tripsMissingAccommodation: 1,
  tripsMissingVehicles: 1,
  tripsMissingStaff: 2,
  openIncidentCount: 2,
  qscOverdueCount: 1,
  upcomingTrips: trips.filter((t) => t.status !== 'Completed'),
  overdueTasks: tasks.filter((t) => t.status === 'Overdue'),
}

// Staff "my dashboard" (StaffDashboardDto) — for support-worker view
const myDashboard = {
  staffId: 's-0003',
  fullName: "Jack O'Sullivan",
  upcomingTripCount: 1,
  activeAssignmentCount: 1,
  nextTripCountdownDays: 12,
  activeTrip: null,
  assignments: [
    {
      assignmentId: 'sa-0002', tripInstanceId: 't-0001',
      tripName: 'Sunshine Coast Beach Escape', destination: 'Caloundra QLD',
      region: 'Sunshine Coast', startDate: '2026-08-14', endDate: '2026-08-17',
      durationDays: 4, tripStatus: 'Confirmed', assignmentStatus: 'Confirmed',
      assignmentRole: 'Support Worker / Driver', isDriver: true,
      sleepoverType: 'Sleepover', shiftNotes: 'Driving Big Red. Hoist induction complete.',
      group: 'Upcoming', daysUntilStart: 12,
    },
  ],
  qualifications: [
    { name: 'First Aid', status: 'ExpiringSoon', expiryDate: '2026-08-20', daysUntilExpiry: 18 },
    { name: 'Driver Licence', status: 'Current', expiryDate: '2027-10-09', daysUntilExpiry: 433 },
    { name: 'Manual Handling', status: 'Current', expiryDate: '2026-10-30', daysUntilExpiry: 89 },
  ],
}

// Staff assignments per trip (StaffAssignmentDto)
const tripStaffAssignments = {
  't-0001': [
    {
      id: 'sa-0001', tripInstanceId: 't-0001', tripName: 'Sunshine Coast Beach Escape',
      staffId: 's-0002', staffName: 'Priya Nadarajah', assignmentRole: 'Team Leader',
      assignmentStart: '2026-08-14T08:00:00Z', assignmentEnd: '2026-08-17T16:00:00Z',
      status: 'Confirmed', isDriver: false, sleepoverType: 'Sleepover',
      shiftNotes: null, hasConflict: false,
    },
    {
      id: 'sa-0002', tripInstanceId: 't-0001', tripName: 'Sunshine Coast Beach Escape',
      staffId: 's-0003', staffName: "Jack O'Sullivan", assignmentRole: 'Support Worker / Driver',
      assignmentStart: '2026-08-14T08:00:00Z', assignmentEnd: '2026-08-17T16:00:00Z',
      status: 'Confirmed', isDriver: true, sleepoverType: 'Sleepover',
      shiftNotes: 'Driving Big Red.', hasConflict: false,
    },
    {
      id: 'sa-0003', tripInstanceId: 't-0001', tripName: 'Sunshine Coast Beach Escape',
      staffId: 's-0004', staffName: 'Mei Zhang', assignmentRole: 'Support Worker',
      assignmentStart: '2026-08-14T08:00:00Z', assignmentEnd: '2026-08-17T16:00:00Z',
      status: 'Proposed', isDriver: false, sleepoverType: 'ActiveNight',
      shiftNotes: 'Active night for Grace (2:1 overnight).', hasConflict: false,
    },
  ],
}

// Vehicle assignments per trip (VehicleAssignmentDto)
const tripVehicleAssignments = {
  't-0001': [
    {
      id: 'va-0001', tripInstanceId: 't-0001', vehicleId: 'v-0001',
      vehicleName: 'Big Red', registration: '278 TQK', status: 'Confirmed',
      requestedDate: '2026-07-01', confirmedDate: '2026-07-05',
      driverStaffId: 's-0003', driverName: "Jack O'Sullivan",
      seatRequirement: 8, wheelchairPositionRequirement: 1,
      pickupTravelNotes: 'Depart head office 09:00; pickup Sienna en route (WAV).',
      comments: null, hasOverlapConflict: false,
    },
  ],
}

// Settings (AppSettingsDto)
const appSettings = { qualificationWarningDays: 30 }

// Leave requests (LeaveRequestDto) + recurring unavailability (RecurringUnavailabilityDto) —
// offline preview fixtures for the coordinator LeaveApprovalsPage and self-service
// PortalLeavePage. CURRENT_STAFF_ID mirrors myDashboard.staffId — the "current user" the
// portal/* routes below answer for.
const CURRENT_STAFF_ID = 's-0003'

// Item 5 (leave-approval overlaps become roster actions) — the one overlapShifts row every
// leave/unavailability approve and edit mock response below carries, beside the existing empty
// `overlaps` findings array. Matches board-shift-0002 in rosterBoard() below, so a coordinator
// clicking "Unassign and mark open" here and then opening the roster board sees the same shift.
const sampleOverlapShift = {
  shiftId: 'board-shift-0002', serviceDate: '2026-09-08', startTime: '19:00:00', endTime: '07:00:00',
  endsNextDay: true, participantId: 'p-0004', participantName: 'Grace Palmer-Hughes',
}

// Paired finding for sampleOverlapShift — kept alongside it (rather than an empty `overlaps`
// array) so the approve/edit dialogs actually open with something to show in this mock, matching
// the real contract's "overlapShifts sits beside the overlaps findings" shape.
const sampleOverlapFinding = {
  code: 'DOUBLE_BOOKED_SHIFT', severity: 'Warning',
  message: 'Overlaps a rostered shift for Grace Palmer-Hughes on 8 Sep.', requiresReason: false,
}

// Roster board (RosterBoardDto) — GET /rostering/board. Stateless/query-string-blind like every
// other GET here (groupBy/weekStart aren't read); always returns the Participant-grouped shape,
// which is RosterBoardPage's default view. board-shift-0002 is deliberately assigned to Mei
// Zhang (s-0004) with assigneeOnApprovedLeave: true — she has an Approved Sick leave request
// (leave-0002, 2026-09-08..09-09) that now covers this shift, so it renders as an "On leave"
// hole rather than a normal filled chip; board-shift-0001 is a normal filled shift for contrast.
function rosterBoard() {
  return {
    groupBy: 'Participant',
    weekStart: '2026-09-07',
    days: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'],
    participantRows: [
      {
        participantId: 'p-0001', fullName: 'Liam Okafor', supportRatio: 'OneToTwo', overnightSupport: 'None',
        hasRestrictivePractice: false,
        shifts: [{
          id: 'board-shift-0001', participantId: 'p-0001', participantName: 'Liam Okafor',
          staffId: 's-0003', staffName: "Jack O'Sullivan", serviceDate: '2026-09-08',
          startTime: '08:00:00', endTime: '17:00:00', endsNextDay: false, durationHours: 8,
          ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null,
          notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false,
        }],
        tripBars: [], scheduledHours: 8, daysWithoutCover: 6,
      },
      {
        participantId: 'p-0004', fullName: 'Grace Palmer-Hughes', supportRatio: 'TwoToOne', overnightSupport: 'ActiveNight',
        hasRestrictivePractice: true,
        shifts: [{
          id: 'board-shift-0002', participantId: 'p-0004', participantName: 'Grace Palmer-Hughes',
          staffId: 's-0004', staffName: 'Mei Zhang', serviceDate: '2026-09-08',
          startTime: '19:00:00', endTime: '07:00:00', endsNextDay: true, durationHours: 12,
          ratio: 'OneToOne', nightType: 'ActiveNight', status: 'Published', shiftPatternId: null,
          notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: true,
        }],
        tripBars: [], scheduledHours: 12, daysWithoutCover: 6,
      },
    ],
    exceptions: [],
  }
}

const leaveRequests = [
  {
    id: 'leave-0001', userId: 's-0003', userFullName: "Jack O'Sullivan",
    leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18',
    status: 'Pending', reason: 'Family trip interstate.',
    requestedByUserId: 's-0003', requestedAt: '2026-09-01T09:00:00Z',
    decidedByUserId: null, decidedAt: null, decisionNote: null,
  },
  {
    id: 'leave-0002', userId: 's-0004', userFullName: 'Mei Zhang',
    leaveType: 'Sick', startDate: '2026-09-08', endDate: '2026-09-09',
    status: 'Approved', reason: null,
    requestedByUserId: 's-0004', requestedAt: '2026-09-07T07:30:00Z',
    decidedByUserId: 's-0001', decidedAt: '2026-09-07T08:00:00Z', decisionNote: null,
  },
  {
    id: 'leave-0003', userId: 's-0002', userFullName: 'Priya Nadarajah',
    leaveType: 'Personal', startDate: '2026-09-21', endDate: '2026-09-21',
    status: 'Declined', reason: 'Medical appointment.',
    requestedByUserId: 's-0002', requestedAt: '2026-09-03T10:15:00Z',
    decidedByUserId: 's-0001', decidedAt: '2026-09-04T09:00:00Z',
    decisionNote: 'Already short-staffed that day.',
  },
]

const recurringUnavailabilities = [
  {
    id: 'rule-0001', userId: 's-0003', userFullName: "Jack O'Sullivan",
    dayOfWeek: 'Monday', startTime: '09:00:00', endTime: '12:00:00',
    effectiveFrom: '2026-09-07', effectiveTo: null, notes: 'Regular medical appointment.',
    status: 'Pending', requestedByUserId: 's-0003', requestedAt: '2026-09-01T09:05:00Z',
    decidedByUserId: null, decidedAt: null, decisionNote: null,
  },
  {
    id: 'rule-0002', userId: 's-0005', userFullName: 'Tom Beattie',
    dayOfWeek: 'Friday', startTime: '15:00:00', endTime: '17:00:00',
    effectiveFrom: '2026-08-01', effectiveTo: null, notes: null,
    status: 'Approved', requestedByUserId: 's-0005', requestedAt: '2026-07-20T09:00:00Z',
    decidedByUserId: 's-0001', decidedAt: '2026-07-21T09:00:00Z', decisionNote: null,
  },
]

// Legacy StaffAvailability records (StaffAvailabilityDto) — offline preview fixtures for the
// LeaveApprovalsPage 'legacy' row kind. Distinct from the leave/recurring-unavailability fixtures
// above: these predate the leave/unavailability feature and never carry a status — the page shows
// them for the All/Approved status filters only.
const staffAvailabilityRecords = [
  {
    id: 'av-0001', staffId: 's-0005', startDateTime: '2026-08-10T00:00:00', endDateTime: '2026-08-21T23:59:59',
    availabilityType: 'Unavailable', isRecurring: false, recurrenceNotes: null, notes: 'Annual leave — overseas.',
  },
  {
    id: 'av-0002', staffId: 's-0003', startDateTime: '2026-09-15T00:00:00', endDateTime: '2026-09-15T23:59:59',
    availabilityType: 'Training', isRecurring: false, recurrenceNotes: null, notes: 'First aid refresher.',
  },
]

/** Returns a copy of a leave/unavailability fixture row with a decision applied — mirrors what
 * the real approve/decline/cancel endpoints hand back, without mutating the fixture array (this
 * file is stateless across requests, same as every other GET find-or-fallback route below). */
function withDecision(row, status, decisionNote) {
  return {
    ...row,
    status,
    decisionNote: decisionNote !== undefined ? decisionNote : row.decisionNote,
    decidedByUserId: 's-0001',
    decidedAt: new Date().toISOString(),
  }
}

// NDIS Claims (TripClaimListDto / TripClaimDetailDto) — shift-completion design spec §1/§2,
// PR 3. Kind discriminates a Trip claim (generated from a TripInstance's confirmed bookings)
// from a Shift claim (generated from a participant's completed, unclaimed Shifts). The real
// ClaimGenerationService never sets ParticipantId on a Trip-kind claim, so
// GET /participants/:id/claims only ever surfaces Shift-kind rows for a participant — mirrored
// here (participants/:id/claims below filters on participantId) rather than "fixed" to also
// return Trip claims, since that's the actual backend behaviour the frontend renders against.
const claims = [
  {
    id: 'claim-0001', kind: 'Trip', tripInstanceId: 't-0004', tripName: 'Byron Bay Winter Weekender',
    status: 'Submitted', claimReference: 'TC-43000357-20260601', totalAmount: 960,
    createdAt: '2026-06-01T09:00:00Z', submittedDate: '2026-06-02T09:00:00Z',
  },
  {
    id: 'claim-0002', kind: 'Shift', participantId: 'p-0001', periodFrom: '2026-07-27', periodTo: '2026-08-09',
    tripName: '', status: 'Draft', claimReference: 'TC-43015828-20260810', totalAmount: 640,
    createdAt: '2026-08-10T08:00:00Z',
  },
]

const claimLineItemsByClaimId = {
  'claim-0001': [
    {
      id: 'cli-0001', tripClaimId: 'claim-0001', participantBookingId: 'b-0004', participantId: 'p-0003',
      participantName: 'Marcus Tran', ndisNumber: '43•••••57', planType: 'SelfManaged',
      supportItemCode: '01_002_0117_1_1', dayType: 'Weekday',
      supportsDeliveredFrom: '2026-05-30', supportsDeliveredTo: '2026-06-02',
      hours: 32, unitPrice: 30, totalAmount: 960, gstCode: 'GST', claimType: 'Standard',
      cancellationReason: null, participantApproved: true, status: 'Submitted',
      rejectionReason: null, paidAmount: null,
    },
  ],
  'claim-0002': [
    {
      id: 'cli-0002', tripClaimId: 'claim-0002', shiftId: 'sh-0001', participantId: 'p-0001',
      participantName: 'Liam Okafor', ndisNumber: '43•••••89', planType: 'PlanManaged',
      supportItemCode: '01_002_0117_1_1', dayType: 'Weekday',
      supportsDeliveredFrom: '2026-07-28', supportsDeliveredTo: '2026-07-28',
      hours: 8, unitPrice: 40, totalAmount: 320, gstCode: 'GST', claimType: 'Standard',
      cancellationReason: null, participantApproved: false, status: 'Draft',
      rejectionReason: null, paidAmount: null,
    },
    {
      id: 'cli-0003', tripClaimId: 'claim-0002', shiftId: 'sh-0002', participantId: 'p-0001',
      participantName: 'Liam Okafor', ndisNumber: '43•••••89', planType: 'PlanManaged',
      supportItemCode: '01_002_0117_1_1', dayType: 'Weekday',
      supportsDeliveredFrom: '2026-08-04', supportsDeliveredTo: '2026-08-04',
      hours: 8, unitPrice: 40, totalAmount: 320, gstCode: 'GST', claimType: 'Standard',
      cancellationReason: null, participantApproved: false, status: 'Draft',
      rejectionReason: null, paidAmount: null,
    },
  ],
}

function claimDetail(c) {
  return {
    ...c,
    totalApprovedAmount: 0, authorisedByStaffId: null, authorisedByStaffName: null,
    paidDate: null, notes: null,
    lineItems: claimLineItemsByClaimId[c.id] || [],
  }
}

/** ShiftClaimPreviewResponseDto for POST participants/:id/claims/from-shifts/preview — stateless
 * like every other POST here (see withDecision above): always the same plausible preview
 * regardless of the from/to body, rather than actually filtering portalShiftBase by date range.
 * The real endpoint 400s with a message when no completed, unclaimed shifts fall in range; this
 * mock never does, since ClaimsTab.tsx's own 400-message-inline behaviour is covered by its
 * vitest suite (mock-api isn't in that test's path), not by manual/dev-preview testing. */
function shiftClaimPreview() {
  return {
    totalAmount: 320,
    lineItems: [
      {
        shiftId: 'sh-mock-1', serviceDate: '2026-08-10', dayTypeLabel: 'Weekday', dayType: 'Weekday',
        supportItemCode: '01_002_0117_1_1', hours: 8, unitPrice: 40, totalAmount: 320,
      },
    ],
  }
}

// Notifications (docs/specs/2026-09-08-notifications-design.md §6) — preference grid for
// Settings → Notifications (every signed-in user) and the outbox for Settings → Failed Sends
// (canManageNotifications). Event type / channel / status names copied verbatim from the
// backend enums (NotificationEntities.cs) — same "append-only, never renumber" list.
const NOTIFICATION_EVENT_TYPES = [
  'LeaveRequestSubmitted', 'LeaveRequestDecided', 'ShiftAssigned',
  'ShiftCompletionPendingReview', 'ShiftCompletionReturned', 'WitnessRequested',
  'CaregiverSubmissionReceived', 'IncidentReported', 'ServiceAgreementSent',
  'ServiceAgreementSigned', 'IntegrationDegraded',
]

// GET/PUT notifications/preferences fixture — every event x channel, Email defaulting ON per
// the documented default (§1), one row (IncidentReported/Email) turned off for preview purposes
// so the grid doesn't render as an undifferentiated wall of checked boxes.
function notificationPreferenceGrid() {
  return {
    rows: NOTIFICATION_EVENT_TYPES.flatMap((eventType) => ([
      { eventType, channel: 'Email', enabled: eventType !== 'IncidentReported' },
      { eventType, channel: 'Sms', enabled: true },
    ])),
  }
}

// GET admin/notifications fixture — the query string (?status=&from=&to=) isn't read here, same
// caveat as leave/staff-availability above: always returns the full fixture list, any filtering
// left to the frontend.
const notificationOutbox = [
  {
    id: 'notif-0001', eventType: 'LeaveRequestSubmitted', entityType: 'LeaveRequest', entityId: 'leave-0001',
    recipientUserId: 's-0001', recipientName: 'Callum Radford', status: 'Failed', attempts: 5,
    nextAttemptAt: '2026-09-13T04:00:00Z', lastError: 'SmtpCommandException: 421 Service not available',
    createdAt: '2026-09-12T09:00:05Z',
  },
  {
    id: 'notif-0002', eventType: 'WitnessRequested', entityType: 'MedicationAdministration', entityId: 'ma-0002',
    recipientUserId: 's-0002', recipientName: 'Priya Nadarajah', status: 'Sent', attempts: 1,
    nextAttemptAt: '2026-09-12T10:05:00Z', createdAt: '2026-09-12T10:00:00Z', sentAt: '2026-09-12T10:00:12Z',
  },
  {
    id: 'notif-0003', eventType: 'IncidentReported', entityType: 'Incident', entityId: 'inc-0001',
    recipientUserId: 's-0004', recipientName: 'Mei Zhang', status: 'Skipped', attempts: 0,
    nextAttemptAt: '2026-09-11T15:00:00Z', lastError: 'User preference disabled', createdAt: '2026-09-11T15:00:00Z',
  },
  {
    id: 'notif-0004', eventType: 'ShiftAssigned', entityType: 'Shift', entityId: 'sh-0001',
    recipientUserId: 's-0003', recipientName: "Jack O'Sullivan", status: 'Pending', attempts: 0,
    nextAttemptAt: '2026-09-13T09:00:00Z', createdAt: '2026-09-13T08:55:00Z',
  },
]

/** Stateless like every other POST here: resets the fixture row's shape without mutating
 * `notificationOutbox`, so a follow-up GET admin/notifications still shows the original row. */
function retriedNotification(id) {
  const row = notificationOutbox.find((n) => n.id === id) || notificationOutbox[0]
  return { ...row, status: 'Pending', attempts: 0, nextAttemptAt: new Date().toISOString(), lastError: undefined }
}

// Connection map item 12 (staff hub) — staffId linkage for the three portalShiftBase fixture
// shifts, derived from shiftCompletions.submittedByUserId where a completion exists (shift-0001/
// 0002) and from the shift-0003 note's authorUserId otherwise (shift-0003 has no completion yet —
// see shiftNotesByShiftId's note-0004, authored by Tom Beattie).
const PORTAL_SHIFT_STAFF_ID = { 'shift-0001': 's-0003', 'shift-0002': 's-0004', 'shift-0003': 's-0005' }

/** Connection map item 12 — one combined list of every fixture shift (rosterBoard's
 * participant-grouped shifts plus the three portalShiftBase shifts), each carrying its own
 * staffId/staffName/participantId/participantName, for GET staff/:id/overview and
 * GET participants/:id/rostering to filter without maintaining a third hand-written shift
 * fixture. Stateless like every other derived fixture in this file — rebuilt per call. */
function allFixtureShifts() {
  const board = rosterBoard()
  const boardShifts = board.participantRows.flatMap((row) => row.shifts)
  const portalShifts = Object.values(portalShiftBase).map((base) => {
    const participant = participants.find((p) => p.id === base.participantId)
    const staffId = PORTAL_SHIFT_STAFF_ID[base.id] || null
    const staffMember = staffId ? staff.find((s) => s.id === staffId) : null
    return {
      id: base.id, participantId: base.participantId,
      participantName: participant ? participant.fullName : 'Unknown participant',
      staffId, staffName: staffMember ? staffMember.fullName : null,
      serviceDate: base.serviceDate, startTime: base.startTime, endTime: base.endTime,
      endsNextDay: base.endsNextDay, status: base.status,
      // Only rosterBoard's own shifts ever carry a real assigneeOnApprovedLeave (board-shift-0002)
      // — the portal fixtures below have no leave-overlap scenario of their own.
      assigneeOnApprovedLeave: false,
    }
  })
  return [...boardShifts, ...portalShifts]
}

/** Connection map item 12 — shared by GET staff/:id/overview's recentIncidents and
 * GET incidents?involvedUserId=: newest-first incidents where `id` is the INVOLVED (not
 * reporting) staff member, per incidentDetailExtras.involvedStaffId — IncidentListDto itself
 * never carries this field, only IncidentDetailDto does, same as the real contract. */
function incidentsInvolvingStaff(id) {
  return incidents
    .filter((i) => (incidentDetailExtras[i.id] || {}).involvedStaffId === id)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Connection map item 12 — GET staff/:id/overview's recentCompletions: completionQueueItems rows
 * whose underlying shiftCompletions.submittedByUserId matches this staff member, newest first. */
function completionsForStaff(id) {
  return completionQueueItems
    .filter((item) => {
      const completion = shiftCompletions.find((c) => c.shiftId === item.shiftId)
      return completion && completion.submittedByUserId === id
    })
    .slice()
    .sort((a, b) => (b.serviceDate || '').localeCompare(a.serviceDate || ''))
}

/** Connection map item 12 — GET staff/:id/overview's `availability`: every Leave/
 * RecurringUnavailability/legacy StaffAvailability row for this staff member, combined into the
 * unified ScheduleAvailabilityItemDto shape AvailabilityList.tsx already renders — generalises
 * scheduleOverview.staff[].availability's own single hard-coded row to any staffId across all
 * three source fixtures. */
function scheduleAvailabilityForStaff(id) {
  const leave = leaveRequests
    .filter((l) => l.userId === id)
    .map((l) => ({
      id: l.id, kind: 'Leave', status: l.status, leaveType: l.leaveType, availabilityType: null,
      startDate: l.startDate, endDate: l.endDate, dayOfWeek: null, startTime: null, endTime: null,
      notes: l.reason,
    }))
  const rules = recurringUnavailabilities
    .filter((r) => r.userId === id)
    .map((r) => ({
      id: r.id, kind: 'RecurringRule', status: r.status, leaveType: null, availabilityType: null,
      startDate: r.effectiveFrom, endDate: r.effectiveTo, dayOfWeek: r.dayOfWeek,
      startTime: r.startTime, endTime: r.endTime, notes: r.notes,
    }))
  const legacy = staffAvailabilityRecords
    .filter((a) => a.staffId === id)
    .map((a) => ({
      id: a.id, kind: 'Legacy', status: null, leaveType: null, availabilityType: a.availabilityType,
      startDate: a.startDateTime.slice(0, 10), endDate: a.endDateTime.slice(0, 10),
      dayOfWeek: null, startTime: null, endTime: null, notes: a.notes,
    }))
  return [...leave, ...rules, ...legacy]
}

// ── Routing ──────────────────────────────────────────────────

// Routes checked in order. :id captures a path segment.
const routes = [
  ['dashboard/summary', () => dashboardSummary],

  // participants (paged list)
  ['participants', () => paged(participants)],
  ['participants/:id/bookings', (id) => bookings.filter((b) => b.participantId === id)],
  // NDIS Claims (shift-completion design spec §2/§4, PR 3) — see the `claims` fixture's own
  // comment for why this only ever returns Shift-kind rows, mirroring the real
  // ClaimsController.GetClaimsForParticipant/ClaimGenerationService behaviour. The `kind` query
  // string isn't read here, same "GET routes don't filter by query string" caveat as
  // leave/staff-availability above — participant-detail/ClaimsTab.tsx always wants both kinds
  // anyway, so this doesn't affect its own rendering.
  ['participants/:id/claims', (id) => claims.filter((c) => c.participantId === id)],
  // Connection map item 12 — the participant hub's Rostering tab. assignedStaff.compatibility is
  // a plausible-looking mock value (first assigned staff member "Preferred", the rest "Allowed")
  // rather than a real preference computation — this mock has no participant/staff compatibility
  // matrix fixture to join against.
  ['participants/:id/rostering', (id) => {
    const shifts = allFixtureShifts().filter((sh) => sh.participantId === id)
    const byStaff = new Map()
    for (const sh of shifts) {
      if (!sh.staffId) continue
      const existing = byStaff.get(sh.staffId) || { staffId: sh.staffId, staffName: sh.staffName, shiftCount: 0 }
      existing.shiftCount += 1
      byStaff.set(sh.staffId, existing)
    }
    const assignedStaff = Array.from(byStaff.values()).map((row, i) => ({
      ...row,
      compatibility: i === 0 ? 'Preferred' : 'Allowed',
    }))
    return {
      upcomingShifts: shifts.map((sh) => {
        const item = {
          shiftId: sh.id, serviceDate: sh.serviceDate, startTime: sh.startTime, endTime: sh.endTime,
          endsNextDay: sh.endsNextDay, status: sh.status, assigneeOnApprovedLeave: !!sh.assigneeOnApprovedLeave,
        }
        // staffId/staffName omitted (not sent as null) for an unfilled shift, matching the real
        // "field omitted from JSON when absent" contract every other optional field here follows.
        if (sh.staffId) { item.staffId = sh.staffId; item.staffName = sh.staffName }
        return item
      }),
      assignedStaff,
    }
  }],
  ['participants/:id/support-profile', (id) => ({
    id: `sp-${id}`, participantId: id,
    communicationNotes: 'Plain language, allow extra processing time.',
    behaviourSupportNotes: id === 'p-0004' ? 'BSP dated Mar 2026 — see restrictive practice details.' : null,
    restrictivePracticeDetails: id === 'p-0004' ? 'Environmental: locked pantry overnight (authorised).' : null,
    manualHandlingNotes: null,
    medicationHealthSummary: null,
    emergencyConsiderations: 'Emergency contact card kept in trip pack.',
    travelSpecificNotes: null,
    reviewDate: '2026-11-01',
  })],
  ['participants/:id', (id) => {
    const p = participants.find((x) => x.id === id)
    return p ? participantDetail(p) : participantDetail(participants[0])
  }],

  // trips (paged list)
  ['trips', () => paged(trips)],
  ['trips/:id/bookings', (id) => bookings.filter((b) => b.tripInstanceId === id)],
  ['trips/:id/tasks', (id) => tasks.filter((t) => t.tripInstanceId === id)],
  ['trips/:id/staff', (id) => tripStaffAssignments[id] || []],
  ['trips/:id/vehicles', (id) => tripVehicleAssignments[id] || []],
  ['trips/:id/accommodation', () => []],
  ['trips/:id/documents', () => []],
  ['trips/:id/schedule', () => []],
  ['trips/:id/claims', () => []],
  ['claims/:id', (id) => claimDetail(claims.find((c) => c.id === id) || claims[0])],
  ['trips/:id/itinerary', () => null],
  ['trips/:id', (id) => {
    const t = trips.find((x) => x.id === id)
    return t ? tripDetail(t) : tripDetail(trips[0])
  }],

  // staff (plain array)
  ['staff/me/dashboard', () => myDashboard],
  ['staff/available', () => staff.filter((s) => s.isActive && s.id !== 's-0005')],
  ['staff', () => staff],
  ['staff/:id/availability', (id) =>
    id === 's-0005'
      ? [{
          id: 'av-0001', staffId: 's-0005',
          startDateTime: '2026-08-10T00:00:00Z', endDateTime: '2026-08-21T23:59:00Z',
          availabilityType: 'Leave', isRecurring: false, recurrenceNotes: null,
          notes: 'Annual leave — overseas.',
        }]
      : []],
  ['staff/:id', (id) => staff.find((x) => x.id === id) || staff[0]],
  // Connection map item 12 — the staff hub's single data source (StaffDetailPage.tsx). Every
  // sub-collection is derived from existing fixtures (see the helpers above) rather than a fourth
  // hand-maintained "staff overview" fixture.
  ['staff/:id/overview', (id) => {
    const s = staff.find((x) => x.id === id) || staff[0]
    const shifts = allFixtureShifts().filter((sh) => sh.staffId === s.id)
    const tripAssignments = Object.values(tripStaffAssignments).flat().filter((a) => a.staffId === s.id)
    return {
      staff: s,
      availability: scheduleAvailabilityForStaff(s.id),
      upcomingShifts: shifts.map((sh) => ({
        shiftId: sh.id, serviceDate: sh.serviceDate, startTime: sh.startTime, endTime: sh.endTime,
        endsNextDay: sh.endsNextDay, participantId: sh.participantId, participantName: sh.participantName,
        status: sh.status,
      })),
      upcomingTripAssignments: tripAssignments.map((a) => ({
        assignmentId: a.id, tripInstanceId: a.tripInstanceId, tripName: a.tripName,
        startDate: a.assignmentStart, endDate: a.assignmentEnd,
      })),
      recentIncidents: incidentsInvolvingStaff(s.id).slice(0, 10),
      recentCompletions: completionsForStaff(s.id).slice(0, 10),
    }
  }],

  // vehicles
  ['vehicles', () => vehicles],
  ['vehicles/:id', (id) => {
    const v = vehicles.find((x) => x.id === id) || vehicles[0]
    return { ...v, ...(vehicleDetailExtras[v.id] || { rampHoistDetails: null, driverRequirements: null, notes: null }) }
  }],

  // tasks
  ['tasks', () => tasks],

  // incidents
  ['incidents/overdue-qsc', () => incidents.filter((i) => i.isOverdue24h)],
  ['incidents/trip/:id', (id) => incidents.filter((i) => i.tripInstanceId === id)],
  // Connection map item 12 — the one GET route here that DOES read the query string (see the GET
  // dispatch loop below, which now passes url.searchParams as this handler's only argument): the
  // staff hub's Incidents tab needs GET /incidents?involvedUserId= to actually filter, unlike
  // every other "GET routes don't filter by query string" route noted elsewhere in this file.
  ['incidents', (searchParams) => {
    const involvedUserId = searchParams.get('involvedUserId')
    return involvedUserId ? incidentsInvolvingStaff(involvedUserId) : incidents
  }],
  ['incidents/:id', (id) => {
    const i = incidents.find((x) => x.id === id) || incidents[0]
    return { ...i, ...(incidentDetailExtras[i.id] || {}) }
  }],

  // medications / MAR — GET /medications/mar?date=&participantId= doesn't filter by the query
  // string here, same caveat as /leave and /staff-availability above: always returns the same
  // fixed day's entries regardless of what's requested.
  ['medications/mar', () => marDay],
  ['participants/:id/administrations', (id) => medicationAdministrations.filter((a) => a.participantId === id)],

  // bookings
  ['bookings', () => bookings],
  ['bookings/:id', (id) => {
    const b = bookings.find((x) => x.id === id) || bookings[0]
    return bookingDetail(b)
  }],

  // accommodation
  ['accommodation', () => accommodation],
  ['accommodation/:id', (id) => {
    const a = accommodation.find((x) => x.id === id) || accommodation[0]
    return {
      ...a,
      ...(accommodationDetailExtras[a.id] || {
        providerOwner: null, contactPerson: null, email: null, phone: null, mobile: null,
        website: null, accessibilityNotes: null, beddingConfiguration: null,
        hoistBathroomNotes: null, generalNotes: null,
      }),
    }
  }],

  // schedule / settings / public holidays
  ['schedule', () => scheduleOverview],
  ['settings', () => appSettings],
  ['public-holidays', () => publicHolidays],

  // leave + recurring unavailability — GET /leave and /leave/unavailability don't filter by the
  // `status`/`userId` query string here. The GET dispatch loop DOES now pass url.searchParams as
  // every handler's trailing argument (added for GET /incidents?involvedUserId= — see the
  // `incidents` route above), but these two simply don't declare/read it, same net effect as
  // before. Returns the full fixture list; the frontend pages that read it don't rely on the mock
  // filtering (LeaveApprovalsPage/PortalLeavePage render off whatever the hook returns either way).
  ['leave', () => leaveRequests],
  ['leave/unavailability', () => recurringUnavailabilities],

  // Roster board (item 5/2 — assigneeOnApprovedLeave) — see rosterBoard()'s own comment.
  ['rostering/board', () => rosterBoard()],

  // legacy StaffAvailability list — GET /staff-availability?userId=&from=&to= (query string isn't
  // read here, same caveat as the leave/unavailability routes above).
  ['staff-availability', () => staffAvailabilityRecords],

  ['portal/leave', () => ({
    leave: leaveRequests.filter((r) => r.userId === CURRENT_STAFF_ID),
    unavailability: recurringUnavailabilities.filter((r) => r.userId === CURRENT_STAFF_ID),
  })],

  // Shift notes (NOTES-01/02) — same underlying fixtures for the portal's own-shift view and
  // the roster slide-over's read-only coordinator view.
  ['portal/shifts/:id/notes', (id) => shiftNotesByShiftId[id] || []],
  ['rostering/shifts/:id/notes', (id) => shiftNotesByShiftId[id] || []],

  // Flagged-notes queue (connection map item 4) — GET /rostering/flagged-notes?withoutIncident=&from=&to=
  // (query string isn't read here, same caveat as leave/staff-availability above; the fixture
  // is already withoutIncident-shaped enough for preview purposes).
  ['rostering/flagged-notes', () => flaggedShiftNotes],

  // Shift completion (design spec §2/§4) — portal detail (PortalShiftDetailPage's Start/Finish
  // card) and the rostering review queue/detail (CompletionReviewPage). Same "query string isn't
  // read here" caveat as leave/staff-availability above: GetCompletions' status/from/to/page/
  // pageSize aren't applied — paged() below just returns every fixture row as one full page.
  ['portal/shifts/:id', (id) => buildPortalShiftDetail(id)],
  ['rostering/completions', () => paged(completionQueueItems)],
  ['rostering/shifts/:id/completion', (id) => shiftCompletions.find((c) => c.shiftId === id) || shiftCompletions[0]],

  // Notifications (design spec §6) — GET admin/notifications joins this plain table (query
  // string ignored, same caveat noted on notificationOutbox above); GET notifications/preferences
  // is the self-service grid.
  ['notifications/preferences', () => notificationPreferenceGrid()],
  ['admin/notifications', () => notificationOutbox],
]

// POST routes needing a specific response shape rather than the generic echo-body-back fallback
// (see the POST handler below) — status-transition endpoints that must return the fixture row
// with its new status/decision fields, plus the one pure-preview endpoint (staff-assignments/check)
// that must return an array of findings, not an echoed object.
const postRoutes = [
  ['staff-assignments/check', () => []],

  ['leave/:id/approve', (id) => ({
    leave: withDecision(leaveRequests.find((r) => r.id === id) || leaveRequests[0], 'Approved', null),
    overlaps: [sampleOverlapFinding],
    overlapShifts: [sampleOverlapShift],
  })],
  ['leave/:id/decline', (id, body) =>
    withDecision(leaveRequests.find((r) => r.id === id) || leaveRequests[0], 'Declined', body?.decisionNote ?? null)],
  ['leave/:id/cancel', (id) =>
    withDecision(leaveRequests.find((r) => r.id === id) || leaveRequests[0], 'Cancelled', null)],
  ['portal/leave/:id/cancel', (id) =>
    withDecision(leaveRequests.find((r) => r.id === id) || leaveRequests[0], 'Cancelled', null)],

  ['leave/unavailability/:id/approve', (id) => ({
    unavailability: withDecision(recurringUnavailabilities.find((r) => r.id === id) || recurringUnavailabilities[0], 'Approved', null),
    overlaps: [sampleOverlapFinding],
    overlapShifts: [sampleOverlapShift],
  })],
  ['leave/unavailability/:id/decline', (id, body) =>
    withDecision(recurringUnavailabilities.find((r) => r.id === id) || recurringUnavailabilities[0], 'Declined', body?.decisionNote ?? null)],
  ['leave/unavailability/:id/cancel', (id) =>
    withDecision(recurringUnavailabilities.find((r) => r.id === id) || recurringUnavailabilities[0], 'Cancelled', null)],
  ['portal/unavailability/:id/cancel', (id) =>
    withDecision(recurringUnavailabilities.find((r) => r.id === id) || recurringUnavailabilities[0], 'Cancelled', null)],

  // Shift completion (design spec §2/§3) — Start/Finish and the rostering Approve/Return/
  // approve-batch actions. Stateless like every other POST here: each returns a plausible
  // post-action shape without persisting it back into portalShiftBase/shiftCompletions, so a
  // second GET for the same shift still reflects the original fixture, not this call's result.
  ['portal/shifts/:id/start', (id, body) => {
    const now = new Date().toISOString()
    const completion = {
      id: `sc-mock-${id}`, shiftId: id, actualStart: now, actualEnd: null,
      timeZoneId: 'Australia/Brisbane', geolocationDeclined: !!body?.geolocationDeclined, startWasManual: false,
      submittedByUserId: CURRENT_STAFF_ID, submittedByName: "Jack O'Sullivan",
      startedAt: now, submittedAt: null,
      reviewedByUserId: null, reviewedByName: null, reviewedAt: null, reviewOutcome: null, returnReason: null,
      varianceMinutesStart: 0, varianceMinutesEnd: 0, isOutlierVariance: false, varianceReviewMinutes: 15,
      returnCount: 0, incidents: [],
    }
    return buildPortalShiftDetail(id, { status: 'InProgress', completion })
  }],
  ['portal/shifts/:id/finish', (id, body) => {
    const now = new Date().toISOString()
    const completion = {
      id: `sc-mock-${id}`, shiftId: id, actualStart: body?.actualStart ?? now, actualEnd: now,
      timeZoneId: 'Australia/Brisbane', geolocationDeclined: !!body?.geolocationDeclined, startWasManual: !!body?.actualStart,
      submittedByUserId: CURRENT_STAFF_ID, submittedByName: "Jack O'Sullivan",
      startedAt: now, submittedAt: now,
      reviewedByUserId: null, reviewedByName: null, reviewedAt: null, reviewOutcome: null, returnReason: null,
      varianceMinutesStart: 3, varianceMinutesEnd: -2, isOutlierVariance: false, varianceReviewMinutes: 15,
      returnCount: 0, incidents: [],
    }
    return buildPortalShiftDetail(id, { status: 'PendingReview', completion })
  }],
  ['rostering/shifts/:id/completion/approve', (id) => {
    const c = shiftCompletions.find((x) => x.shiftId === id) || shiftCompletions[0]
    return { ...c, reviewedByUserId: 's-0001', reviewedByName: 'Callum Radford', reviewedAt: new Date().toISOString(), reviewOutcome: 'Approved' }
  }],
  ['rostering/shifts/:id/completion/return', (id, body) => {
    const c = shiftCompletions.find((x) => x.shiftId === id) || shiftCompletions[0]
    return {
      ...c, reviewedByUserId: 's-0001', reviewedByName: 'Callum Radford', reviewedAt: new Date().toISOString(),
      reviewOutcome: 'Returned', returnReason: body?.reason ?? '', returnCount: c.returnCount + 1,
    }
  }],
  ['rostering/completions/approve-batch', (body) => {
    const ids = Array.isArray(body?.shiftIds) ? body.shiftIds : []
    return ids.map((shiftId) => ({ shiftId, approved: true, code: null, message: null }))
  }],

  // Claim-from-shifts (shift-completion design spec §2/§3, PR 3) — see shiftClaimPreview's own
  // comment for why this mock never 400s. Stateless like every other POST here: generating
  // doesn't add the new claim to the `claims` fixture, so a follow-up GET
  // /participants/:id/claims still returns the same fixed list.
  ['participants/:id/claims/from-shifts/preview', () => shiftClaimPreview()],
  ['participants/:id/claims/from-shifts', (id, body) => ({
    id: 'claim-mock-0001', kind: 'Shift', participantId: id,
    periodFrom: body?.from ?? '2026-08-01', periodTo: body?.to ?? '2026-08-14',
    tripName: '', status: 'Draft', claimReference: `TC-MOCK-${id}`,
    totalAmount: 320, createdAt: new Date().toISOString(),
  })],

  // Notifications (design spec §2/§6) — stateless like every other POST here: retry doesn't
  // mutate notificationOutbox, so a follow-up GET admin/notifications still shows the original
  // Failed row. test-email always reports success, mirroring the real endpoint's 200-either-way
  // contract without needing an actual SMTP config to demo against.
  ['admin/notifications/:id/retry', (id) => retriedNotification(id)],
  ['admin/notifications/test-email', () => ({ sent: true, error: undefined })],
]

// PUT routes needing a specific response shape rather than the generic echo-body-back fallback
// (see the PUT/PATCH/DELETE handler below) — the two coordinator-edit endpoints, each returning
// the same { leave|unavailability, overlaps } shape their approve counterpart does (overlaps
// always empty here — this mock has no roster data to check for a conflict against).
// PUT /staff-availability/:id deliberately has no entry here — it falls through to the generic
// echo fallback, per this task's "existing PUT /staff-availability/{id} unchanged" note.
const putRoutes = [
  ['leave/:id', (id, body) => ({
    leave: { ...(leaveRequests.find((r) => r.id === id) || leaveRequests[0]), ...body },
    overlaps: [sampleOverlapFinding],
    overlapShifts: [sampleOverlapShift],
  })],
  ['leave/unavailability/:id', (id, body) => ({
    unavailability: { ...(recurringUnavailabilities.find((r) => r.id === id) || recurringUnavailabilities[0]), ...body },
    overlaps: [sampleOverlapFinding],
    overlapShifts: [sampleOverlapShift],
  })],

  // PUT notifications/preferences — echoes the base grid with the submitted rows' `enabled`
  // values merged in (stateless: doesn't mutate any fixture, so a follow-up GET still returns
  // the original defaults).
  ['notifications/preferences', (body) => {
    const updates = Array.isArray(body) ? body : []
    const grid = notificationPreferenceGrid()
    return {
      rows: grid.rows.map((row) => {
        const match = updates.find((u) => u.eventType === row.eventType && u.channel === row.channel)
        return match ? { ...row, enabled: !!match.enabled } : row
      }),
    }
  }],
]

function matchRoute(pattern, segments) {
  const patSegs = pattern.split('/')
  if (patSegs.length !== segments.length) return null
  const params = []
  for (let i = 0; i < patSegs.length; i++) {
    if (patSegs[i] === ':id') params.push(decodeURIComponent(segments[i]))
    else if (patSegs[i] !== segments[i]) return null
  }
  return params
}

// ── Server ───────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-Requested-With, X-View-As-Tenant, X-View-As-User',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' })
  res.end(json)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  console.log(`${new Date().toISOString()}  ${req.method}  ${path}${url.search}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  if (!path.startsWith(BASE + '/') && path !== BASE) {
    send(res, 404, { success: false, data: null, message: 'Not found', errors: ['Route not under ' + BASE] })
    return
  }

  const rel = path.slice(BASE.length).replace(/^\/+/, '') // e.g. "participants/p-0001"
  const segments = rel === '' ? [] : rel.split('/')

  if (req.method === 'GET') {
    for (const [pattern, handler] of routes) {
      const params = matchRoute(pattern, segments)
      if (params) {
        // Connection map item 12 — url.searchParams is now always passed as the trailing
        // argument (every other route here ignores it, same as before; only the `incidents`
        // handler above declares it) so GET /incidents?involvedUserId= can actually filter,
        // without touching every other route's signature.
        send(res, 200, ok(handler(...params, url.searchParams)))
        return
      }
    }
    // Unknown GET → success envelope with empty array
    send(res, 200, ok([]))
    return
  }

  // POST / PUT / PATCH / DELETE — read body, echo back with an id
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    let body = {}
    if (raw) {
      try { body = JSON.parse(raw) } catch { body = {} }
    }

    // Status-transition + pure-preview POST routes that need a specific response shape (see
    // postRoutes above) — checked before the generic fallback below, same idea as the
    // auth/exchange special-case that already existed here.
    if (req.method === 'POST') {
      for (const [pattern, handler] of postRoutes) {
        const params = matchRoute(pattern, segments)
        if (params) {
          send(res, 200, ok(handler(...params, body)))
          return
        }
      }
    }

    // Status-transition-shaped PUT routes (see putRoutes above) — checked before the generic
    // fallback below, same idea as the postRoutes check above.
    if (req.method === 'PUT') {
      for (const [pattern, handler] of putRoutes) {
        const params = matchRoute(pattern, segments)
        if (params) {
          send(res, 200, ok(handler(...params, body)))
          return
        }
      }
    }

    // Special-case auth exchange so login flows get a plausible AuthResponseDto
    if (req.method === 'POST' && rel === 'auth/exchange') {
      send(res, 200, ok({
        token: 'mock-jwt-token',
        expiresAt: '2026-08-03T00:00:00Z',
        username: 'demo@example.com.au',
        fullName: 'Demo Coordinator',
        role: 'Admin',
        tenantName: 'Sample Support Co',
        tenantId: 'tenant-0001',
      }))
      return
    }

    if (req.method === 'DELETE') {
      send(res, 200, ok(true))
      return
    }

    const idFromPath = segments.length > 1 ? segments[segments.length - 1] : null
    const echo = {
      id: (body && body.id) || idFromPath || `mock-${Date.now()}`,
      ...body,
    }
    send(res, 200, ok(echo))
  })
})

server.listen(PORT, () => {
  console.log(`ODIP mock API listening on http://localhost:${PORT}${BASE}`)
  console.log('CORS origin: http://localhost:5173')
})
