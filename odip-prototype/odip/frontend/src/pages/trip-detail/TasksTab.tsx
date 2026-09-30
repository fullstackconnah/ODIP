import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useUpdateTask } from '@/api/hooks'
import type { TaskDto, UpdateTaskDto } from '@/api/types'
import type { TaskItemStatus } from '@/api/types/enums'
import { DataTable, type Column } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { getStatusColor } from '@/lib/utils'

const TASK_STATUS_ITEMS = [
  { value: 'NotStarted', label: 'Not Started' },
  { value: 'InProgress', label: 'In Progress' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Overdue', label: 'Overdue' },
  { value: 'Cancelled', label: 'Cancelled' },
]

/** Builds the full UpdateTaskDto payload the PUT endpoint expects from an existing task plus a
 *  new status — the API takes the whole task, not a partial patch. `task.tripInstanceId` is
 *  optional as of item 9 (an obligation-engine task needn't have a trip) — every task rendered by
 *  this tab was already fetched scoped to `tripId`, so that's the correct fallback for the rare
 *  trip-less task that ends up here rather than sending an empty string. */
function toUpdateTaskPayload(task: TaskDto, status: TaskItemStatus, tripId: string): UpdateTaskDto {
  return {
    tripInstanceId: task.tripInstanceId ?? tripId,
    participantBookingId: task.participantBookingId ?? undefined,
    accommodationReservationId: task.accommodationReservationId ?? undefined,
    vehicleAssignmentId: task.vehicleAssignmentId ?? undefined,
    staffAssignmentId: task.staffAssignmentId ?? undefined,
    taskType: task.taskType,
    title: task.title,
    ownerId: task.ownerId ?? undefined,
    priority: task.priority,
    dueDate: task.dueDate ?? undefined,
    notes: task.notes ?? undefined,
    status,
    completedDate: status === 'Completed'
      ? new Date().toISOString().split('T')[0]
      : (task.completedDate ?? undefined),
  }
}

export default function TasksTab({ tripId, tasks, canWrite }: { tripId: string; tasks: TaskDto[]; canWrite: boolean }) {
  const updateTask = useUpdateTask()

  const columns: Column<TaskDto>[] = [
    // Column budget (density §4), the same as the Tasks page: the text columns are capped (ellipsis, full text in the tooltip) and Type
    // gives way below 2xl (1536), so Status stays on screen at 1280 whatever the task titles and owners are.
    {
      key: 'title',
      header: 'Task',
      className: 'font-medium',
      sortable: true,
      maxWidth: '16rem',
    },
    {
      key: 'taskType',
      header: 'Type',
      sortable: true,
      priority: 'low',
      maxWidth: '10rem',
    },
    {
      key: 'ownerName',
      header: 'Owner',
      sortable: true,
      maxWidth: '8rem',
      render: (t) => t.ownerName || 'Unassigned',
    },
    {
      key: 'dueDate',
      header: 'Due',
      type: 'date',
      sortable: true,
    },
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      sortFn: (a, b) => {
        const order: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 }
        return (order[a.priority] ?? 99) - (order[b.priority] ?? 99)
      },
      render: (t) => (
        <span className={`text-xs px-2 py-0.5 rounded-full ${t.priority === 'High' || t.priority === 'Urgent' ? 'badge-overdue' : 'badge-info'}`}>
          {t.priority}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (t) => canWrite ? (
        <span onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <Dropdown
            variant="pill"
            value={t.status}
            onChange={(val: string) => updateTask.mutate({
              id: t.id,
              data: toUpdateTaskPayload(t, val as TaskItemStatus, tripId),
            })}
            colorClass={getStatusColor(t.status)}
            items={TASK_STATUS_ITEMS}
          />
        </span>
      ) : (
        <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(t.status)}`}>
          {t.status}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <Link
            to={`/tasks/new?tripInstanceId=${tripId}`}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20"
          >
            <Plus className="w-4 h-4" /> Add Task
          </Link>
        </div>
      )}
      <DataTable
        data={tasks}
        keyField="id"
        emptyMessage="No tasks yet"
        sortable
        columns={columns}
      />
    </div>
  )
}
