import { useNavigate, useParams, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateTask, useUpdateTask, useTrips, useStaff } from '@/api/hooks'
import { apiClient } from '@/api/client'
import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'

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

  const { register, handleSubmit, reset, formState: { errors } } = useForm<TaskFormData>({
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
        if (res.success) navigate('/tasks')
      } else {
        const res = await createTask.mutateAsync(payload)
        if (res.success) navigate('/tasks')
      }
    } catch {
      // error handled by mutation state
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
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
            <select {...register('tripInstanceId')}>
              <option value="">Select a trip...</option>
              {trips.map((t: any) => (
                <option key={t.id} value={t.id}>{t.tripName}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Task Type" required>
            <select {...register('taskType')}>
              <option value="AccommodationRequest">Accommodation Request</option>
              <option value="AccommodationConfirmation">Accommodation Confirmation</option>
              <option value="VehicleRequest">Vehicle Request</option>
              <option value="VehicleConfirmation">Vehicle Confirmation</option>
              <option value="ParticipantConfirmation">Participant Confirmation</option>
              <option value="FamilyContact">Family Contact</option>
              <option value="InvoiceOop">Invoice / OOP</option>
              <option value="StaffingAllocation">Staffing Allocation</option>
              <option value="RiskReview">Risk Review</option>
              <option value="MedicationCheck">Medication Check</option>
              <option value="PreDeparture">Pre-Departure</option>
              <option value="PostTrip">Post-Trip</option>
              <option value="Other">Other</option>
            </select>
          </FormField>

          <FormField label="Notes">
            <textarea {...register('notes')} rows={3} placeholder="Any additional details..." />
          </FormField>
        </Card>

        {/* Assignment & Priority */}
        <Card title="Assignment & Priority" className="space-y-4">
          <FormField label="Owner">
            <select {...register('ownerId')}>
              <option value="">Unassigned</option>
              {staff.map((s: any) => (
                <option key={s.id} value={s.id}>{s.fullName}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Priority" required>
            <select {...register('priority')}>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Urgent">Urgent</option>
            </select>
          </FormField>

          <FormField label="Due Date">
            <input type="date" {...register('dueDate')} />
          </FormField>

          {isEdit && (
            <>
              <FormField label="Status">
                <select {...register('status')}>
                  <option value="NotStarted">Not Started</option>
                  <option value="InProgress">In Progress</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
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
            className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-blue-500/20">
            {mutation.isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Task')}
          </button>
        </div>
      </form>
    </div>
  )
}
