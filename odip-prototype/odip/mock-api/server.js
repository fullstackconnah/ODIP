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
    shiftReturnCount: 0, incidents: [],
  },
  {
    id: 'sc-0002', shiftId: 'shift-0002', actualStart: '2026-09-10T19:32:00Z', actualEnd: '2026-09-10T23:50:00Z',
    // A manual start (the worker never pressed Start and supplied the time at Finish): that path skips the dose checklist, which is why this
    // fixture also has a dose with no outcome - the queue shows both.
    timeZoneId: 'Australia/Brisbane', geolocationDeclined: false, startWasManual: true,
    submittedByUserId: 's-0004', submittedByName: 'Mei Zhang',
    startedAt: '2026-09-10T19:32:00Z', submittedAt: '2026-09-10T23:50:00Z',
    reviewedByUserId: null, reviewedByName: null, reviewedAt: null,
    reviewOutcome: null, returnReason: null,
    varianceMinutesStart: 32, varianceMinutesEnd: -10, isOutlierVariance: true, varianceReviewMinutes: 15,
    shiftReturnCount: 0,
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

// ── Shift package (PortalShiftDetailDto + the package endpoints) ────────────────────────────
// Everything the shift package needs beyond the original portal shape: need-to-know "at a
// glance" facts, emergency contacts, doses due in the window (Due / Overdue / Recorded) and PRN,
// server-matched routines, the previous worker's handover + custody trail, breaks, net worked
// minutes, the Finish checklist and the Medication Competency flag. See PortalDTOs.cs.
//
// UNLIKE the rest of this file, the package state is STICKY within one server process so the
// shift-package UI can be built against it: Start/Finish flip the shift's status, breaks can be
// started/ended/edited/deleted, doses can be recorded, the handover can be acknowledged. Restart
// the mock to reset. Error paths answer with the real status codes and codes:
//   409 SHIFT_BREAK_ALREADY_RUNNING / SHIFT_NOT_IN_PROGRESS / ADMINISTRATION_ALREADY_RECORDED,
//   400 SHIFT_BREAK_* and validation, 403 MEDICATION_COMPETENCY_*, 404, 422 SHIFT_FINISH_BLOCKED /
//   DOSE_SLOT_NOT_DUE.
// MOCK_COMPETENCY=expired|missing makes the signed-in worker lack a current Medication Competency.
// The provider mode decides what that means (MOCK_COMPETENCY_MODE=warn|enforce, default warn, like
// production): WARN - canRecordDoses stays true with the warning reason, a recorded dose is accepted
// and FLAGGED (recordedWithoutCompetency), and due doses block Finish as for anyone; ENFORCE -
// canRecordDoses false + reason, recording a dose 403s, and NO dose blocks Finish (a worker who
// cannot record a dose is never asked to clear one). Default worker: current.
//
// The Finish checklist follows the real server: a running break blocks; a dose blocks only once its
// time has ARRIVED (a slot flagged `upcoming` in the fixtures does not - it is recorded when it falls due, and it also stands for "more than an hour
// away": an Administered dose cannot be charted for it yet, 422 ADMINISTRATION_TOO_EARLY) and only
// for a worker who can record doses. A slot takes one record; an idempotencyKey may only be reused for
// the SAME dose (medication, slot, outcome) - anything else is 400 ADMINISTRATION_IDEMPOTENCY_KEY_REUSED.
// The one exception to a slot taking one record: a record saying the dose WAS given (Administered, or WrongMedication) supersedes an active
// Refused, Withheld or Missed one (the earlier record is kept as history in `superseded`, the slot reads the new one). A given record is never
// superseded, and a not-given outcome never replaces another record.
// Routine ticks persist for the process (`routineChecks`): POST/DELETE portal/shifts/:id/routines/:id/check, InProgress only, the routine must be
// in the shift's own list (404 SHIFT_ROUTINE_NOT_FOUND), idempotent; a fixture `checked` pre-ticks a routine of a finished shift (shift-0002 has
// two of its three ticked, so the review shows a mix).
// NEED-TO-KNOW BY SHIFT STATUS: handover, emergency contacts and address only for a Published or InProgress shift. Any other status (the
// Completed and PendingReview fixtures, and shift-0003 once finished) gets explicit nulls for them (and an empty handoverTrail) plus
// `sensitiveInfoWithheldReason`.
// Null members are written as explicit nulls (the real API marks every nullable shift-package member
// [JsonIgnore(Never)]); an error envelope omits the members it does not use, like the real ApiResponse.
//
// Fixtures: shift-0003 (Sienna, Published, 09:00-15:00) is the worked example - anaphylaxis, doses
// with one OVERDUE once started, a high-risk (witnessed) dose, a PRN, routines, emergency contacts
// and an UNREAD handover. shift-0002 (Grace, overnight 19:00-07:00, PendingReview) has after-
// midnight doses and routines, breaks and a handover. shift-0001 (Liam, Completed) has mostly
// "Not recorded" (null) facts, to exercise the missing-data states.

const PACKAGE_TZ = 'Australia/Brisbane'
const MOCK_COMPETENCY = (process.env.MOCK_COMPETENCY || 'current').toLowerCase()
const MOCK_COMPETENCY_MODE = (process.env.MOCK_COMPETENCY_MODE || 'warn').toLowerCase()
const MOCK_WORKER_NAME = "Jack O'Sullivan"
const COMPETENCY_WARNING = 'Medication Competency not current — this record will be flagged'

/** True when the signed-in mock worker holds a current Medication Competency. */
const competencyIsCurrent = () => MOCK_COMPETENCY !== 'expired' && MOCK_COMPETENCY !== 'missing'

const competencyView = () => {
  if (competencyIsCurrent()) return { canRecordDoses: true, canRecordDosesReason: null, canRecordDosesReasonCode: null }
  const expired = MOCK_COMPETENCY === 'expired'
  const code = expired ? 'MEDICATION_COMPETENCY_EXPIRED' : 'MEDICATION_COMPETENCY_MISSING'
  if (MOCK_COMPETENCY_MODE !== 'enforce') {
    // Warn (the default): may record, and the record is flagged. The code still says why the credential is not current.
    return { canRecordDoses: true, canRecordDosesReason: COMPETENCY_WARNING, canRecordDosesReasonCode: code }
  }
  return {
    canRecordDoses: false,
    canRecordDosesReason: expired
      ? 'Your Medication Competency expired on 12 Sep 2026. Ask your coordinator to update your qualifications before you record medication doses.'
      : 'You need a current Medication Competency credential to record medication doses. Ask your coordinator to add it to your qualifications.',
    canRecordDosesReasonCode: code,
  }
}

const emptyAtAGlance = () => ({
  allergies: { detail: null, isAnaphylaxisRisk: null, managementNotes: null },
  diet: { chokingRiskDetail: null, pegRegimeDetail: null, modifiedDietDetail: null, mealAssistanceDetail: null, medicationTricks: null },
  communication: { expressiveSkills: null, receptiveSkills: null, readingAbility: null, aids: null },
  behaviour: { triggers: null, earlyWarningSigns: null, deEscalationStrategies: null, whatNotToDo: null, whatHelpsMeCalmDown: null },
  hidpa: { epilepsy: false, enteralFeeding: false, dysphagia: false },
  address: { street: null, suburb: null, state: null, postcode: null },
})

// participantId -> need-to-know package data. Missing values are explicit nulls ("Not recorded").
const packageParticipants = {
  'p-0002': {
    atAGlance: {
      allergies: {
        detail: 'Tree nuts (almond, cashew) and kiwi fruit.', isAnaphylaxisRisk: true,
        managementNotes: 'EpiPen Jr in the red bag on the back of the chair. Call 000 first, then use the EpiPen.',
      },
      diet: {
        chokingRiskDetail: 'High risk. Supervise every meal; sit upright for 30 minutes after eating.',
        pegRegimeDetail: null, modifiedDietDetail: 'Soft, bite-sized pieces. No whole nuts, grapes or popcorn.',
        mealAssistanceDetail: 'Needs the plate set up and food cut up; eats independently once started.',
        medicationTricks: 'Takes tablets crushed in apple puree.',
      },
      communication: {
        expressiveSkills: 'Speaks in short phrases. Says "no" clearly; may not say when in pain.',
        receptiveSkills: 'Understands simple one-step instructions.', readingAbility: 'Reads picture cards, not text.',
        aids: 'Picture schedule and a PECS book (in the wheelchair bag).',
      },
      behaviour: {
        triggers: 'Loud sudden noises; unexpected changes to the routine.', earlyWarningSigns: 'Humming louder, rocking, covering her ears.',
        deEscalationStrategies: 'Move to a quiet room, lower your voice, offer the weighted blanket.',
        whatNotToDo: 'Do not touch her without telling her first. Do not rush transfers.',
        whatHelpsMeCalmDown: 'Weighted blanket, her favourite playlist, a slow drink.',
      },
      hidpa: { epilepsy: true, enteralFeeding: false, dysphagia: true },
      address: { street: '14 Banksia Court', suburb: 'Robina', state: 'QLD', postcode: '4226' },
    },
    emergencyContacts: [
      { id: 'ec-0001', name: 'Priya Whitfield', relationship: 'Mother', phone: '07 5555 0142', mobile: '0400 555 142', isPrimary: true, priorityOrder: 1, roleType: 'EmergencyContact', roleLabel: 'Emergency contact' },
      { id: 'ec-0002', name: 'Daniel Whitfield', relationship: 'Brother', phone: null, mobile: '0411 222 908', isPrimary: false, priorityOrder: 2, roleType: 'EmergencyContact', roleLabel: 'Emergency contact' },
    ],
    handover: {
      completionId: 'sc-prev-0002', text: 'Sienna slept badly and was tired from 10am. Left heel looks a bit red - keep an eye on it and tell Priya at pick-up. New EpiPen is in the red bag.',
      nothingToHandOver: false, authorUserId: 's-0005', authorName: 'Tom Beattie', shiftDate: '2026-09-12', submittedAt: '2026-09-12T05:10:00Z',
    },
    handoverTrail: [
      { completionId: 'sc-prev-0002', workerName: 'Tom Beattie', shiftDate: '2026-09-12' },
      { completionId: 'sc-prev-0001', workerName: 'Mei Zhang', shiftDate: '2026-09-11' },
      { completionId: 'sc-prev-0000', workerName: 'Tom Beattie', shiftDate: '2026-09-10' },
    ],
  },
  'p-0004': {
    atAGlance: {
      ...emptyAtAGlance(),
      allergies: { detail: 'Penicillin (rash).', isAnaphylaxisRisk: false, managementNotes: null },
      communication: { expressiveSkills: 'Uses full sentences.', receptiveSkills: null, readingAbility: null, aids: 'Hearing aid (left ear) - check it is in and charged.' },
      behaviour: {
        triggers: 'Being woken suddenly; strangers in her room.', earlyWarningSigns: 'Pacing, tearfulness.',
        deEscalationStrategies: 'Quiet voice, dim the light, sit with her.', whatNotToDo: 'Do not restrain. Do not enter the room without knocking.',
        whatHelpsMeCalmDown: 'A cup of tea and the radio on low.',
      },
      hidpa: { epilepsy: true, enteralFeeding: false, dysphagia: false },
      address: { street: '3/22 Jacaranda Avenue', suburb: 'Chermside', state: 'QLD', postcode: '4032' },
    },
    emergencyContacts: [
      // No Emergency Contact role on this participant, so the list falls back to her Next of Kin (labelled), like the server.
      { id: 'ec-0003', name: 'Helen Palmer', relationship: 'Mother', phone: '07 5555 0177', mobile: null, isPrimary: true, priorityOrder: 1, roleType: 'NextOfKin', roleLabel: 'Next of kin' },
    ],
    handover: {
      completionId: 'sc-prev-0004', text: 'Grace was unsettled at bedtime last night; settled by 11pm. Hearing aid battery was replaced.',
      nothingToHandOver: false, authorUserId: 's-0004', authorName: 'Mei Zhang', shiftDate: '2026-09-09', submittedAt: '2026-09-09T21:00:00Z',
    },
    handoverTrail: [
      { completionId: 'sc-prev-0004', workerName: 'Mei Zhang', shiftDate: '2026-09-09' },
      { completionId: 'sc-prev-0003', workerName: 'Jack O\'Sullivan', shiftDate: '2026-09-08' },
    ],
  },
  'p-0001': {
    atAGlance: emptyAtAGlance(),
    emergencyContacts: [],
    handover: null,
    handoverTrail: [],
  },
}

const DOSE_COMMON = { form: 'Tablet', route: 'Oral', supportLevel: 'Administer', isHighRisk: false, directions: null }

// shiftId -> scheduled doses (provider-local wall-clock `at`, "overdue" = how it reads once the
// shift is InProgress and nothing is recorded; `upcoming` = its time has not arrived yet, so it does
// not block Finish) and PRN medications. `recorded` prefills history.
const packageDoses = {
  'shift-0003': {
    slots: [
      { ...DOSE_COMMON, medicationId: 'med-0301', name: 'Levetiracetam', strength: '500mg', dose: '1 tablet', at: '2026-09-13T09:00:00', overdue: true, directions: 'With food' },
      { ...DOSE_COMMON, medicationId: 'med-0302', name: 'Ferrous sulfate', strength: '105mg', dose: '1 tablet', at: '2026-09-13T12:30:00' },
      { ...DOSE_COMMON, medicationId: 'med-0303', name: 'Insulin glargine', strength: '100 units/mL', dose: '18 units', form: 'Injection', route: 'Subcutaneous', isHighRisk: true, at: '2026-09-13T13:00:00', directions: 'Rotate the injection site', upcoming: true },
    ],
    prn: [
      { ...DOSE_COMMON, medicationId: 'med-0304', name: 'Paracetamol', strength: '500mg', dose: '2 tablets', indication: 'Mild pain or fever', maxDosesPer24h: 4, minIntervalMinutes: 240, baseDoses: 1, baseLastDoseAt: '2026-09-12T23:40:00Z', pendingOutcomeId: 'adm-prn-0304' },
    ],
  },
  'shift-0002': {
    slots: [
      { ...DOSE_COMMON, medicationId: 'med-0201', name: 'Levetiracetam', strength: '500mg', dose: '1 tablet', at: '2026-09-10T20:00:00',
        recorded: { status: 'Administered', recordedByName: 'Mei Zhang', doseGiven: '1 tablet', administeredAt: '2026-09-10T10:04:00Z' } },
      { ...DOSE_COMMON, medicationId: 'med-0202', name: 'Melatonin', strength: '3mg', dose: '1 tablet', at: '2026-09-10T22:00:00',
        recorded: { status: 'Refused', recordedByName: 'Mei Zhang', reason: 'Declined - said she was not tired yet.' } },
      { ...DOSE_COMMON, medicationId: 'med-0203', name: 'Clonidine', strength: '25mcg', dose: '1 tablet', at: '2026-09-11T02:00:00',
        recorded: { status: 'Missed', recordedByName: 'Mei Zhang', reason: 'Asleep, not woken for it.' } },
      // Nothing was recorded for this one: the review shows outcome null and the queue counts it in dosesWithoutOutcome.
      { ...DOSE_COMMON, medicationId: 'med-0204', name: 'Vitamin D', strength: '1000IU', dose: '1 capsule', at: '2026-09-11T06:00:00' },
    ],
    prn: [],
  },
  'shift-0001': { slots: [], prn: [] },
}

// shiftId -> routines matched to the shift window (server-side; overnight handled).
const packageRoutines = {
  'shift-0003': [
    { id: 'rt-0301', title: 'Allergy check before any food', description: 'Read the label and check against the allergy list before offering any food or drink.', category: 'Meals', isCritical: true, startTime: null, endTime: null, occursAt: null, afterMidnight: false },
    { id: 'rt-0302', title: 'Lunch', description: 'Set up the plate, cut food small, stay seated with her.', category: 'Meals', isCritical: true, startTime: '12:00:00', endTime: '13:00:00', occursAt: '2026-09-13T12:00:00', afterMidnight: false },
    { id: 'rt-0303', title: 'Afternoon walk', description: 'Short walk along the path, back before 2:30.', category: 'Activity', isCritical: false, startTime: '13:30:00', endTime: '14:30:00', occursAt: '2026-09-13T13:30:00', afterMidnight: false },
  ],
  'shift-0002': [
    { id: 'rt-0201', title: 'Evening wind-down', description: 'Dim lights, radio on low, tea.', category: 'Sleep', isCritical: false, startTime: '21:00:00', endTime: '22:00:00', occursAt: '2026-09-10T21:00:00', afterMidnight: false,
      checked: { at: '2026-09-10T11:05:00Z', by: 'Mei Zhang' } },
    { id: 'rt-0202', title: 'Night check', description: 'Quietly check on her and her hearing aid case.', category: 'Sleep', isCritical: true, startTime: '02:00:00', endTime: '02:30:00', occursAt: '2026-09-11T02:00:00', afterMidnight: true,
      checked: { at: '2026-09-10T16:10:00Z', by: 'Mei Zhang' } },
    { id: 'rt-0203', title: 'Wake-up', description: 'Knock first. Hearing aid in before any conversation.', category: 'PersonalCare', isCritical: false, startTime: '06:00:00', endTime: '07:00:00', occursAt: '2026-09-11T06:00:00', afterMidnight: true },
  ],
  'shift-0001': [],
}

// shiftId -> history (completed/pending shifts): breaks already on the completion.
const packageHistoryBreaks = {
  'shift-0001': [
    { id: 'brk-0001', startedAt: '2026-09-08T13:00:00Z', endedAt: '2026-09-08T13:30:00Z', editedAt: null, createdByUserId: 's-0003' },
  ],
  'shift-0002': [
    { id: 'brk-0002', startedAt: '2026-09-10T22:00:00Z', endedAt: '2026-09-10T22:20:00Z', editedAt: '2026-09-10T22:40:00Z', createdByUserId: 's-0004' },
  ],
}

const SKEW_MS = 5 * 60 * 1000   // breaks: a break cannot be more than 5 minutes in the future
// Doses: a supplied administeredAt up to 15 minutes ahead is a device clock running fast - the server stores ITS now instead of refusing.
const DOSE_SKEW_MS = 15 * 60 * 1000
const wholeMinutes = (ms) => Math.round(ms / 60000)

/** Per-shift sticky package state (status/completion overrides, breaks, dose records, ack). */
const shiftPackageState = {}
function pkgState(shiftId) {
  if (!shiftPackageState[shiftId]) {
    shiftPackageState[shiftId] = {
      status: null, completion: null, breaks: null, administrations: {}, keys: {}, prnGiven: [], superseded: [], routineChecks: {}, handoverReadAt: null, n: 0,
    }
  }
  return shiftPackageState[shiftId]
}

function currentStatus(shiftId) {
  const base = portalShiftBase[shiftId] || portalShiftBase['shift-0003']
  return pkgState(base.id).status ?? base.status
}

function breaksFor(shiftId) {
  const st = pkgState(shiftId)
  if (st.breaks) return st.breaks
  // Fixture history until the shift is (re)started in this session.
  return (packageHistoryBreaks[shiftId] || []).map((b) => ({ ...b }))
}

function breakDto(b, nowMs) {
  const end = b.endedAt ? Date.parse(b.endedAt) : nowMs
  return {
    id: b.id, startedAt: b.startedAt, endedAt: b.endedAt, isRunning: !b.endedAt,
    minutes: Math.max(0, wholeMinutes(end - Date.parse(b.startedAt))), editedAt: b.editedAt, createdByUserId: b.createdByUserId,
  }
}

/** Adds breaks / net minutes / handover confirmations to a completion fixture. */
function withPackageFields(shiftId, completion) {
  const nowMs = Date.now()
  const breaks = breaksFor(shiftId).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const startMs = Date.parse(completion.actualStart)
  const endMs = completion.actualEnd ? Date.parse(completion.actualEnd) : nowMs
  const gross = Math.max(0, wholeMinutes(endMs - startMs))
  const breakMinutes = breaks.reduce((sum, b) => {
    const from = Math.max(Date.parse(b.startedAt), startMs)
    const to = Math.min(b.endedAt ? Date.parse(b.endedAt) : endMs, endMs)
    return sum + Math.max(0, to - from)
  }, 0)
  const breakMins = wholeMinutes(breakMinutes)
  return {
    handoverText: null, nothingToHandOver: false, nothingToNoteConfirmed: false, ...completion,
    breaks: breaks.map((b) => breakDto(b, nowMs)), breakMinutes: breakMins, netWorkedMinutes: Math.max(0, gross - breakMins),
  }
}

function doseSlotDto(shiftId, def) {
  const st = pkgState(shiftId)
  const status = currentStatus(shiftId)
  const rec = st.administrations[`${def.medicationId}|${def.at}`] || (def.recorded ? prefilledAdministration(shiftId, def) : null)
  const state = rec ? 'Recorded' : (status === 'InProgress' && def.overdue ? 'Overdue' : 'Due')
  return {
    medicationId: def.medicationId, medicationName: def.name, strength: def.strength, doseDescription: def.dose, form: def.form,
    route: def.route, directions: def.directions, supportLevel: def.supportLevel, isHighRisk: def.isHighRisk,
    scheduledAt: def.at, scheduledTime: def.at.slice(11, 16), state, isOverdue: state === 'Overdue',
    outcome: rec ? {
      administrationId: rec.id, status: rec.status, recordedByName: rec.recordedByName, administeredAt: rec.administeredAt ?? null,
      administeredAtTimeZone: rec.administeredAtTimeZone ?? null, recordedAt: rec.createdAt, reason: rec.reason ?? null,
      doseGiven: rec.doseGiven ?? null, notes: rec.notes ?? null, recordedWithoutCompetency: !!rec.recordedWithoutCompetency,
    } : null,
    witness: {
      required: def.isHighRisk, status: rec ? rec.witnessStatus : null, witnessName: rec ? rec.witnessName : null,
      requestedAt: rec ? rec.witnessRequestedAt : null, respondedAt: rec ? rec.witnessRespondedAt : null,
    },
  }
}

/** A provider-local wall-clock value ("2026-09-13T09:00:00") as a UTC instant with a Z. The package zone (Brisbane) is UTC+10 all year. */
const localToUtcIso = (at) => new Date(`${at}+10:00`).toISOString()

function prefilledAdministration(shiftId, def) {
  const p = portalShiftBase[shiftId]
  const r = def.recorded
  return {
    id: `adm-${def.medicationId}`, participantMedicationId: def.medicationId, participantId: p.participantId,
    scheduledAt: def.at, administeredAt: r.administeredAt ?? null, administeredAtTimeZone: r.administeredAt ? PACKAGE_TZ : null,
    status: r.status, doseGiven: r.doseGiven ?? null, recordedByName: r.recordedByName, recordedByUserId: null,
    witnessName: null, witnessStaffId: null, witnessStatus: 'NotRequired', witnessRequestedAt: null, witnessRespondedAt: null,
    reason: r.reason ?? null, prnReason: null, prnOutcome: null, prnOutcomeAt: null, limitBreachAcknowledged: false, notes: null,
    createdAt: localToUtcIso(def.at), recordedWithoutCompetency: false, incidentId: null,
  }
}

function prnDto(shiftId, def) {
  const st = pkgState(shiftId)
  const given = st.prnGiven.filter((g) => g.participantMedicationId === def.medicationId)
  const doses = def.baseDoses + given.length
  const lastDoseAt = given.length ? given[given.length - 1].administeredAt : def.baseLastDoseAt
  const nextMs = lastDoseAt && def.minIntervalMinutes ? Date.parse(lastDoseAt) + def.minIntervalMinutes * 60000 : null
  return {
    medicationId: def.medicationId, medicationName: def.name, strength: def.strength, doseDescription: def.dose, form: def.form,
    route: def.route, directions: def.directions, supportLevel: def.supportLevel, isHighRisk: def.isHighRisk, indication: def.indication,
    maxDosesPer24h: def.maxDosesPer24h, minIntervalMinutes: def.minIntervalMinutes, dosesInLast24h: doses, lastDoseAt,
    maxDosesReached: def.maxDosesPer24h != null && doses >= def.maxDosesPer24h,
    nextAvailableAt: nextMs && nextMs > Date.now() ? new Date(nextMs).toISOString() : null,
    outcomePendingAdministrationId: given.length ? given[given.length - 1].id : def.pendingOutcomeId ?? null,
  }
}

/**
 * The PRN limits, judged at the time the dose was GIVEN (administeredAt, or now) against the Administered records on both sides, like the server: no
 * 24-hour window containing the dose may hold more than the maximum with this dose in it, and the minimum interval holds from the nearest record before
 * AND to the nearest record after. The fixture's earlier doses (baseDoses, all at baseLastDoseAt) count too. Null when there is no breach.
 */
function prnLimitBreach(shiftId, def, doseMs) {
  const DAY = 24 * 60 * 60000
  const recorded = pkgState(shiftId).prnGiven.filter((g) => g.participantMedicationId === def.medicationId).map((g) => Date.parse(g.administeredAt))
  const earlier = def.baseLastDoseAt ? Array(def.baseDoses || 0).fill(Date.parse(def.baseLastDoseAt)) : []
  const times = [...earlier, ...recorded].sort((a, b) => a - b)
  if (def.maxDosesPer24h != null) {
    const starts = [...times.filter((t) => t >= doseMs - DAY && t <= doseMs), doseMs]
    if (starts.some((start) => times.filter((t) => t >= start && t <= start + DAY).length >= def.maxDosesPer24h)) {
      return `Maximum ${def.maxDosesPer24h} doses in 24 hours reached`
    }
  }
  if (def.minIntervalMinutes) {
    const before = times.filter((t) => t <= doseMs).pop()
    const after = times.find((t) => t > doseMs)
    if (before != null && (doseMs - before) / 60000 < def.minIntervalMinutes) return `Minimum interval of ${def.minIntervalMinutes} minutes not yet elapsed`
    if (after != null && (after - doseMs) / 60000 < def.minIntervalMinutes) {
      return `This dose is less than ${def.minIntervalMinutes} minutes before the dose recorded at ${new Date(after).toISOString().slice(11, 16)}`
    }
  }
  return null
}

function finishBlockersFor(shiftId) {
  if (currentStatus(shiftId) !== 'InProgress') return []
  const blockers = []
  if (breaksFor(shiftId).some((b) => !b.endedAt)) {
    blockers.push({ code: 'BREAK_RUNNING', message: 'A break is still running. End it before you finish the shift.', medicationId: null, medicationName: null, scheduledAt: null })
  }
  if (!competencyView().canRecordDoses) return blockers   // no dose blocks a worker who could not record it
  for (const def of (packageDoses[shiftId]?.slots || [])) {
    if (def.upcoming) continue   // its time has not arrived: it does not block
    if (doseSlotDto(shiftId, def).outcome) continue
    const label = def.strength ? `${def.name} ${def.strength}` : def.name
    blockers.push({
      code: 'DOSE_OUTCOME_MISSING', medicationId: def.medicationId, medicationName: def.name, scheduledAt: def.at,
      message: `${label} at ${def.at.slice(11, 16)} has no outcome. Record it, or mark it not given with a reason.`,
    })
  }
  return blockers
}

/** Why the handover, emergency contacts and address are not shown for this status (the server's wording). */
function withheldReason(status) {
  const state = { PendingReview: 'waiting for review', Completed: 'completed', Cancelled: 'cancelled' }[status] || 'not published'
  return `The participant's emergency contacts, address and handover are only shown for a shift that is published or in progress. This shift is ${state}.`
}

/** A fixture routine with the worker's tick state: ticks made in this process win; otherwise a fixture `checked` ({ at, by }) pre-ticks it. */
function routineWithCheck(shiftId, r) {
  const st = pkgState(shiftId)
  const { checked, ...routine } = r
  const state = Object.prototype.hasOwnProperty.call(st.routineChecks, r.id) ? st.routineChecks[r.id] : (checked ?? null)
  return { ...routine, isChecked: !!state, checkedAt: state ? state.at : null, checkedByName: state ? state.by : null }
}

function packageFor(shiftId, participantId, status) {
  const pp = packageParticipants[participantId] || packageParticipants['p-0001']
  const st = pkgState(shiftId)
  // NEED-TO-KNOW BY SHIFT STATUS: only a Published or InProgress shift shows the handover, emergency contacts and address.
  const showSensitive = status === 'Published' || status === 'InProgress'
  const doses = packageDoses[shiftId] || { slots: [], prn: [] }
  const handover = pp.handover ? {
    completionId: pp.handover.completionId, text: pp.handover.text, nothingToHandOver: pp.handover.nothingToHandOver,
    authorUserId: pp.handover.authorUserId, authorName: pp.handover.authorName, shiftDate: pp.handover.shiftDate,
    submittedAt: pp.handover.submittedAt, requiresAcknowledgement: !!pp.handover.text,
    isRead: !!st.handoverReadAt, readAt: st.handoverReadAt,
  } : null
  return {
    breaks: breaksFor(shiftId).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((b) => breakDto(b, Date.now())),
    handover: showSensitive ? handover : null, handoverTrail: showSensitive ? pp.handoverTrail : [], finishBlockers: finishBlockersFor(shiftId),
    timeZoneId: PACKAGE_TZ, atAGlance: showSensitive ? pp.atAGlance : { ...pp.atAGlance, address: null },
    emergencyContacts: showSensitive ? pp.emergencyContacts : null,
    sensitiveInfoWithheldReason: showSensitive ? null : withheldReason(status),
    medicationsDue: doses.slots.map((def) => doseSlotDto(shiftId, def)), prn: doses.prn.map((def) => prnDto(shiftId, def)),
    shiftRoutines: (packageRoutines[shiftId] || []).map((r) => routineWithCheck(shiftId, r)), ...competencyView(),
  }
}

// ── package endpoint helpers ─────────────────────────────────

const HTTP = Symbol('http-status')
/** Lets a route answer with a non-200 status (the dispatcher below honours it). */
const respond = (status, body) => ({ [HTTP]: status, body })
const failEnvelope = (data, errors, code) => {
  const envelope = { success: false }
  if (data != null) envelope.data = data
  if (errors != null) envelope.errors = errors
  if (code != null) envelope.code = code
  return envelope
}

const NOT_IN_PROGRESS = {
  Published: ["This shift hasn't been started.", 'SHIFT_NOT_IN_PROGRESS'],
  PendingReview: ['This shift has already been finished and is waiting for review.', 'SHIFT_ALREADY_FINISHED'],
  Completed: ['This shift has already been reviewed and completed.', 'SHIFT_ALREADY_COMPLETED'],
  Cancelled: ['This shift has been cancelled.', 'SHIFT_CANCELLED'],
  Draft: ["This shift hasn't been published yet.", 'SHIFT_NOT_PUBLISHED'],
}

/** A 409 response when the shift is not InProgress, else null. */
function notInProgress(shiftId) {
  const status = currentStatus(shiftId)
  if (status === 'InProgress') return null
  const [message, code] = NOT_IN_PROGRESS[status] || NOT_IN_PROGRESS.Draft
  return respond(409, failEnvelope(null, [message], code))
}

function administrationFromBody(shiftId, med, body, slotAt) {
  const p = portalShiftBase[shiftId]
  const now = new Date().toISOString()
  const participant = participants.find((x) => x.id === p.participantId) || participants[0]
  const witnessed = med.isHighRisk && body.status === 'Administered' && (body.witnessStaffId || body.witnessName)
  return {
    id: `adm-mock-${Date.now()}-${++pkgState(shiftId).n}`, participantMedicationId: med.medicationId, participantId: p.participantId,
    participantName: participant.fullName, medicationName: med.name, doseDescription: med.dose, tripInstanceId: null,
    scheduledAt: slotAt ?? null, administeredAt: body.status === 'Administered' ? (body.administeredAt ?? now) : (body.administeredAt ?? null),
    administeredAtTimeZone: body.administeredAtTimeZone ?? null, status: body.status, doseGiven: body.doseGiven ?? null,
    recordedByName: MOCK_WORKER_NAME, recordedByUserId: CURRENT_STAFF_ID,
    witnessName: body.witnessName ?? (body.witnessStaffId ? 'Mei Zhang' : null), witnessStaffId: body.witnessStaffId ?? null,
    witnessStatus: witnessed && body.witnessStaffId ? 'Pending' : 'NotRequired', witnessRequestedAt: witnessed && body.witnessStaffId ? now : null,
    witnessRespondedAt: null, reason: body.reason ?? null, prnReason: body.prnReason ?? null, prnOutcome: null, prnOutcomeAt: null,
    limitBreachAcknowledged: !!body.acknowledgeLimitBreach, notes: body.notes ?? null, createdAt: now,
    recordedWithoutCompetency: !competencyIsCurrent(), incidentId: null,
  }
}

const packageRoutesPost = [
  ['portal/shifts/:id/breaks/start', (id) => {
    const guard = notInProgress(id)
    if (guard) return guard
    const st = pkgState(id)
    st.breaks = breaksFor(id)
    if (st.breaks.some((b) => !b.endedAt)) {
      return respond(409, failEnvelope(null, ['A break is already running. End it before starting another.'], 'SHIFT_BREAK_ALREADY_RUNNING'))
    }
    st.breaks.push({ id: `brk-mock-${Date.now()}-${++st.n}`, startedAt: new Date().toISOString(), endedAt: null, editedAt: null, createdByUserId: CURRENT_STAFF_ID })
    return buildPortalShiftDetail(id)
  }],
  ['portal/shifts/:id/breaks/:id/end', (id, breakId) => {
    const guard = notInProgress(id)
    if (guard) return guard
    const st = pkgState(id)
    st.breaks = breaksFor(id)
    const b = st.breaks.find((x) => x.id === breakId)
    if (!b) return respond(404, failEnvelope(null, ['Break not found.'], 'SHIFT_BREAK_NOT_FOUND'))
    if (!b.endedAt) b.endedAt = new Date().toISOString()   // idempotent: ending an ended break is a no-op
    return buildPortalShiftDetail(id)
  }],
  ['portal/shifts/:id/routines/:id/check', (shiftId, routineId) => {
    const { st, error } = routineTarget(shiftId, routineId)
    if (error) return error
    // Idempotent: ticking again keeps the first who and when.
    const already = routineWithCheck(shiftId, packageRoutines[shiftId].find((r) => r.id === routineId))
    if (!already.isChecked) st.routineChecks[routineId] = { at: new Date().toISOString(), by: MOCK_WORKER_NAME }
    return buildPortalShiftDetail(shiftId)
  }],
  ['portal/shifts/:id/handover/ack', (id, body) => {
    const base = portalShiftBase[id] || portalShiftBase['shift-0003']
    const st = pkgState(base.id)
    const status = currentStatus(base.id)
    if (status !== 'Published' && status !== 'InProgress') {
      const [message, code] = NOT_IN_PROGRESS[status] || NOT_IN_PROGRESS.Draft
      return respond(409, failEnvelope(null, [message], code))
    }
    const h = (packageParticipants[base.participantId] || {}).handover
    if (!h) return respond(404, failEnvelope(null, ["There's no handover to mark as read."], 'SHIFT_HANDOVER_NOT_FOUND'))
    if (body?.completionId && body.completionId !== h.completionId) {
      return respond(409, failEnvelope(buildPortalShiftDetail(base.id), ['There is a newer handover. Read it before marking it as read.'], 'SHIFT_HANDOVER_CHANGED'))
    }
    if (!st.handoverReadAt) st.handoverReadAt = new Date().toISOString()
    return buildPortalShiftDetail(base.id)
  }],
  ['portal/shifts/:id/medications/:id/administrations', (shiftId, medicationId, body) => {
    const guard = notInProgress(shiftId)
    if (guard) return guard
    const st = pkgState(shiftId)
    const defs = packageDoses[shiftId] || { slots: [], prn: [] }

    const slotDef = defs.slots.find((d) => d.medicationId === medicationId)
    const prnDef = defs.prn.find((d) => d.medicationId === medicationId)
    const med = slotDef || prnDef
    if (!med) return respond(404, failEnvelope(null, ['Medication not found'], null))

    // The server's order: the portal's own checks (is this a dose due in the shift?) come BEFORE the recorder's Medication Competency gate.
    const slotAt = body?.scheduledAt ? String(body.scheduledAt).slice(0, 19) : null
    if (prnDef && slotAt) return respond(422, failEnvelope(null, ['An as-needed (PRN) dose has no scheduled time.'], 'DOSE_SLOT_NOT_DUE'))
    if (slotDef && (!slotAt || slotAt !== slotDef.at)) {
      return respond(422, failEnvelope(null, ["This isn't a dose due in this shift. Choose one of the doses listed for the shift."], 'DOSE_SLOT_NOT_DUE'))
    }

    const competency = competencyView()
    if (!competency.canRecordDoses) return respond(403, failEnvelope(null, [competency.canRecordDosesReason], competency.canRecordDosesReasonCode))

    // A key means "this exact request": a double tap returns the first record (200), but the same key for a different dose is refused.
    if (body?.idempotencyKey && st.keys[body.idempotencyKey]) {
      const prior = st.keys[body.idempotencyKey]
      if (prior.participantMedicationId !== medicationId || (prior.scheduledAt ?? null) !== (slotAt ?? null) || prior.status !== body.status) {
        return respond(400, failEnvelope(null, ['This request key was already used for a different dose.'], 'ADMINISTRATION_IDEMPOTENCY_KEY_REUSED'))
      }
      return prior
    }

    if (body?.status !== 'Administered' && !String(body?.reason || '').trim()) {
      return respond(400, failEnvelope(null, ['A reason is required when a dose is refused, withheld, missed or the wrong medication was given.'], null))
    }

    // Temporal rules (422), after validation like the server. An `upcoming` fixture slot stands for "more than an hour away": an Administered
    // dose for it cannot be charted yet (a not-given outcome can). administeredAt must lie in [the earliest the shift allows, now + 15 minutes]: the
    // earlier of the shift's completion start and an hour before the rostered start (so a late Start tap or a Return and restart cannot make the true
    // time of a dose unchartable); a time ahead of the server but within 15 minutes is stored as the server's now.
    if (slotDef && body?.status === 'Administered' && slotDef.upcoming) {
      return respond(422, failEnvelope(null, [`This dose is not due until ${slotDef.at.slice(11, 16)}. It can be recorded from an hour before.`], 'ADMINISTRATION_TOO_EARLY'))
    }
    let givenMs = null
    if (body?.administeredAt) {
      givenMs = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(String(body.administeredAt)) ? body.administeredAt : `${body.administeredAt}Z`)   // no zone = UTC
      const shiftBase = portalShiftBase[shiftId]
      const rosteredLimit = Date.parse(`${shiftBase.serviceDate}T${shiftBase.startTime}Z`) - 60 * 60000
      const earliest = Math.min(rosteredLimit, st.completion ? Date.parse(st.completion.actualStart) : Infinity)
      if (givenMs > Date.now() + DOSE_SKEW_MS) {
        return respond(422, failEnvelope(null, ["The time this dose was given can't be in the future. Check the time and try again."], 'ADMINISTRATION_TIME_OUT_OF_RANGE'))
      }
      if (givenMs < earliest) {
        return respond(422, failEnvelope(null, [`The time this dose was given can't be earlier than ${new Date(earliest).toISOString().slice(11, 16)}, the earliest this shift allows. Check the time and try again.`], 'ADMINISTRATION_TIME_OUT_OF_RANGE'))
      }
      if (givenMs > Date.now()) {   // a device clock running fast: store the server's now
        givenMs = Date.now()
        body = { ...body, administeredAt: new Date(givenMs).toISOString() }
      }
    }
    if (prnDef) {
      if (body.status === 'Administered' && !String(body.prnReason || '').trim()) {
        return respond(400, failEnvelope(null, ['A PRN reason is required when recording an administered PRN dose.'], null))
      }
      const breach = body.status === 'Administered' ? prnLimitBreach(shiftId, prnDef, givenMs ?? Date.now()) : null
      if (breach && !body.acknowledgeLimitBreach) {
        return respond(400, failEnvelope(null, [breach], null))
      }
      const record = administrationFromBody(shiftId, prnDef, body, null)
      if (record.status === 'Administered') st.prnGiven.push(record)
      if (body.idempotencyKey) st.keys[body.idempotencyKey] = record
      return record
    }

    const key = `${medicationId}|${slotDef.at}`
    const existing = st.administrations[key] || (slotDef.recorded ? prefilledAdministration(shiftId, slotDef) : null)
    // One ACTIVE record per slot. The one exception: a record saying the dose WAS given (Administered or WrongMedication) supersedes an active
    // Refused, Withheld or Missed one (kept as history). Nothing replaces a given record; a not-given outcome never replaces another record.
    const supersedes = !!existing && (body.status === 'Administered' || body.status === 'WrongMedication')
      && ['Refused', 'Withheld', 'Missed'].includes(existing.status)
    if (existing && !supersedes) return respond(409, failEnvelope(existing, ['This dose has already been recorded.'], 'ADMINISTRATION_ALREADY_RECORDED'))
    if (slotDef.isHighRisk && body.status === 'Administered' && !body.witnessStaffId && !body.witnessName) {
      return respond(400, failEnvelope(null, ['A witness is required for high-risk medication administration.'], null))
    }
    const record = administrationFromBody(shiftId, slotDef, body, slotDef.at)
    if (supersedes) st.superseded.push({ ...existing, supersededByAdministrationId: record.id })
    st.administrations[key] = record
    if (body.idempotencyKey) st.keys[body.idempotencyKey] = record
    return record
  }],
]

