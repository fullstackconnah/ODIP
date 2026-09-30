import { useState, useEffect, useRef } from 'react'
import { Plus, ChevronDown, ChevronRight, Pencil, Trash2, ExternalLink } from 'lucide-react'
import { useGenerateSchedule, useDeleteScheduledActivity } from '@/api/hooks'
import { formatDateAu } from '@/lib/utils'
import AddActivityModal from '@/components/AddActivityModal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
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
    case 'Planned': return 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]'
    case 'Booked': return 'bg-[#fef3c7] text-[#92400e]'
    case 'Confirmed': return 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
    case 'Completed': return 'bg-[var(--color-secondary-container)] text-[#0d1c2e]'
    case 'Cancelled': return 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
    default: return 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]'
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
        <div className="text-[var(--color-muted-foreground)]">
          {generateSchedule.isPending ? (
            <p>Generating schedule...</p>
          ) : generateSchedule.isError ? (
            <div className="space-y-2">
              <p className="text-[var(--color-destructive)]">Failed to generate schedule. The server may need a database update.</p>
              <button onClick={() => { hasTriedGenerate.current = false; generateSchedule.mutate(tripId) }}
                className="px-3 py-1.5 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90">
                Retry
              </button>
            </div>
          ) : (
            <p>No schedule available. Check that the trip has dates configured.</p>
          )}
        </div>
      ) : schedule.map((day: TripDayDto) => (
        <div key={day.id} className="bg-[var(--color-card)] rounded-[var(--radius-md)] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] font-bold text-sm">
                D{day.dayNumber}
              </span>
              <div>
                <h4 className="font-semibold">{day.dayTitle || `Day ${day.dayNumber}`}</h4>
                <p className="text-xs text-[var(--color-muted-foreground)]">{formatDateAu(day.date)}</p>
              </div>
            </div>
            {!isReadOnly && canWrite && (
              <button onClick={() => { setAddActivityDayId(day.id); setShowAddActivity(true) }}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90">
                <Plus className="w-3.5 h-3.5" /> Add Activity
              </button>
            )}
          </div>

          {day.scheduledActivities?.length > 0 ? (
            <div className="space-y-2">
              {day.scheduledActivities.map((a: ScheduledActivityDto) => {
                const isExpanded = expandedActivities.has(a.id)
                return (
                  <div key={a.id} className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)]">
                    <div
                      className="flex items-center gap-3 p-3 cursor-pointer"
                      onClick={() => toggleActivityExpanded(a.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleActivityExpanded(a.id) } }}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-[var(--color-muted-foreground)] shrink-0" /> : <ChevronRight className="w-4 h-4 text-[var(--color-muted-foreground)] shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{a.title}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${getActivityStatusColor(a.status)}`}>{a.status}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-[var(--color-muted-foreground)] mt-0.5">
                          {a.startTime && <span>{a.startTime}{a.endTime && ` – ${a.endTime}`}</span>}
                          {a.location && <span>{a.location}</span>}
                          {a.bookingReference && <span>Ref: {a.bookingReference}</span>}
                        </div>
                      </div>
                      {!isReadOnly && canWrite && (
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <button onClick={() => { setEditingScheduledActivity(a); setAddActivityDayId(a.tripDayId); setShowAddActivity(true) }}
                            className="p-1.5 hover:bg-[var(--color-surface-container)] rounded-lg" title="Edit">
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
                        {a.category && <div><span className="text-[var(--color-muted-foreground)]">Category:</span> {a.category}</div>}
                        {a.estimatedCost != null && <div><span className="text-[var(--color-muted-foreground)]">Est. Cost:</span> ${Number(a.estimatedCost).toFixed(2)}</div>}
                        {a.providerName && <div><span className="text-[var(--color-muted-foreground)]">Provider:</span> {a.providerName}</div>}
                        {a.providerPhone && <div><span className="text-[var(--color-muted-foreground)]">Phone:</span> {a.providerPhone}</div>}
                        {a.providerEmail && <div><span className="text-[var(--color-muted-foreground)]">Email:</span> {a.providerEmail}</div>}
                        {a.providerWebsite && /^https?:\/\//i.test(a.providerWebsite) && (
                          <div><span className="text-[var(--color-muted-foreground)]">Website:</span>{' '}
                            <a href={a.providerWebsite} target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-1">
                              {a.providerWebsite} <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                        {a.accessibilityNotes && <div><span className="text-[var(--color-muted-foreground)]">Accessibility:</span> {a.accessibilityNotes}</div>}
                        {a.notes && <div><span className="text-[var(--color-muted-foreground)]">Notes:</span> {a.notes}</div>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted-foreground)] italic">No activities scheduled</p>
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

      <ConfirmDialog
        open={deletingActivity !== null}
        onCancel={() => setDeletingActivity(null)}
        onConfirm={() => {
          if (!deletingActivity) return
          deleteScheduledActivity.mutate(deletingActivity.id, { onSuccess: () => setDeletingActivity(null) })
        }}
        title="Delete Activity"
        message={
          <>
            <p>
              Are you sure you want to delete{' '}
              <span className="font-medium text-[var(--color-foreground)]">{deletingActivity?.title}</span>? This cannot be undone.
            </p>
            {deleteScheduledActivity.isError && (
              <p className="text-[var(--color-destructive)]">Something went wrong. Please try again.</p>
            )}
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteScheduledActivity.isPending}
      />
    </div>
  )
}
