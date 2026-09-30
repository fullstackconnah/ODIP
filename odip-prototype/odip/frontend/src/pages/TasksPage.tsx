import { useTasks, useUpdateTask, useDeleteTask } from '@/api/hooks'
import { TASK_TYPE_LABELS } from '@/api/types'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/Button'
import { getStatusColor } from '@/lib/utils'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Filter, CheckCircle, Plus, ListChecks } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'

const TASK_STATUS_ITEMS = [
  { value: 'NotStarted', label: 'Not Started' },
  { value: 'InProgress', label: 'In Progress' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Overdue', label: 'Overdue' },
  { value: 'Cancelled', label: 'Cancelled' },
]

export default function TasksPage() {
  const { canWrite } = usePermissions()
  const [statusFilter, setStatusFilter] = useState('')
  const [failedRowId, setFailedRowId] = useState<string | null>(null)
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
        <Button variant="ghost" size="sm" iconOnly onClick={(e) => markComplete(e, t)} title="Mark complete">
          <CheckCircle className="w-4 h-4" />
        </Button>
      ) : null,
    },
    // Column budget (density §4): at 1280 the box is ~1006px and the fixed columns (tick, due, priority, status, Open, actions)
    // take ~500 of it, so the text columns are capped (an ellipsis, full text in the tooltip) and the two least useful ones
    // give way: Trip below 2xl (1536), Type below 1792. Uncapped, this table needed 1436px and pushed Status off-screen.
    { key: 'title', header: 'Task', sortable: true, className: 'font-medium', maxWidth: '16rem' },
    {
      key: 'tripName',
      header: 'Trip',
      sortable: true,
      priority: 'low',
      maxWidth: '11rem',
      render: (t) => t.tripInstanceId && t.tripName ? (
        // Truncation on the link itself (not a wrapper): a wrapper's overflow: hidden would clip the link's focus ring.
        <Link to={`/trips/${t.tripInstanceId}`} title={t.tripName} className="block truncate text-[var(--color-primary)] hover:underline md:max-w-[11rem]">
          {t.tripName}
        </Link>
      ) : (t.tripName ?? '—'),
    },
    { key: 'taskType', header: 'Type', sortable: true, priority: 'lowest', maxWidth: '10rem', render: (t) => TASK_TYPE_LABELS[t.taskType as keyof typeof TASK_TYPE_LABELS] ?? t.taskType },
    { key: 'ownerName', header: 'Owner', sortable: true, maxWidth: '8rem' },
    { key: 'dueDate', header: 'Due', type: 'date', sortable: true },
    {
      key: 'priority',
      header: 'Priority',
      render: (t) => <StatusBadge status={t.priority} />,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      // "Not Started" / "In Progress" swap in place: reserve the widest so the column does not jump.
      minWidth: '9rem',
      render: (t) => (
        <div>
          <Dropdown
            variant="pill"
            value={t.status}
            onChange={val => {
              setFailedRowId(null)
              updateTask.mutate({
                id: t.id,
                data: {
                  ...t,
                  status: val,
                  ...(val === 'Completed' ? { completedDate: new Date().toISOString().split('T')[0] } : {}),
                },
              }, {
                onError: () => setFailedRowId(t.id),
                onSuccess: () => setFailedRowId(prev => prev === t.id ? null : prev),
              })
            }}
            colorClass={getStatusColor(t.status)}
            items={TASK_STATUS_ITEMS}
            disabled={!canWrite}
          />
          {failedRowId === t.id && (
            <p role="alert" className="mt-1 text-xs text-[var(--color-destructive)]">
              Couldn't update status. Try again.
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'linkTo',
      header: '',
      render: (t) => t.linkTo ? (
        <Link to={t.linkTo} className="text-[var(--color-primary)] hover:underline">
          Open
        </Link>
      ) : null,
    },
    { key: 'actions', header: '', render: (t) => canWrite ? actionButtons(t) : null },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Tasks"
        subtitle={`${tasks.length} task${tasks.length !== 1 ? 's' : ''}`}
        action={!showArchived && canWrite && (
          <Button to="/tasks/new" size="md">
            <Plus className="w-4 h-4" /> New Task
          </Button>
        )}
      >
        {toggleButtons}
        {!showArchived && (
          <div className="flex items-center gap-1.5">
            <Filter aria-hidden="true" className="w-4 h-4 text-[var(--color-muted-foreground)]" />
            <Dropdown
              variant="pill"
              value={statusFilter}
              onChange={setStatusFilter}
              label="All Statuses"
              items={TASK_STATUS_ITEMS}
              colorClass="bg-[var(--color-input)] border border-[var(--color-border)]"
            />
          </div>
        )}
      </PageHeader>

      {!isLoading && tasks.length === 0 ? (
        !showArchived && statusFilter ? (
          <EmptyState
            icon={ListChecks}
            title="No tasks match your filters"
            description="Try a different status filter, or clear it to see all tasks."
            action={{ label: 'Clear filters', onClick: () => setStatusFilter('') }}
          />
        ) : (
          <EmptyState
            icon={ListChecks}
            title="No tasks yet"
            description="Tasks track the to-dos for a trip — accommodation confirmations, vehicle requests, medication checks and more. Add one to start tracking work."
            action={!showArchived && canWrite ? { label: 'Add task', to: '/tasks/new' } : undefined}
          />
        )
      ) : (
        <DataTable
          data={tasks}
          columns={taskColumns}
          keyField="id"
          sortable
          loading={isLoading}
          emptyMessage="No tasks found"
        />
      )}
      {confirmDialog}
    </div>
  )
}
