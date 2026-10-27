import { useState, useEffect } from 'react'
import { useActivities, useCreateScheduledActivity, useUpdateScheduledActivity } from '@/api/hooks'
import { modalGrid, modalSpan } from '@/lib/formGrid'
import { Modal } from '@/components/Modal'
import { Dropdown } from './Dropdown'
import type { ActivityDto, ScheduledActivityDto, CreateScheduledActivityDto, UpdateScheduledActivityDto } from '@/api/types'
import type { ScheduledActivityStatus } from '@/api/types/enums'
import { Button } from '@/components/Button'
import { FormField } from '@/components/FormField'

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

  return (
    <Modal
      open
      onClose={onClose}
      title={editingActivity ? 'Edit Activity' : 'Add Activity'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || isSubmitting}>
            {isSubmitting ? 'Saving...' : editingActivity ? 'Update' : 'Add Activity'}
          </Button>
        </>
      }
    >

        {!editingActivity && (
          <div className="flex gap-1 mb-4 bg-[var(--color-surface)] rounded-[var(--radius-md)] p-1">
            {(['library', 'custom'] as const).map(tab => (
              <button key={tab} onClick={() => setSourceTab(tab)}
                className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${sourceTab === tab ? 'bg-[var(--color-card)] font-medium shadow-sm' : 'text-[var(--color-muted-foreground)]'}`}>
                {tab === 'library' ? 'From Library' : 'Custom'}
              </button>
            ))}
          </div>
        )}

        {sourceTab === 'library' && !editingActivity && (
          <FormField label="Activity Library" className="mb-4"><Dropdown
              variant="form"
              value={selectedActivityId}
              onChange={handleLibrarySelect}
              label="Select an activity..."
              searchable
              items={[
                { value: '', label: 'Select an activity...' },
                ...filteredActivities.map((a: ActivityDto) => ({ value: String(a.id), label: `${a.activityName} (${a.category})` })),
              ]}
            /></FormField>
        )}

        <div className={modalGrid}>
          <FormField label="Title" required className={modalSpan.full}><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Activity title" maxLength={200} /></FormField>

          <div className="contents">
            <FormField label="Start Time" className={modalSpan.half}><input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} /></FormField>
            <FormField label="End Time" className={modalSpan.half}><input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} /></FormField>
          </div>

          <FormField label="Location" className={modalSpan.full}><input value={location} onChange={e => setLocation(e.target.value)} placeholder="Location" maxLength={200} /></FormField>

          <div className="contents">
            <FormField label="Status" required className={modalSpan.half}><Dropdown
                variant="form"
                value={status}
                onChange={setStatus}
                items={STATUS_OPTIONS.map(s => ({ value: s, label: s }))}
              /></FormField>
            <FormField label="Estimated Cost" className={modalSpan.half}><input type="number" min="0" step="0.01" value={estimatedCost} onChange={e => setEstimatedCost(e.target.value)} placeholder="0.00" /></FormField>
          </div>

          <FormField label="Booking Reference" className={modalSpan.full}><input value={bookingReference} onChange={e => setBookingReference(e.target.value)} placeholder="e.g. BK-12345" maxLength={200} /></FormField>

          <details className="group sm:col-span-2">
            <summary className="text-sm font-medium cursor-pointer text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
              Provider Details
            </summary>
            <div className={`mt-3 pl-2 border-l-2 border-[var(--color-border)] ${modalGrid}`}>
              <FormField label="Provider Name" className={modalSpan.full}><input value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="Provider name" maxLength={200} /></FormField>
              <div className="contents">
                <FormField label="Phone" className={modalSpan.half}><input value={providerPhone} onChange={e => setProviderPhone(e.target.value)} placeholder="Phone" maxLength={50} /></FormField>
                <FormField label="Email" className={modalSpan.half}><input type="email" value={providerEmail} onChange={e => setProviderEmail(e.target.value)} placeholder="Email" maxLength={200} /></FormField>
              </div>
              <FormField label="Website" className={modalSpan.full}><input value={providerWebsite} onChange={e => setProviderWebsite(e.target.value)} placeholder="https://..." maxLength={500} /></FormField>
            </div>
          </details>

          <details className="group sm:col-span-2" open={!!(accessibilityNotes || notes)}>
            <summary className="text-sm font-medium cursor-pointer text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
              Notes
            </summary>
            <div className={`mt-3 pl-2 border-l-2 border-[var(--color-border)] ${modalGrid}`}>
              <FormField label="Accessibility Notes" className={modalSpan.full}><textarea value={accessibilityNotes} onChange={e => setAccessibilityNotes(e.target.value)} rows={3} placeholder="Accessibility requirements..." /></FormField>
              <FormField label="General Notes" className={modalSpan.full}><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Additional notes..." /></FormField>
            </div>
          </details>
        </div>

        {timeError && <p className="mt-3 text-sm text-[var(--color-destructive)]">{timeError}</p>}
        {(createActivity.isError || updateActivity.isError) && (
          <p className="mt-3 text-sm text-[var(--color-destructive)]">Failed to save activity. Please try again.</p>
        )}

    </Modal>
  )
}
