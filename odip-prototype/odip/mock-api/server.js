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
]

// Incidents (IncidentListDto)
const incidents = [
  {
    id: 'inc-0001', tripInstanceId: 't-0004', tripName: 'Byron Bay Winter Weekender',
    incidentType: 'Injury', severity: 'Low', status: 'Closed',
    title: 'Minor graze from beach walk slip',
    incidentDateTime: '2026-07-11T10:45:00Z', location: 'Main Beach boardwalk, Byron Bay',
    reportedByName: "Jack O'Sullivan", involvedParticipantName: 'Liam Okafor',
    qscReportingStatus: 'NotRequired', isOverdue24h: false, createdAt: '2026-07-11T11:30:00Z',
  },
  {
    id: 'inc-0002', tripInstanceId: 't-0004', tripName: 'Byron Bay Winter Weekender',
    incidentType: 'MedicationError', severity: 'Medium', status: 'UnderReview',
    title: 'Missed evening medication dose',
    incidentDateTime: '2026-07-11T20:15:00Z', location: 'Accommodation — Byron Bay',
    reportedByName: 'Mei Zhang', involvedParticipantName: 'Grace Palmer-Hughes',
    qscReportingStatus: 'ReportedWithin24h', isOverdue24h: false, createdAt: '2026-07-11T21:05:00Z',
  },
  {
    id: 'inc-0003', tripInstanceId: 't-0001', tripName: 'Sunshine Coast Beach Escape',
    incidentType: 'BehaviourOfConcern', severity: 'High', status: 'Submitted',
    title: 'Escalation during pre-trip meet and greet',
    incidentDateTime: '2026-07-29T14:00:00Z', location: 'Head office, Brisbane',
    reportedByName: 'Callum Radford', involvedParticipantName: 'Grace Palmer-Hughes',
    qscReportingStatus: 'Pending', isOverdue24h: true, createdAt: '2026-07-29T16:20:00Z',
  },
]

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
  },
}

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

// ── Routing ──────────────────────────────────────────────────

// Routes checked in order. :id captures a path segment.
const routes = [
  ['dashboard/summary', () => dashboardSummary],

  // participants (paged list)
  ['participants', () => paged(participants)],
  ['participants/:id/bookings', (id) => bookings.filter((b) => b.participantId === id)],
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
  ['incidents', () => incidents],
  ['incidents/:id', (id) => {
    const i = incidents.find((x) => x.id === id) || incidents[0]
    return { ...i, ...(incidentDetailExtras[i.id] || {}) }
  }],

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
  // `status`/`userId` query string here: the GET dispatch loop below never passes url.searchParams
  // into the handler (unlike the path-segment `:id` params other routes use), so there's nothing
  // to read a filter off without changing that dispatch loop for every other GET route too. Returns
  // the full fixture list; the frontend pages that read it don't rely on the mock filtering
  // (LeaveApprovalsPage/PortalLeavePage render off whatever the hook returns either way).
  ['leave', () => leaveRequests],
  ['leave/unavailability', () => recurringUnavailabilities],
  ['portal/leave', () => ({
    leave: leaveRequests.filter((r) => r.userId === CURRENT_STAFF_ID),
    unavailability: recurringUnavailabilities.filter((r) => r.userId === CURRENT_STAFF_ID),
  })],
]

// POST routes needing a specific response shape rather than the generic echo-body-back fallback
// (see the POST handler below) — status-transition endpoints that must return the fixture row
// with its new status/decision fields, plus the one pure-preview endpoint (staff-assignments/check)
// that must return an array of findings, not an echoed object.
const postRoutes = [
  ['staff-assignments/check', () => []],

  ['leave/:id/approve', (id) => ({
    leave: withDecision(leaveRequests.find((r) => r.id === id) || leaveRequests[0], 'Approved', null),
    overlaps: [],
  })],
  ['leave/:id/decline', (id, body) =>
    withDecision(leaveRequests.find((r) => r.id === id) || leaveRequests[0], 'Declined', body?.decisionNote ?? null)],
  ['leave/:id/cancel', (id) =>
    withDecision(leaveRequests.find((r) => r.id === id) || leaveRequests[0], 'Cancelled', null)],
  ['portal/leave/:id/cancel', (id) =>
    withDecision(leaveRequests.find((r) => r.id === id) || leaveRequests[0], 'Cancelled', null)],

  ['leave/unavailability/:id/approve', (id) => ({
    unavailability: withDecision(recurringUnavailabilities.find((r) => r.id === id) || recurringUnavailabilities[0], 'Approved', null),
    overlaps: [],
  })],
  ['leave/unavailability/:id/decline', (id, body) =>
    withDecision(recurringUnavailabilities.find((r) => r.id === id) || recurringUnavailabilities[0], 'Declined', body?.decisionNote ?? null)],
  ['leave/unavailability/:id/cancel', (id) =>
    withDecision(recurringUnavailabilities.find((r) => r.id === id) || recurringUnavailabilities[0], 'Cancelled', null)],
  ['portal/unavailability/:id/cancel', (id) =>
    withDecision(recurringUnavailabilities.find((r) => r.id === id) || recurringUnavailabilities[0], 'Cancelled', null)],
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
        send(res, 200, ok(handler(...params)))
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
