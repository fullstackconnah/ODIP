import { useEffect, useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { formatDate } from './helpers'
import { useCheckStaffAssignment, getRosterFindings } from '@/api/hooks'
import { RosterGateFields } from '@/pages/rostering/components/RosterGateFields'
import { getRosterGate } from '@/pages/rostering/lib/rosterGate'
import type { ScheduleStaffDto, ScheduleTripDto, CreateStaffAssignmentDto, RosterFindingDto, SleepoverType } from '@/api/types'

interface StaffAssignModalProps {
  staff: ScheduleStaffDto
  trip: ScheduleTripDto
  onClose: () => void
  onAssign: (data: CreateStaffAssignmentDto) => Promise<void>
  isLoading: boolean
}

export default function StaffAssignModal({ staff, trip, onClose, onAssign, isLoading }: StaffAssignModalProps) {
  const [role, setRole] = useState('Support Worker')
  const [isDriver, setIsDriver] = useState(false)
  const [sleepoverType, setSleepoverType] = useState<SleepoverType>('None')
  const [shiftNotes, setShiftNotes] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [findings, setFindings] = useState<RosterFindingDto[]>([])
  const [reasonRequired, setReasonRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkAssignment = useCheckStaffAssignment()

  // Live dry-run: staff and trip are fixed props for this modal's whole lifetime (no editable
  // staff/date fields here, unlike ShiftSlideOver) — one un-debounced check on mount is enough.
  // Never writes — POST /staff-assignments/check is a pure preview.
  useEffect(() => {
    checkAssignment.mutate(
      { staffId: staff.id, tripInstanceId: trip.id, assignmentStart: trip.startDate, assignmentEnd: trip.endDate },
      { onSuccess: setFindings },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff.id, trip.id, trip.startDate, trip.endDate])

  const gate = getRosterGate(findings)
  const isBusy = isLoading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (gate.isBlocked) return
    if (gate.needsReason && !overrideReason.trim()) {
      setReasonRequired(true)
      return
    }
    setReasonRequired(false)

    try {
      await onAssign({
        tripInstanceId: trip.id,
        staffId: staff.id,
        assignmentRole: role,
        assignmentStart: trip.startDate,
        assignmentEnd: trip.endDate,
        isDriver,
        sleepoverType,
        shiftNotes: shiftNotes || undefined,
        overrideReason: overrideReason.trim() || undefined,
        acknowledgedFindingCodes: findings.map(f => f.code),
      })
    } catch (err: unknown) {
      const serverFindings = getRosterFindings(err)
      if (serverFindings) {
        setFindings(serverFindings)
        if (getRosterGate(serverFindings).needsReason && !overrideReason.trim()) setReasonRequired(true)
      } else {
        setError('Something went wrong assigning this staff member. Please try again.')
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-[var(--radius-lg)] shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex h-12 items-center justify-between px-4" style={{ borderBottom: '1px solid rgba(195,201,181,0.25)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[var(--color-primary-fixed)]/30 flex items-center justify-center">
              <UserPlus className="w-4 h-4 text-[var(--color-primary)]" />
            </div>
            <h3 className="font-display font-bold text-base">Assign Staff</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-[var(--color-surface-container)] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-[var(--section-gap)]">
          <div className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)] p-[var(--card-pad)] space-y-1">
            <div className="text-sm font-bold">{staff.fullName}</div>
            <div className="text-xs text-[var(--color-muted-foreground)]">→ {trip.tripName}</div>
            <div className="text-xs text-[var(--color-muted-foreground)]">
              {formatDate(trip.startDate)} — {formatDate(trip.endDate)} ({trip.durationDays} days)
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Assignment Role</label>
            <Dropdown
              variant="form"
              value={role}
              onChange={setRole}
              items={[
                { value: 'Support Worker', label: 'Support Worker' },
                { value: 'Senior Support Worker', label: 'Senior Support Worker' },
                { value: 'Lead Coordinator', label: 'Lead Coordinator' },
                { value: 'Team Leader', label: 'Team Leader' },
                { value: 'Senior Support / Driver', label: 'Senior Support / Driver' },
                { value: 'Driver', label: 'Driver' },
              ]}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Sleepover Type</label>
            <Dropdown
              variant="form"
              value={sleepoverType}
              onChange={(val: string) => setSleepoverType(val as SleepoverType)}
              items={[
                { value: 'None', label: 'None' },
                { value: 'ActiveNight', label: 'Active Night' },
                { value: 'PassiveNight', label: 'Passive Night' },
                { value: 'Sleepover', label: 'Sleepover' },
              ]}
            />
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isDriver}
              onChange={e => setIsDriver(e.target.checked)}
              className="w-4 h-4 rounded accent-[var(--color-primary)]"
            />
            <span className="text-sm font-medium">Assigned as driver</span>
            {staff.isDriverEligible
              ? <span className="text-[10px] text-[var(--color-primary)] font-semibold">(eligible)</span>
              : <span className="text-[10px] text-[var(--color-destructive)] font-semibold">(not eligible)</span>
            }
          </label>
          <div>
            <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Shift Notes (optional)</label>
            <textarea
              value={shiftNotes}
              onChange={e => setShiftNotes(e.target.value)}
              rows={2}
              placeholder="E.g. arrive evening before, depart early last day..."
              className="w-full px-4 py-2.5 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border-none text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] resize-none"
            />
          </div>

          <RosterGateFields
            findings={findings}
            overrideReason={overrideReason}
            onOverrideReasonChange={setOverrideReason}
            reasonRequired={reasonRequired}
          />

          {error && (
            <div role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-error-container)]/50 px-3 py-2 text-sm text-[var(--color-destructive)]">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-full bg-[var(--color-surface-container)] text-sm font-semibold hover:bg-[var(--color-surface-container-high)] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isBusy || gate.isBlocked}
              className="flex-1 px-4 py-2.5 rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-container)] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
              {isBusy ? 'Assigning...' : gate.needsReason ? 'Assign with override' : 'Assign Staff'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
