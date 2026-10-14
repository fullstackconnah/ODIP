import type { UseQueryResult } from '@tanstack/react-query'
import { useUpdateStaff } from '@/api/hooks'
import { toUpdateStaffDto, type StaffListDto } from '@/api/types/staff'
import { staffCredentials, type StaffCredential } from '@/lib/credentials'
import { DEADLINE_TONE, deadlineLabel, deadlineState, isDeadlineIssue } from '@/lib/deadline'
import { formatDateRange, formatDayMonth } from '@/lib/dateRange'
import { plural } from '@/lib/format'
import { groupPhase, type GroupModel, type QuickRow } from '../quickGroupModel'

const ORDER = { overdue: 0, today: 1, soon: 2, none: 3, ok: 4 } as const

/**
 * One entry per credential that needs action: the Qualifications rule (lib/credentials.ts), so the count is the old tile's figure. Expired first (the
 * longest expired first), then due today, then the soonest, then undated.
 */
export function complianceIssues(staff: StaffListDto[], options: { warnDays: number; today: string }): Array<{ member: StaffListDto; credential: StaffCredential }> {
  return staff
    .flatMap((member) => staffCredentials(member, options).filter((c) => isDeadlineIssue(c.state)).map((credential) => ({ member, credential })))
    .sort((a, b) => ORDER[a.credential.state.status] - ORDER[b.credential.state.status] || (a.credential.state.days ?? 0) - (b.credential.state.days ?? 0))
}

/** The Staff compliance group (SHAPE §5): credentials expired or due within the warning window, fixed with the Qualifications page's own save. */
export function useComplianceGroup(enabled: boolean, { staff, today, warningDays }: {
  staff: UseQueryResult<StaffListDto[]>
  today: string
  warningDays: number
}): GroupModel {
  const updateStaff = useUpdateStaff()
  const issues = enabled ? complianceIssues(staff.data ?? [], { warnDays: warningDays, today }) : []

  const rows = issues.map(({ member, credential }): QuickRow => {
    const name = credential.label.toLowerCase()
    const status = credential.state.status
    const verb = credential.expiryDate ? 'Update' : 'Add'
    return {
      id: `${member.id}:${credential.field}`,
      subject: member.fullName,
      meta: [
        credential.label,
        status === 'overdue' && `expired ${formatDayMonth(credential.expiryDate)}`,
        status === 'soon' && `expires ${formatDayMonth(credential.expiryDate)}`,
      ],
      flags: [{ label: deadlineLabel(credential.state, 'compact'), tone: DEADLINE_TONE[status] }],
      actions: [{ kind: 'form', label: `${verb} expiry`, name: `${verb} expiry: ${member.fullName}, ${name}`, form: {
        field: 'date', label: 'Expiry date', initial: credential.expiryDate?.slice(0, 10) ?? '', required: 'Choose the expiry date.',
        submitLabel: 'Save', busyLabel: 'Saving…', failText: "Couldn't save. Try again.",
        submit: async (date) => {
          // The PUT rewrites the whole staff record: built from the full record the staff list holds, never from the row (SHAPE §5).
          await updateStaff.mutateAsync({ id: member.id, data: toUpdateStaffDto(member, { [credential.field]: date }) })
          const next = deadlineState(date, { warnDays: warningDays, today })
          const still = isDeadlineIssue(next)
          const tail = !still ? '' : next.status === 'overdue' ? ' It has already expired.' : ` It's still due within ${plural(warningDays, 'day')}.`
          return { keep: still, announce: `Saved ${member.fullName}'s ${name}: expires ${formatDateRange(date, date)}.${tail}` }
        },
      } }],
    }
  })

  return {
    key: 'compliance',
    title: 'Staff compliance',
    noun: 'staff credentials to update',
    phase: groupPhase(staff),
    refetch: () => { void staff.refetch() },
    count: rows.length,
    rows,
    link: { to: '/qualifications', openLabel: 'Open Qualifications' },
  }
}
