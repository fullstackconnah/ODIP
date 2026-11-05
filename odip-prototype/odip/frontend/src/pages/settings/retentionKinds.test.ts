import { describe, expect, it } from 'vitest'
import { kindsText, recordsText, retentionKindLabel, retentionKinds } from './retentionKinds'

// A copy of PurgePlan's table names (2a). A new step with an ugly label fails here, so it gets an override.
const TABLES = `BookingTasks Complaints IncidentWitnesses IncidentInjuries IncidentReports TripDocuments ClaimBatchLines InvoiceLines Invoices ClaimLineItems
TripClaims ShiftRoutineChecks ShiftBreaks HandoverAcknowledgements EmploymentHeroOutbox ShiftCompletions ShiftNotes Shifts ShiftPatterns
StaffParticipantCompatibilities MedicationAdministrations RestrictivePracticeMonthlyReports RestrictivePractices ParticipantMedications
ServiceAgreementShares ServiceAgreementDraftApprovals ServiceAgreementDraftBlocks ServiceAgreementDraftLines ServiceAgreementDrafts
ElectronicSigningEvidence ElectronicSigningSnapshots FundingPeriods FundingPools FundingPlans ParticipantBookings ParticipantRoutines ParticipantNotes
ParticipantRiskEntries ParticipantConsents ParticipantHealthConditions ParticipantAdlAssessments ParticipantChecklistItems
ParticipantCommunityAccessRiskItems ParticipantContactRoles CaregiverProfileSubmissions ParticipantContacts SupportProfiles ParticipantIntakeSnapshots
ParticipantOnboardings InquiryContacts ParticipantInquiries ParticipantGroupRevisions ImportBatchItems NotificationLogs NotificationOutbox
InAppNotifications Participants`.split(/\s+/)

describe('retentionKindLabel', () => {
  it('splits camel case into sentence case and drops a leading Participant', () => {
    expect(retentionKindLabel('ShiftCompletions')).toBe('Shift completions')
    expect(retentionKindLabel('ParticipantNotes')).toBe('Notes')
    expect(retentionKindLabel('Shifts')).toBe('Shifts')
  })

  it('uses the override where the split would read badly', () => {
    expect(retentionKindLabel('Participants')).toBe('Participant record')
    expect(retentionKindLabel('ClaimLineItems')).toBe('Claim lines')
    expect(retentionKindLabel('ParticipantIntakeSnapshots')).toBe('Intake PDFs')
  })

  it('gives every table a sentence-case label (capitals only in ADL and PDFs)', () => {
    for (const table of TABLES) {
      const label = retentionKindLabel(table)
      expect(label.replace('ADL', 'A').replace('PDFs', 'p').slice(1), table).not.toMatch(/[A-Z]/)
    }
  })
})

describe('retentionKinds', () => {
  it('sorts by count, largest first, then by label, and leaves out empty kinds', () => {
    const kinds = retentionKinds({ ShiftNotes: 310, Shifts: 820, ClaimLineItems: 60, Invoices: 60, Complaints: 0 })
    expect(kinds.map((k) => [k.label, k.count])).toEqual([['Shifts', 820], ['Shift notes', 310], ['Claim lines', 60], ['Invoices', 60]])
  })
})

describe('counts in words', () => {
  it('agrees with the number', () => {
    expect(recordsText(1)).toBe('1 record')
    expect(recordsText(1204)).toBe('1,204 records')
    expect(kindsText(1)).toBe('1 kind')
    expect(kindsText(9)).toBe('9 kinds')
  })
})
