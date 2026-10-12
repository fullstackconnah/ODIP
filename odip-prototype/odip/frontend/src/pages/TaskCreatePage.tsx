import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateTask, useUpdateTask, useTask, useTrips, useStaff } from '@/api/hooks'
import { useEffect } from 'react'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { BackButton } from '@/components/BackButton'
import { SearchableSelect } from '@/components/SearchableSelect'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { formGrid, span } from '@/lib/formGrid'
import { Callout } from '@/components/Callout'
import { PageState } from '@/components/PageState'
import { extractErrorMessage } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions'

const TASK_TYPE_ITEMS: DropdownItem[] = [
  { value: 'AccommodationRequest', label: 'Accommodation Request' },
  { value: 'AccommodationConfirmation', label: 'Accommodation Confirmation' },
  { value: 'VehicleRequest', label: 'Vehicle Request' },
  { value: 'VehicleConfirmation', label: 'Vehicle Confirmation' },
  { value: 'ParticipantConfirmation', label: 'Participant Confirmation' },
  { value: 'FamilyContact', label: 'Family Contact' },
  { value: 'InvoiceOop', label: 'Invoice / OOP' },
  { value: 'StaffingAllocation', label: 'Staffing Allocation' },
  { value: 'RiskReview', label: 'Risk Review' },
  { value: 'MedicationCheck', label: 'Medication Check' },
  { value: 'PreDeparture', label: 'Pre-Departure' },
  { value: 'PostTrip', label: 'Post-Trip' },
  { value: 'Other', label: 'Other' },
]

const TASK_PRIORITY_ITEMS: DropdownItem[] = [
  { value: 'Low', label: 'Low' },
  { value: 'Medium', label: 'Medium' },
  { value: 'High', label: 'High' },
  { value: 'Urgent', label: 'Urgent' },
]