/** The routine route's guard: an InProgress shift (else the server's 409) and a routine from the shift's own list (else 404 SHIFT_ROUTINE_NOT_FOUND). */
function routineTarget(shiftId, routineId) {
  const guard = notInProgress(shiftId)
  if (guard) return { error: guard }
  if (!(packageRoutines[shiftId] || []).some((r) => r.id === routineId)) {
    return { error: respond(404, failEnvelope(null, ["This routine isn't part of this shift."], 'SHIFT_ROUTINE_NOT_FOUND')) }
  }
  return { st: pkgState(shiftId) }
}

const packageRoutesPut = [
  ['portal/shifts/:id/breaks/:id', (id, breakId, body) => {
    const guard = notInProgress(id)
    if (guard) return guard
    const st = pkgState(id)
    st.breaks = breaksFor(id)
    const b = st.breaks.find((x) => x.id === breakId)
    if (!b) return respond(404, failEnvelope(null, ['Break not found.'], 'SHIFT_BREAK_NOT_FOUND'))
    const completion = st.completion ? st.completion : null
    const start = Date.parse(body?.startedAt)
    const end = body?.endedAt ? Date.parse(body.endedAt) : null
    const bad = (message, code) => respond(400, failEnvelope(null, [message], code))
    if (Number.isNaN(start)) return bad('A break needs a start time.', 'SHIFT_BREAK_END_NOT_AFTER_START')
    if (b.endedAt && end == null) return bad('A finished break needs an end time.', 'SHIFT_BREAK_END_REQUIRED')
    if (completion && start < Date.parse(completion.actualStart)) return bad("A break can't start before the shift started.", 'SHIFT_BREAK_BEFORE_SHIFT_START')
    if (start > Date.now() + SKEW_MS || (end != null && end > Date.now() + SKEW_MS)) return bad("A break can't be in the future.", 'SHIFT_BREAK_IN_FUTURE')
    if (end != null && end <= start) return bad('A break must end after it starts.', 'SHIFT_BREAK_END_NOT_AFTER_START')
    const overlaps = st.breaks.some((o) => o.id !== b.id && start < (o.endedAt ? Date.parse(o.endedAt) : Infinity) && Date.parse(o.startedAt) < (end ?? Infinity))
    if (overlaps) return bad('This break overlaps another break.', 'SHIFT_BREAK_OVERLAP')
    b.startedAt = new Date(start).toISOString()
    b.endedAt = end == null ? null : new Date(end).toISOString()
    b.editedAt = new Date().toISOString()
    return buildPortalShiftDetail(id)
  }],
]

