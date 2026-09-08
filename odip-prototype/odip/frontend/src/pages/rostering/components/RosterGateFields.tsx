import { useId } from 'react'
import { FindingsList } from './FindingsList'
import { getRosterGate } from '../lib/rosterGate'
import type { RosterFindingDto } from '@/api/types'

export interface RosterGateFieldsProps {
  findings: RosterFindingDto[]
  overrideReason: string
  onOverrideReasonChange: (value: string) => void
  reasonRequired: boolean
}

/**
 * The findings list + conditional override-reason textarea + blocking-finding message every
 * roster-checked write form renders around its own fields. Shared by StaffAssignModal (the
 * "Assign Staff" modal, schedule page) and both of StaffTab's modals (Add Staff and inline "Edit
 * Assignment", trip detail page) so the forms can't drift — see
 * docs/specs/2026-09-07-staff-leave-unavailability-design.md §3. The override-reason textarea's
 * id is instance-scoped (useId), so multiple instances can be mounted at once without breaking
 * their label association.
 */
export function RosterGateFields({ findings, overrideReason, onOverrideReasonChange, reasonRequired }: RosterGateFieldsProps) {
  const reasonId = useId()
  const { reasonRequiredFindings, blockingFindings } = getRosterGate(findings)

  return (
    <>
      {findings.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Findings</p>
          <FindingsList findings={findings} />
        </div>
      )}

      {reasonRequiredFindings.length > 0 && (
        <div>
          <label htmlFor={reasonId} className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">
            Reason for override{reasonRequired && <span role="alert" className="text-[#ba1a1a]"> — enter a reason to continue</span>}
          </label>
          <textarea
            id={reasonId}
            value={overrideReason}
            onChange={e => onOverrideReasonChange(e.target.value)}
            rows={2}
            placeholder="Why this assignment should proceed despite the warnings above"
            className="w-full px-4 py-2.5 rounded-[1rem] bg-[var(--color-surface-container-low)] border-none text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] resize-none"
          />
        </div>
      )}

      {blockingFindings.length > 0 && (
        <p role="alert" className="text-sm font-medium text-[#ba1a1a]">
          This assignment can't be saved while a blocking finding is open.
        </p>
      )}
    </>
  )
}
