import { useState, useEffect, useRef } from 'react'
import { Plus, ChevronDown, ChevronRight, Pencil, Trash2, ExternalLink, X } from 'lucide-react'
import { useGenerateSchedule, useDeleteScheduledActivity } from '@/api/hooks'
import { formatDateAu } from '@/lib/utils'
import AddActivityModal from '@/components/AddActivityModal'
import type { TripDetailDto } from '@/api/types/trips'
import type { TripDayDto, ScheduledActivityDto } from '@/api/types/activities'

interface ActivitiesTabProps {
  tripId: string
  trip: TripDetailDto
  schedule: TripDayDto[]
  canWrite: boolean
  isReadOnly: boolean
}

const getActivityStatusColor = (status: string) => {
  switch (status) {
    case 'Planned': return 'bg-[#e4e2de] text-[#43493a]'
    case 'Booked': return 'bg-[#fef3c7] text-[#92400e]'
    case 'Confirmed': return 'bg-[#bbf37c] text-[#0f2000]'
    case 'Completed': return 'bg-[#d5e3fc] text-[#0d1c2e]'
    case 'Cancelled': return 'bg-[#ffdad6] text-[#93000a]'
    default: return 'bg-[#e4e2de] text-[#43493a]'
  }
}

export default function ActivitiesTab({ tripId, trip, schedule, canWrite, isReadOnly }: ActivitiesTabProps) {
  const generateSchedule = useGenerateSchedule()
  const deleteScheduledActivity = useDeleteScheduledActivity()
  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(new Set())
  const [showAddActivity, setShowAddActivity] = useState(false)
  const [editingScheduledActivity, setEditingScheduledActivity] = useState<ScheduledActivityDto | null>(null)
  const [addActivityDayId, setAddActivityDayId] = useState('')
  const [deletingActivity, setDeletingActivity] = useState<ScheduledActivityDto | null>(null)

  // Auto-generate trip days when tab is opened
  const hasTriedGenerate = useRef(false)
  useEffect(() => {
    if (!tripId || !trip || schedule.length > 0 || generateSchedule.isPending || hasTriedGenerate.current) return
    hasTriedGenerate.current = true
    generateSchedule.mutate(tripId)
  }, [tripId, schedule.length, trip])

  const toggleActivityExpanded = (activityId: string) => {
    setExpandedActivities(prev => {
      const next = new Set(prev)
      if (next.has(activityId)) next.delete(activityId)
      else next.add(activityId)
      return next
    })
  }

  return (
    <div className="space-y-4">
      {schedule.length === 0 ? (
        <div className="text-[#43493a]">
          {generateSchedule.isPending ? (
            <p>Generating schedule...</p>
          ) : generateSchedule.isError ? (
            <div className="space-y-2">
              <p className="text-[#ba1a1a]">Failed to generate schedule. The server may need a database update.</p>
              <button onClick={() => { hasTriedGenerate.current = false; generateSchedule.mutate(tripId) }}
                className="px-3 py-1.5 text-sm bg-[#396200] text-white rounded-lg hover:opacity-90">
                Retry
              </button>
            </div>
          ) : (
            <p>No schedule available. Check that the trip has dates configured.</p>
          )}
        </div>
      ) : schedule.map((day: TripDayDto) => (
        <div key={day.id} className="bg-white rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-lg bg-[#396200]/10 flex items-center justify-center text-[#396200] font-bold text-sm">
                D{day.dayNumber}
              </span>
              <div>
                <h4 className="font-semibold">{day.dayTitle || `Day ${day.dayNumber}`}</h4>
                <p className="text-xs text-[#43493a]">{formatDateAu(day.date)}</p>
              </div>
            </div>
            {!isReadOnly && canWrite && (
              <button onClick={() => { setAddActivityDayId(day.id); setShowAddActivity(true) }}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-[#396200] text-white rounded-lg hover:opacity-90">
                <Plus className="w-3.5 h-3.5" /> Add Activity
              </button>
            )}
          </div>

          {day.scheduledActivities?.length > 0 ? (
            <div className="space-y-2">
              {day.scheduledActivities.map((a: ScheduledActivityDto) => {
                const isExpanded = expandedActivities.has(a.id)
                return (
                  <div key={a.id} className="bg-[#f5f3ef] rounded-2xl">
                    <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => toggleActivityExpanded(a.id)}>
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-[#43493a] shrink-0" /> : <ChevronRight className="w-4 h-4 text-[#43493a] shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{a.title}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${getActivityStatusColor(a.status)}`}>{a.status}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-[#43493a] mt-0.5">
                          {a.startTime && <span>{a.startTime}{a.endTime && ` – ${a.endTime}`}</span>}
                          {a.location && <span>{a.location}</span>}
                          {a.bookingReference && <span>Ref: {a.bookingReference}</span>}
                        </div>
                      </div>
                      {!isReadOnly && canWrite && (
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <button onClick={() => { setEditingScheduledActivity(a); setAddActivityDayId(a.tripDayId); setShowAddActivity(true) }}
                            className="p-1.5 hover:bg-[#efeeea] rounded-lg" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setDeletingActivity(a)}
                            className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg text-red-500" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-0 border-t border-[rgba(195,201,181,0.15)] ml-7 space-y-2 text-sm">
                        {a.category && <div><span className="text-[#43493a]">Category:</span> {a.category}</div>}
                        {a.estimatedCost != null && <div><span className="text-[#43493a]">Est. Cost:</span> ${Number(a.estimatedCost).toFixed(2)}</div>}
                        {a.providerName && <div><span className="text-[#43493a]">Provider:</span> {a.providerName}</div>}
                        {a.providerPhone && <div><span className="text-[#43493a]">Phone:</span> {a.providerPhone}</div>}
                        {a.providerEmail && <div><span className="text-[#43493a]">Email:</span> {a.providerEmail}</div>}
                        {a.providerWebsite && /^https?:\/\//i.test(a.providerWebsite) && (
                          <div><span className="text-[#43493a]">Website:</span>{' '}
                            <a href={a.providerWebsite} target="_blank" rel="noopener noreferrer" className="text-[#396200] hover:underline inline-flex items-center gap-1">
                              {a.providerWebsite} <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                        {a.accessibilityNotes && <div><span className="text-[#43493a]">Accessibility:</span> {a.accessibilityNotes}</div>}
                        {a.notes && <div><span className="text-[#43493a]">Notes:</span> {a.notes}</div>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-[#43493a] italic">No activities scheduled</p>
          )}
        </div>
      ))}

      {showAddActivity && (
        <AddActivityModal
          tripDayId={addActivityDayId}
          editingActivity={editingScheduledActivity ?? undefined}
          eventTemplateId={trip?.eventTemplateId ?? undefined}
          onClose={() => { setShowAddActivity(false); setEditingScheduledActivity(null); setAddActivityDayId('') }}
        />
      )}

      {deletingActivity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeletingActivity(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">Delete Activity</h3>
              <button onClick={() => setDeletingActivity(null)} className="p-1 rounded hover:bg-[#efeeea] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-[#43493a]">
              Are you sure you want to delete <span className="font-medium text-[#1b1c1a]">{deletingActivity.title}</span>? This cannot be undone.
            </p>
            {deleteScheduledActivity.isError && (
              <p className="text-sm text-[#ba1a1a] mt-3">Something went wrong. Please try again.</p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setDeletingActivity(null)}
                className="px-4 py-2 text-sm rounded-2xl bg-[#f5f3ef] hover:bg-[#efeeea]">
                Cancel
              </button>
              <button
                onClick={() => deleteScheduledActivity.mutate(deletingActivity.id, { onSuccess: () => setDeletingActivity(null) })}
                disabled={deleteScheduledActivity.isPending}
                className="px-4 py-2 text-sm rounded-full bg-[#ba1a1a] text-white hover:opacity-90 disabled:opacity-50">
                {deleteScheduledActivity.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
