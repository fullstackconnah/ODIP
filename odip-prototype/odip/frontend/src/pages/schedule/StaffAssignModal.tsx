import React, { useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { formatDate } from './helpers'
import type { ScheduleStaffDto, ScheduleTripDto, CreateStaffAssignmentDto } from '@/api/types'

interface StaffAssignModalProps {
  staff: ScheduleStaffDto
  trip: ScheduleTripDto
  onClose: () => void
  onAssign: (data: CreateStaffAssignmentDto) => void
  isLoading: boolean
}

export default function StaffAssignModal({ staff, trip, onClose, onAssign, isLoading }: StaffAssignModalProps) {
  const [role, setRole] = useState('Support Worker')
  const [isDriver, setIsDriver] = useState(false)
  const [sleepoverType, setSleepoverType] = useState<import('@/api/types').SleepoverType>('None')
  const [shiftNotes, setShiftNotes] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onAssign({
      tripInstanceId: trip.id,
      staffId: staff.id,
      assignmentRole: role,
      assignmentStart: trip.startDate,
      assignmentEnd: trip.endDate,
      isDriver,
      sleepoverType,
      shiftNotes: shiftNotes || undefined,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6" style={{ borderBottom: '1px solid rgba(195,201,181,0.25)' }}>
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
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-[var(--color-surface-container-low)] rounded-[1rem] p-4 space-y-1">
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
              onChange={(val: string) => setSleepoverType(val as import('@/api/types').SleepoverType)}
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
              : <span className="text-[10px] text-[#ba1a1a] font-semibold">(not eligible)</span>
            }
          </label>
          <div>
            <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Shift Notes (optional)</label>
            <textarea
              value={shiftNotes}
              onChange={e => setShiftNotes(e.target.value)}
              rows={2}
              placeholder="E.g. arrive evening before, depart early last day..."
              className="w-full px-4 py-2.5 rounded-[1rem] bg-[var(--color-surface-container-low)] border-none text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 resize-none"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-full bg-[var(--color-surface-container)] text-sm font-semibold hover:bg-[var(--color-surface-container-high)] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isLoading}
              className="flex-1 px-4 py-2.5 rounded-full bg-gradient-to-r from-[#396200] to-[#4d7c0f] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
              {isLoading ? 'Assigning...' : 'Assign Staff'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
