import { useTasks, useUpdateTask, useDeleteTask } from '@/api/hooks'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Filter, CheckCircle, Plus } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'

export default function TasksPage() {
  const { canWrite } = usePermissions()
  const [statusFilter, setStatusFilter] = useState('')
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()

  const { showArchived, params, toggleButtons, confirmDialog, actionButtons } = useArchiveRestore<any>({
    deleteMutation: deleteTask,
    restoreMutation: updateTask,
    entityName: (t) => t.title,
    entityId: (t) => t.id,
    archiveVia: 'status',
    archiveStatus: 'Cancelled',
    restoreData: (t) => ({ ...t, status: 'NotStarted' }),
    editPath: (t) => `/tasks/${t.id}/edit`,
  })

  // Merge status filter with archive params — when not archived and a filter is active, override status
  const queryParams = { ...params }
  if (!showArchived && statusFilter) queryParams.status = statusFilter

  const { data: tasks = [], isLoading } = useTasks(queryParams)

  const markComplete = async (e: React.MouseEvent, task: any) => {
    e.stopPropagation()
    await updateTask.mutateAsync({ id: task.id, data: { ...task, status: 'Completed', completedDate: new Date().toISOString().split('T')[0] } })
  }

  const taskColumns: Column<any>[] = [
    {
      key: 'checkbox',
      header: '',
      hidden: showArchived,
      render: (t) => t.status !== 'Completed' && t.status !== 'Cancelled' ? (
        <button onClick={(e) => markComplete(e, t)} className="p-1 rounded hover:bg-green-500/20 text-[var(--color-muted-foreground)] hover:text-green-400 transition-colors" title="Mark complete">
          <CheckCircle className="w-4 h-4" />
        </button>
      ) : null,
    },
    { key: 'title', header: 'Task', sortable: true, className: 'font-medium' },
    { key: 'tripName', header: 'Trip', sortable: true },
    { key: 'taskType', header: 'Type', sortable: true },
    { key: 'ownerName', header: 'Owner', sortable: true },
    { key: 'dueDate', header: 'Due', type: 'date', sortable: true },
    {
      key: 'priority',
      header: 'Priority',
      render: (t) => <StatusBadge status={t.priority} />,
    },
    { key: 'status', header: 'Status', type: 'badge', sortable: true },
    { key: 'actions', header: '', render: (t) => canWrite ? actionButtons(t) : null },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Tasks"
        subtitle={`${tasks.length} task${tasks.length !== 1 ? 's' : ''}`}
        action={!showArchived && canWrite && (
          <Link to="/tasks/new" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-blue-500/20">
            <Plus className="w-4 h-4" /> New Task
          </Link>
        )}
      >
        {toggleButtons}
        {!showArchived && (
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted-foreground)]" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="pl-10 pr-8 py-2.5 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]">
              <option value="">All Statuses</option>
              <option value="NotStarted">Not Started</option>
              <option value="InProgress">In Progress</option>
              <option value="Overdue">Overdue</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        )}
      </PageHeader>

      <DataTable
        data={tasks}
        columns={taskColumns}
        keyField="id"
        sortable
        loading={isLoading}
        emptyMessage="No tasks found"
      />
      {confirmDialog}
    </div>
  )
}
