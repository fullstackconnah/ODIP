import { Button } from '@/components/Button'
import { Plus } from 'lucide-react'
import { useSetTaskStatus } from '@/api/hooks'
import type { TaskDto } from '@/api/types'
import type { TaskItemStatus } from '@/api/types/enums'
import { DataTable, type Column } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { StatusBadge } from '@/components/StatusBadge'
import { getStatusColor } from '@/lib/utils'
import { localIsoDate } from '@/lib/dateOnly'

const TASK_STATUS_ITEMS = [
  { value: 'NotStarted', label: 'Not Started' },
  { value: 'InProgress', label: 'In Progress' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Overdue', label: 'Overdue' },
  { value: 'Cancelled', label: 'Cancelled' },
]

export default function TasksTab({ tripId, tasks, canWrite }: { tripId: string; tasks: TaskDto[]; canWrite: boolean }) {
  const setStatus = useSetTaskStatus()

  const columns: Column<TaskDto>[] = [
    // Column budget (density §4), the same as the Tasks page: the text columns are capped (ellipsis, full text in the tooltip) and Type
    // stays: the table scrolls in its box with the first column and the actions pinned (DataTable's column rule).
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
      // The same priority pill as the Tasks page and the dashboard (one mapping: Low info, Medium warning, High and Urgent danger).
      render: (t) => <StatusBadge status={t.priority} />,
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
            onChange={(val: string) => setStatus.mutate({
              id: t.id,
              status: val as TaskItemStatus,
              ...(val === 'Completed' ? { completedDate: localIsoDate() } : {}),
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
          <Button to={`/tasks/new?tripInstanceId=${tripId}`}>
            <Plus className="w-4 h-4" /> Add Task
          </Button>
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
