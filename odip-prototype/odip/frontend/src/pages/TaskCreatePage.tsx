import { useNavigate, useParams, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateTask, useUpdateTask, useTrips, useStaff } from '@/api/hooks'
import { apiClient } from '@/api/client'
import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { SearchableSelect } from '@/components/SearchableSelect'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'

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
  const isEdit = !!id
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const mutation = isEdit ? updateTask : createTask
  const { data: trips = [] } = useTrips()
  const { data: staff = [] } = useStaff()

  // For edit mode, we load the task from the tasks list since there's no single-task endpoint
  // We'll pass task data via navigation state instead

  const { register, handleSubmit, reset, control, formState: { errors, isDirty } } = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      priority: 'Medium',
      taskType: 'Other',
      status: 'NotStarted',
    },
  })

  // For edit mode: load task data from tasks list
  useEffect(() => {
    if (isEdit) {
      // Fetch tasks and find the one we need
      const fetchTask = async () => {
        try {
          const res = await apiClient.get(`/tasks?status=`)
          const tasks = res.data?.data ?? []
          const task = tasks.find((t: any) => t.id === id)
          if (task) {
            reset({
              tripInstanceId: task.tripInstanceId ?? '',
              taskType: task.taskType ?? 'Other',
              title: task.title ?? '',
              ownerId: task.ownerId ?? '',
              priority: task.priority ?? 'Medium',
              dueDate: task.dueDate ?? '',
              status: task.status ?? 'NotStarted',
              completedDate: task.completedDate ?? '',
              notes: task.notes ?? '',
            })
          }
        } catch (err) {
          console.error('Failed to load task:', err)
        }
      }
      fetchTask()
    }
  }, [id, isEdit, reset])

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

  return (
    <div className="space-y-6 animate-fade-in">
      {unsavedChangesDialog}
      <div className="flex items-center gap-4">
        <Link to="/tasks" className="p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl md:text-2xl font-bold">{isEdit ? 'Edit Task' : 'New Task'}</h1>
      </div>

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          Failed to {isEdit ? 'update' : 'create'} task. Please check your input and try again.
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="grid md:grid-cols-2 gap-6">
        {/* Task Details */}
        <Card title="Task Details" className="space-y-4">
          <FormField label="Title" required error={errors.title?.message}>
            <input {...register('title')} placeholder="e.g. Confirm accommodation booking" autoFocus />
          </FormField>

          <FormField label="Trip" required error={errors.tripInstanceId?.message}>
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

          <FormField label="Task Type" required>
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

          <FormField label="Notes">
            <textarea {...register('notes')} rows={3} placeholder="Any additional details..." />
          </FormField>
        </Card>

        {/* Assignment & Priority */}
        <Card title="Assignment & Priority" className="space-y-4">
          {/* UX-01: staff-scale list — SearchableSelect, not a bounded native select. */}
          <FormField label="Owner">
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

          <FormField label="Priority" required>
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

          <FormField label="Due Date">
            <input type="date" {...register('dueDate')} />
          </FormField>

          {isEdit && (
            <>
              <FormField label="Status">
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

              <FormField label="Completed Date">
                <input type="date" {...register('completedDate')} />
              </FormField>
            </>
          )}
        </Card>

        {/* Submit */}
        <div className="md:col-span-2 flex justify-end gap-3">
          <Link to="/tasks" className="px-6 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">
            Cancel
          </Link>
          <button type="submit" disabled={mutation.isPending}
            className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-[var(--color-primary)]/20">
            {mutation.isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Task')}
          </button>
        </div>
      </form>
    </div>
  )
}