const TASK_STATUS_EDIT_ITEMS: DropdownItem[] = [
  { value: 'NotStarted', label: 'Not Started' },
  { value: 'InProgress', label: 'In Progress' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Cancelled', label: 'Cancelled' },
]

const taskSchema = z.object({
  tripInstanceId: z.string().min(1, 'Trip is required'),
  taskType: z.string().min(1, 'Task type is required'),
  title: z.string().min(1, 'Title is required'),
  ownerId: z.string().optional(),
  priority: z.string().min(1),
  dueDate: z.string().optional(),
  status: z.string().optional(),
  completedDate: z.string().optional(),
  notes: z.string().optional(),
})

type TaskFormData = z.infer<typeof taskSchema>

export default function TaskCreatePage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const tripInstanceIdParam = searchParams.get('tripInstanceId') ?? ''
  const isEdit = !!id
  // A role that cannot write (ReadOnly; the route admits no one else without write) reads the task here: the only place its details are shown.
  const { canWrite } = usePermissions()
  const viewOnly = isEdit && !canWrite
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const mutation = isEdit ? updateTask : createTask
  const { data: trips = [] } = useTrips()
  const { data: staff = [] } = useStaff()

  const { data: existingTask, isError: isTaskError } = useTask(isEdit ? id : undefined)

  const { register, handleSubmit, reset, control, formState: { errors, isDirty } } = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      tripInstanceId: tripInstanceIdParam,
      priority: 'Medium',
      taskType: 'Other',
      status: 'NotStarted',
    },
  })

  // For edit mode: load task data from the dedicated single-task endpoint (PP-10/PP-11).
  useEffect(() => {
    if (existingTask) {
      reset({
        tripInstanceId: existingTask.tripInstanceId ?? '',
        taskType: existingTask.taskType ?? 'Other',
        title: existingTask.title ?? '',
        ownerId: existingTask.ownerId ?? '',
        priority: existingTask.priority ?? 'Medium',
        dueDate: existingTask.dueDate ?? '',
        status: existingTask.status ?? 'NotStarted',
        completedDate: existingTask.completedDate ?? '',
        notes: existingTask.notes ?? '',
      })
    }
  }, [existingTask, reset])

  const onSubmit = async (data: TaskFormData) => {
    const payload: any = { ...data }
    for (const key of Object.keys(payload)) {
      if (payload[key] === '' || payload[key] === undefined) payload[key] = null
    }
    try {
      if (isEdit) {
        const res = await updateTask.mutateAsync({ id, data: payload })
        if (res.success) {
          flushSync(() => reset(data))
          navigate('/tasks')
        }
      } else {
        const res = await createTask.mutateAsync(payload)
        if (res.success) {
          flushSync(() => reset(data))
          navigate('/tasks')
        }
      }
    } catch {
      // error handled by mutation state
    }
  }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  // PP-59: don't render the form with create-mode defaults while an edit-mode fetch is still in
  // flight — wait for it to resolve (success or the not-found case handled just below).
  if (isEdit && !isTaskError && !existingTask) {
    return <PageState kind="loading" noun="task" />
  }

  // PP-10/PP-11: a failed/not-found single-task fetch must surface visibly, not silently fall
  // back to rendering the create-mode form with blank defaults.
  if (isEdit && isTaskError) {
    return (
      <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
        <div className="flex items-start gap-2">
          <BackButton to="/tasks" label="tasks" variant="icon" history={false} />
          <div className="flex-1 min-w-0"><PageHeader title={viewOnly ? 'View task' : 'Edit task'} /></div>
        </div>
        <Callout tone="error">
          Couldn't find this task. It may have been deleted, or something went wrong loading it.
        </Callout>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
      {unsavedChangesDialog}
      <div className="flex items-start gap-2">
        <BackButton to="/tasks" label="tasks" variant="icon" history={false} />
        <div className="flex-1 min-w-0"><PageHeader title={viewOnly ? 'View task' : isEdit ? 'Edit task' : 'New task'} /></div>
      </div>

      {mutation.isError && (
        <Callout tone="error">
          {extractErrorMessage(mutation.error, `Failed to ${isEdit ? 'update' : 'create'} task. Please check your input and try again.`)}
        </Callout>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-[var(--section-gap)]">
        <fieldset disabled={viewOnly} className="min-w-0">
        {/* Task Details */}
        <Card title="Task details">
          <div className={formGrid}>
            <FormField label="Title" required error={errors.title?.message} className={span.medium}>
              <input {...register('title')} placeholder="e.g. Confirm accommodation booking" autoFocus />
            </FormField>

            <FormField label="Trip" required error={errors.tripInstanceId?.message} className={span.medium}>
              <Controller
                control={control}
                name="tripInstanceId"
                render={({ field }) => (
                  <SearchableSelect
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="Select a trip..."
                    items={trips.map((t: any) => ({ value: t.id, label: t.tripName }))}
                  />
                )}
              />
            </FormField>

            <FormField label="Task Type" required className={span.medium}>
              <Controller
                control={control}
                name="taskType"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    items={TASK_TYPE_ITEMS}
                  />
                )}
              />
            </FormField>

            {/* UX-01: staff-scale list — SearchableSelect, not a bounded native select. */}
            <FormField label="Owner" className={span.medium}>
              <Controller
                control={control}
                name="ownerId"
                render={({ field }) => (
                  <SearchableSelect
                    id="ownerId"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    items={[
                      { value: '', label: 'Unassigned' },
                      ...staff.map((s: any) => ({ value: s.id, label: s.fullName })),
                    ]}
                  />
                )}
              />
            </FormField>

            <FormField label="Priority" required className={span.short}>
              <Controller
                control={control}
                name="priority"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    items={TASK_PRIORITY_ITEMS}
                  />
                )}
              />
            </FormField>

            <FormField label="Due Date" className={span.date}>
              <input type="date" {...register('dueDate')} />
            </FormField>

            {isEdit && (
              <>
                <FormField label="Status" className={span.short}>
                  <Controller
                    control={control}
                    name="status"
                    render={({ field }) => (
                      <Dropdown
                        variant="form"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        items={TASK_STATUS_EDIT_ITEMS}
                      />
                    )}
                  />
                </FormField>

                <FormField label="Completed Date" className={span.date}>
                  <input type="date" {...register('completedDate')} />
                </FormField>
              </>
            )}

            <FormField label="Notes" className={span.long}>
              <textarea {...register('notes')} rows={3} placeholder="Any additional details..." />
            </FormField>
          </div>
        </Card>

        </fieldset>

        {/* Submit */}
        {!viewOnly && <div className="flex justify-end gap-3">
          <Button variant="secondary" to="/tasks">Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save' : 'Create task')}
          </Button>
        </div>}
      </form>
    </div>
  )
}
