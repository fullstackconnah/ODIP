import { plural } from '@/lib/format'

/** Words for the tables a purge deletes from (PurgePlan table names) where splitting the name would read badly. */
const LABELS: Record<string, string> = {
  Participants: 'Participant record',
  EmploymentHeroOutbox: 'Payroll sends',
  ParticipantAdlAssessments: 'ADL assessments',
  ImportBatchItems: 'Import rows',
  NotificationLogs: 'Sent messages',
  NotificationOutbox: 'Queued messages',
  InAppNotifications: 'Bell notices',
  ClaimLineItems: 'Claim lines',
  TripClaims: 'Claims',
  ElectronicSigningSnapshots: 'Signed agreements',
  ElectronicSigningEvidence: 'Signing evidence',
  ParticipantIntakeSnapshots: 'Intake PDFs',
  StaffParticipantCompatibilities: 'Staff matches',
  ParticipantCommunityAccessRiskItems: 'Community access risks',
}

/** "ShiftCompletions" is "Shift completions"; a leading "Participant" is dropped when more words follow ("ParticipantNotes" is "Notes"). */
export function retentionKindLabel(table: string): string {
  const override = LABELS[table]
  if (override) return override
  const words = table.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ')
  if (words[0] === 'Participant' && words.length > 1) words.shift()
  const sentence = words.join(' ').toLowerCase()
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

export interface RetentionKind { table: string; label: string; count: number }

/** The kinds a purge deletes, largest first and then by label; kinds with no rows are left out. */
export function retentionKinds(rowCounts: Record<string, number>): RetentionKind[] {
  return Object.entries(rowCounts)
    .filter(([, count]) => count > 0)
    .map(([table, count]) => ({ table, label: retentionKindLabel(table), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export const retentionTotal = (kinds: RetentionKind[]) => kinds.reduce((sum, k) => sum + k.count, 0)
/** "1,204 records" or "1 record". */
export const recordsText = (n: number) => (n === 1 ? '1 record' : `${n.toLocaleString('en-AU')} records`)
/** "23 kinds" or "1 kind". */
export const kindsText = (n: number) => plural(n, 'kind')