const packageRoutesDelete = [
  ['portal/shifts/:id/routines/:id/check', (shiftId, routineId) => {
    const { st, error } = routineTarget(shiftId, routineId)
    if (error) return error
    st.routineChecks[routineId] = null   // an explicit null overrides a fixture pre-tick
    return buildPortalShiftDetail(shiftId)
  }],
  ['portal/shifts/:id/breaks/:id', (id, breakId) => {
    const guard = notInProgress(id)
    if (guard) return guard
    const st = pkgState(id)
    st.breaks = breaksFor(id)
    if (!st.breaks.some((x) => x.id === breakId)) return respond(404, failEnvelope(null, ['Break not found.'], 'SHIFT_BREAK_NOT_FOUND'))
    st.breaks = st.breaks.filter((x) => x.id !== breakId)
    return buildPortalShiftDetail(id)
  }],
]

/** GET rostering/shifts/:id/completion/review - the coordinator's one-call review (ShiftCompletionReviewDto). */
function buildCompletionReview(shiftId) {
  const base = portalShiftBase[shiftId] || portalShiftBase['shift-0002']
  const completion = withPackageFields(base.id, pkgState(base.id).completion || shiftCompletions.find((c) => c.shiftId === base.id) || shiftCompletions[0])
  const participant = participants.find((x) => x.id === base.participantId) || participants[0]
  const doses = packageDoses[base.id] || { slots: [], prn: [] }
  return {
    completion, participantName: participant.fullName, staffName: completion.submittedByName, serviceDate: base.serviceDate,
    timeZoneId: PACKAGE_TZ, doses: doses.slots.map((def) => doseSlotDto(base.id, def)),
    prnDoses: pkgState(base.id).prnGiven.map((g) => ({
      medicationId: g.participantMedicationId, medicationName: g.medicationName, strength: null, doseDescription: g.doseDescription,
      outcome: { administrationId: g.id, status: g.status, recordedByName: g.recordedByName, administeredAt: g.administeredAt, administeredAtTimeZone: g.administeredAtTimeZone, recordedAt: g.createdAt, reason: g.reason, doseGiven: g.doseGiven, notes: g.notes, recordedWithoutCompetency: !!g.recordedWithoutCompetency },
    })),
    notes: shiftNotesByShiftId[base.id] || [],
    routines: (packageRoutines[base.id] || []).map((r) => routineWithCheck(base.id, r)),
  }
}

