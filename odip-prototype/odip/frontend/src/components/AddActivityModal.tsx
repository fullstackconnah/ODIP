import { useState, useEffect } from 'react'
import { useActivities, useCreateScheduledActivity, useUpdateScheduledActivity } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { Dropdown } from './Dropdown'
import type { ActivityDto, ScheduledActivityDto, CreateScheduledActivityDto, UpdateScheduledActivityDto } from '@/api/types'
import type { ScheduledActivityStatus } from '@/api/types/enums'

interface AddActivityModalProps {
  tripDayId: string
  editingActivity?: ScheduledActivityDto
  eventTemplateId?: string
  onClose: () => void
}

const STATUS_OPTIONS = ['Planned', 'Booked', 'Confirmed', 'Completed', 'Cancelled'] as const

export default function AddActivityModal({ tripDayId, editingActivity, eventTemplateId, onClose }: AddActivityModalProps) {
  const [sourceTab, setSourceTab] = useState<'library' | 'custom'>(editingActivity ? 'custom' : 'library')
  const [selectedActivityId, setSelectedActivityId] = useState('')

  const [title, setTitle] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [location, setLocation] = useState('')
  const [status, setStatus] = useState('Planned')
  const [bookingReference, setBookingReference] = useState('')
  const [estimatedCost, setEstimatedCost] = useState('')
  const [providerName, setProviderName] = useState('')
  const [providerPhone, setProviderPhone] = useState('')
  const [providerEmail, setProviderEmail] = useState('')
  const [providerWebsite, setProviderWebsite] = useState('')
  const [accessibilityNotes, setAccessibilityNotes] = useState('')
  const [notes, setNotes] = useState('')
  const [timeError, setTimeError] = useState('')

  const { data: activities = [] } = useActivities()
  const createActivity = useCreateScheduledActivity()
  const updateActivity = useUpdateScheduledActivity()

  const filteredActivities = eventTemplateId
    ? activities.filter((a: ActivityDto) => a.isActive && (!a.eventTemplateId || a.eventTemplateId === eventTemplateId))
    : activities.filter((a: ActivityDto) => a.isActive)

  useEffect(() => {
    if (editingActivity) {
      setTitle(editingActivity.title || '')
      setStartTime(editingActivity.startTime || '')
      setEndTime(editingActivity.endTime || '')
      setLocation(editingActivity.location || '')
      setStatus(editingActivity.status || 'Planned')
      setBookingReference(editingActivity.bookingReference || '')
      setEstimatedCost(editingActivity.estimatedCost != null ? String(editingActivity.estimatedCost) : '')
      setProviderName(editingActivity.providerName || '')
      setProviderPhone(editingActivity.providerPhone || '')
      setProviderEmail(editingActivity.providerEmail || '')
      setProviderWebsite(editingActivity.providerWebsite || '')
      setAccessibilityNotes(editingActivity.accessibilityNotes || '')
      setNotes(editingActivity.notes || '')
      if (editingActivity.activityId) {
        setSelectedActivityId(editingActivity.activityId)
        setSourceTab('library')
      }
    }
  }, [editingActivity])

  const handleLibrarySelect = (activityId: string) => {
    setSelectedActivityId(activityId)
    const a = activities.find((act: ActivityDto) => act.id === activityId)
    if (a) {
      setTitle(a.activityName)
      setLocation(a.location || '')
      setAccessibilityNotes(a.accessibilityNotes || '')
    }
  }

  const handleSubmit = () => {
    if (startTime && endTime && endTime <= startTime) {
      setTimeError('End time must be after start time')
      return
    }
    setTimeError('')

    const activityId = editingActivity
      ? (editingActivity.activityId ?? undefined)
      : (sourceTab === 'library' && selectedActivityId ? selectedActivityId : undefined)
    const sortOrder = editingActivity?.sortOrder ?? 0

    if (editingActivity) {
      const data: UpdateScheduledActivityDto = {
        activityId,
        title,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        location: location || undefined,
        status: status as ScheduledActivityStatus,
        bookingReference: bookingReference || undefined,
        estimatedCost: estimatedCost ? parseFloat(estimatedCost) : undefined,
        providerName: providerName || undefined,
        providerPhone: providerPhone || undefined,
        providerEmail: providerEmail || undefined,
        providerWebsite: providerWebsite || undefined,
        accessibilityNotes: accessibilityNotes || undefined,
        notes: notes || undefined,
        sortOrder,
      }
      updateActivity.mutate({ id: editingActivity.id, data }, { onSuccess: () => onClose() })
    } else {
      const data: CreateScheduledActivityDto = {
        activityId,
        title,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        location: location || undefined,
        status: status as ScheduledActivityStatus,
        bookingReference: bookingReference || undefined,
        estimatedCost: estimatedCost ? parseFloat(estimatedCost) : undefined,
        providerName: providerName || undefined,
        providerPhone: providerPhone || undefined,
        providerEmail: providerEmail || undefined,
        providerWebsite: providerWebsite || undefined,
        accessibilityNotes: accessibilityNotes || undefined,
        notes: notes || undefined,
        sortOrder,
      }
      createActivity.mutate({ tripDayId, data }, { onSuccess: () => onClose() })
    }
  }

  const isSubmitting = createActivity.isPending || updateActivity.isPending

  const inputClass = "w-full px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
  const labelClass = "block text-sm font-medium mb-1"

  return (
    <Modal
      open
      onClose={onClose}
      title={editingActivity ? 'Edit Activity' : 'Add Activity'}
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]">Cancel</button>
          <button onClick={handleSubmit} disabled={!title.trim() || isSubmitting}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50">
            {isSubmitting ? 'Saving...' : editingActivity ? 'Update' : 'Add Activity'}
          </button>
        </>
      }
    >

        {!editingActivity && (
          <div className="flex gap-1 mb-4 bg-[var(--color-surface)] rounded-lg p-1">
            {(['library', 'custom'] as const).map(tab => (
              <button key={tab} onClick={() => setSourceTab(tab)}
                className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${sourceTab === tab ? 'bg-[var(--color-card)] font-medium shadow-sm' : 'text-[var(--color-muted-foreground)]'}`}>
                {tab === 'library' ? 'From Library' : 'Custom'}
              </button>
            ))}
          </div>
        )}

        {sourceTab === 'library' && !editingActivity && (
          <div className="mb-4">
            <label className={labelClass}>Activity Library</label>
            <Dropdown
              variant="form"
              value={selectedActivityId}
              onChange={handleLibrarySelect}
              label="Select an activity..."
              searchable
              items={[
                { value: '', label: 'Select an activity...' },
                ...filteredActivities.map((a: ActivityDto) => ({ value: String(a.id), label: `${a.activityName} (${a.category})` })),
              ]}
            />
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className={labelClass}>Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputClass} placeholder="Activity title" maxLength={200} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Start Time</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>End Time</label>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Location</label>
            <input value={location} onChange={e => setLocation(e.target.value)} className={inputClass} placeholder="Location" maxLength={200} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Status *</label>
              <Dropdown
                variant="form"
                value={status}
                onChange={setStatus}
                items={STATUS_OPTIONS.map(s => ({ value: s, label: s }))}
              />
            </div>
            <div>
              <label className={labelClass}>Estimated Cost</label>
              <input type="number" min="0" step="0.01" value={estimatedCost} onChange={e => setEstimatedCost(e.target.value)} className={inputClass} placeholder="0.00" />
            </div>
          </div>

          <div>
            <label className={labelClass}>Booking Reference</label>
            <input value={bookingReference} onChange={e => setBookingReference(e.target.value)} className={inputClass} placeholder="e.g. BK-12345" maxLength={200} />
          </div>

          <details className="group">
            <summary className="text-sm font-medium cursor-pointer text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
              Provider Details
            </summary>
            <div className="mt-3 space-y-3 pl-2 border-l-2 border-[var(--color-border)]">
              <div>
                <label className={labelClass}>Provider Name</label>
                <input value={providerName} onChange={e => setProviderName(e.target.value)} className={inputClass} placeholder="Provider name" maxLength={200} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Phone</label>
                  <input value={providerPhone} onChange={e => setProviderPhone(e.target.value)} className={inputClass} placeholder="Phone" maxLength={50} />
                </div>
                <div>
                  <label className={labelClass}>Email</label>
                  <input type="email" value={providerEmail} onChange={e => setProviderEmail(e.target.value)} className={inputClass} placeholder="Email" maxLength={200} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Website</label>
                <input value={providerWebsite} onChange={e => setProviderWebsite(e.target.value)} className={inputClass} placeholder="https://..." maxLength={500} />
              </div>
            </div>
          </details>

          <details className="group" open={!!(accessibilityNotes || notes)}>
            <summary className="text-sm font-medium cursor-pointer text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
              Notes
            </summary>
            <div className="mt-3 space-y-3 pl-2 border-l-2 border-[var(--color-border)]">
              <div>
                <label className={labelClass}>Accessibility Notes</label>
                <textarea value={accessibilityNotes} onChange={e => setAccessibilityNotes(e.target.value)} className={inputClass} rows={2} placeholder="Accessibility requirements..." />
              </div>
              <div>
                <label className={labelClass}>General Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} className={inputClass} rows={2} placeholder="Additional notes..." />
              </div>
            </div>
          </details>
        </div>

        {timeError && <p className="mt-3 text-sm text-red-500">{timeError}</p>}
        {(createActivity.isError || updateActivity.isError) && (
          <p className="mt-3 text-sm text-red-500">Failed to save activity. Please try again.</p>
        )}

    </Modal>
  )
}
