import type { UseQueryResult } from '@tanstack/react-query'
import { apiGet } from '@/api/client'
import { useUpdateStaff } from '@/api/hooks'
import { toUpdateStaffDto, type StaffDetailDto, type StaffListDto } from '@/api/types/staff'
import { staffCredentials, type StaffCredential } from '@/lib/credentials'
import { DEADLINE_TONE, deadlineLabel, deadlineState, isDeadlineIssue } from '@/lib/deadline'
import { formatDateRange, formatDayMonth } from '@/lib/dateRange'
import { plural } from '@/lib/format'
import { groupPhase, noBreak, type GroupModel, type QuickRow } from '../quickGroupModel'

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
export function useComplianceGroup(enabled: boolean, { staff, today, warningDays, mayEditAdmins }: {
  staff: UseQueryResult<StaffListDto[]>
  today: string
  warningDays: number
  /** Only an Admin or SuperAdmin may save an Admin's record (the server's role guard refuses anyone else, even with the role unchanged). */
  mayEditAdmins: boolean
}): GroupModel {
  const updateStaff = useUpdateStaff()
  const issues = enabled ? complianceIssues(staff.data ?? [], { warnDays: warningDays, today }) : []

  const rows = issues.map(({ member, credential }): QuickRow => {
    const name = credential.label.toLowerCase()
    const status = credential.state.status
    const verb = credential.expiryDate ? 'Update' : 'Add'
    // An Admin's record is saved by an Admin: a Coordinator opens the person instead of an editor every save of which the server refuses.
    const adminOnly = member.role === 'Admin' && !mayEditAdmins
    return {
      id: `${member.id}:${credential.field}`,
      subject: member.fullName,
      meta: [
        credential.label,
        status === 'overdue' && noBreak(`expired ${formatDayMonth(credential.expiryDate)}`),
        status === 'soon' && noBreak(`expires ${formatDayMonth(credential.expiryDate)}`),
        adminOnly && 'An admin updates this',
      ],
      flags: [{ label: deadlineLabel(credential.state, 'compact'), tone: DEADLINE_TONE[status] }],
      actions: adminOnly ? [{ kind: 'link', label: 'Open', name: `Open staff member: ${member.fullName}`, to: `/staff/${member.id}` }] : [{ kind: 'form', label: `${verb} expiry`, name: `${verb} expiry: ${member.fullName}, ${name}`, form: {
        field: 'date', label: 'Expiry date', initial: credential.expiryDate?.slice(0, 10) ?? '', required: 'Choose the expiry date.',
        submitLabel: 'Save', busyLabel: 'Saving…', failText: "Couldn't save. Try again.",
        submit: async (date) => {
          // The PUT rewrites the whole staff record, so it is built from the record as it is NOW, read fresh: the list may be hours old, and a stale body would
          // undo an archive or a role change made since (deep S1).
          const fresh = await apiGet<StaffDetailDto>(`/staff/${member.id}`)
          await updateStaff.mutateAsync({ id: member.id, data: toUpdateStaffDto(fresh, { [credential.field]: date }) })
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