/** Builds a PortalShiftDetailDto for one fixture shift. Status/completion come from the sticky
 * package state (Start/Finish flip them for this process), falling back to the fixture. */
function buildPortalShiftDetail(shiftId, overrides = {}) {
  const base = portalShiftBase[shiftId] || portalShiftBase['shift-0003']
  const st = pkgState(base.id)
  const status = overrides.status ?? st.status ?? base.status
  const rawCompletion = Object.prototype.hasOwnProperty.call(overrides, 'completion')
    ? overrides.completion
    : st.completion || shiftCompletions.find((c) => c.shiftId === base.id) || null
  const completion = rawCompletion ? withPackageFields(base.id, rawCompletion) : null
  const pkg = packageFor(base.id, base.participantId, status)
  const doses = packageDoses[base.id] || { slots: [], prn: [] }
  // Every active routine (the unfiltered list the original page still filters client-side) and the medication summary,
  // both derived from the package fixtures so they can't drift from shiftRoutines / medicationsDue.
  const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const routines = (packageRoutines[base.id] || []).map((r) => ({
    id: r.id, participantId: base.participantId, title: r.title, description: r.description, category: r.category, days: ALL_DAYS,
    startTime: r.startTime, endTime: r.endTime, isCritical: r.isCritical, isActive: true,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }))
  const medications = [
    ...doses.slots.map((d) => ({
      id: d.medicationId, name: d.name, strength: d.strength, doseDescription: d.dose, type: 'Regular', timesOfDay: d.at.slice(11, 16),
      isHighRisk: d.isHighRisk, isPsychotropic: false, isChemicalRestraint: false, drugSchedule: 'Unscheduled', supportLevel: d.supportLevel, prnIndication: null,
    })),
    ...doses.prn.map((d) => ({
      id: d.medicationId, name: d.name, strength: d.strength, doseDescription: d.dose, type: 'Prn', timesOfDay: null,
      isHighRisk: d.isHighRisk, isPsychotropic: false, isChemicalRestraint: false, drugSchedule: 'Unscheduled', supportLevel: d.supportLevel, prnIndication: d.indication,
    })),
  ]
  return {
    id: base.id, serviceDate: base.serviceDate, startTime: base.startTime, endTime: base.endTime,
    endsNextDay: base.endsNextDay, durationHours: base.durationHours, ratio: base.ratio, nightType: base.nightType,
    status, notes: base.notes,
    participant: portalParticipantSummary(base.participantId),
    routines, riskEntries: [], medications,
    completion,
    returnCount: completion ? completion.shiftReturnCount : 0,
    lastReturnReason: null,
    ...pkg,
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
      returnCount: completion.shiftReturnCount,
      // The same figures the server computes: scheduled doses in the window with no outcome, and the completion's break minutes.
      dosesWithoutOutcome: (packageDoses[base.id]?.slots || []).filter((slot) => !slot.recorded).length,
      breakMinutes: (packageHistoryBreaks[base.id] || []).reduce((sum, b) => sum + Math.round((Date.parse(b.endedAt) - Date.parse(b.startedAt)) / 60000), 0),
      // True on the manual-start path (the worker never pressed Start and supplied the start time at Finish), which skips the dose checklist.
      startWasManual: !!completion.startWasManual,
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
// The matching ASSIGNEE_ON_LEAVE entry in `exceptions` below is the server-side counterpart the
// board/drawer now rely on instead of a client-synthesised one.
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
    exceptions: [{
      shiftId: 'board-shift-0002', participantName: 'Grace Palmer-Hughes', serviceDate: '2026-09-08',
      finding: {
        code: 'ASSIGNEE_ON_LEAVE', severity: 'Warning',
        message: 'Mei Zhang is on approved leave on 2026-09-08', requiresReason: false,
      },
    }],
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
    return paged(involvedUserId ? incidentsInvolvingStaff(involvedUserId) : incidents)
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
  ['bookings', () => paged(bookings)],
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
  ['rostering/shifts/:id/completion', (id) => withPackageFields(id, pkgState(id).completion || shiftCompletions.find((c) => c.shiftId === id) || shiftCompletions[0])],
  // The coordinator's one-call review of a submitted shift (ShiftCompletionReviewDto): completion with breaks / net
  // minutes / handover, every dose in the window with its outcome, PRN doses, notes.
  ['rostering/shifts/:id/completion/review', (id) => buildCompletionReview(id)],

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
  ...packageRoutesPost,
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
    const base = portalShiftBase[id] || portalShiftBase['shift-0003']
    const st = pkgState(base.id)
    const current = currentStatus(base.id)
    if (current === 'InProgress') return buildPortalShiftDetail(base.id)   // idempotent replay, like the real Start
    if (current !== 'Published') {
      const [message, code] = NOT_IN_PROGRESS[current] || NOT_IN_PROGRESS.Draft
      return respond(409, failEnvelope(null, [message], code))
    }
    const now = new Date().toISOString()
    st.completion = {
      id: `sc-mock-${base.id}`, shiftId: base.id, actualStart: now, actualEnd: null,
      timeZoneId: 'Australia/Brisbane', geolocationDeclined: !!body?.geolocationDeclined, startWasManual: false,
      submittedByUserId: CURRENT_STAFF_ID, submittedByName: "Jack O'Sullivan",
      startedAt: now, submittedAt: null,
      reviewedByUserId: null, reviewedByName: null, reviewedAt: null, reviewOutcome: null, returnReason: null,
      varianceMinutesStart: 0, varianceMinutesEnd: 0, isOutlierVariance: false, varianceReviewMinutes: 15,
      shiftReturnCount: 0, incidents: [],
    }
    st.status = 'InProgress'
    st.breaks = []
    return buildPortalShiftDetail(base.id)
  }],
  ['portal/shifts/:id/finish', (id, body) => {
    const base = portalShiftBase[id] || portalShiftBase['shift-0003']
    const st = pkgState(base.id)
    if (currentStatus(base.id) === 'PendingReview') return buildPortalShiftDetail(base.id)   // idempotent replay
    // A shift note is required - or an explicit "nothing to note" confirmation (checked before the handover and the checklist, like the server).
    if (!(shiftNotesByShiftId[base.id] || []).length && !body?.nothingToNote) {
      return respond(409, failEnvelope(null, ['Add a shift note before finishing.'], 'SHIFT_NOTE_REQUIRED'))
    }
    const handoverText = String(body?.handoverText || '').trim() || null
    if (body?.nothingToHandOver && handoverText) {
      return respond(400, failEnvelope(null, ['Write a handover or confirm there is nothing to hand over, not both.'], 'SHIFT_HANDOVER_CONFLICT'))
    }
    const blockers = finishBlockersFor(base.id)
    if (blockers.length > 0) {
      const detail = buildPortalShiftDetail(base.id)
      return respond(422, failEnvelope(detail, blockers.map((x) => x.message), 'SHIFT_FINISH_BLOCKED'))
    }
    const now = new Date().toISOString()
    const started = st.completion || {
      id: `sc-mock-${base.id}`, shiftId: base.id, actualStart: body?.actualStart ?? now, timeZoneId: 'Australia/Brisbane',
      geolocationDeclined: !!body?.geolocationDeclined, startWasManual: !!body?.actualStart,
      submittedByUserId: CURRENT_STAFF_ID, submittedByName: "Jack O'Sullivan", startedAt: now,
      reviewedByUserId: null, reviewedByName: null, reviewedAt: null, reviewOutcome: null, returnReason: null,
      varianceMinutesStart: 3, varianceMinutesEnd: 0, isOutlierVariance: false, varianceReviewMinutes: 15, shiftReturnCount: 0, incidents: [],
    }
    st.completion = {
      ...started, actualEnd: now, submittedAt: now, varianceMinutesEnd: -2,
      handoverText, nothingToHandOver: !!body?.nothingToHandOver, nothingToNoteConfirmed: !!body?.nothingToNote,
    }
    st.status = 'PendingReview'
    return buildPortalShiftDetail(base.id)
  }],
  ['rostering/shifts/:id/completion/approve', (id) => {
    const c = withPackageFields(id, shiftCompletions.find((x) => x.shiftId === id) || shiftCompletions[0])
    return { ...c, reviewedByUserId: 's-0001', reviewedByName: 'Callum Radford', reviewedAt: new Date().toISOString(), reviewOutcome: 'Approved' }
  }],
  ['rostering/shifts/:id/completion/return', (id, body) => {
    const c = withPackageFields(id, shiftCompletions.find((x) => x.shiftId === id) || shiftCompletions[0])
    return {
      ...c, reviewedByUserId: 's-0001', reviewedByName: 'Callum Radford', reviewedAt: new Date().toISOString(),
      reviewOutcome: 'Returned', returnReason: body?.reason ?? '', shiftReturnCount: c.shiftReturnCount + 1,
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
  ...packageRoutesPut,
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

/** Sends a route's result: a respond(status, body) result keeps its status and raw body, anything else is a 200 ok() envelope. */
function sendResult(res, result) {
  if (result && typeof result === 'object' && result[HTTP]) {
    send(res, result[HTTP], result.body)
    return
  }
  send(res, 200, ok(result))
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
        sendResult(res, handler(...params, url.searchParams))
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
          sendResult(res, handler(...params, body))
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
          sendResult(res, handler(...params, body))
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
      for (const [pattern, handler] of packageRoutesDelete) {
        const params = matchRoute(pattern, segments)
        if (params) {
          sendResult(res, handler(...params, body))
          return
        }
      }
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
