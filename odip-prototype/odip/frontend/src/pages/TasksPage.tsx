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
import { Link, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { Filter, CheckCircle, Plus, ListChecks } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'
import { plural } from '@/lib/format'
import { localIsoDate } from '@/lib/dateOnly'

const TASK_STATUS_ITEMS = [
  { value: 'NotStarted', label: 'Not Started' },
  { value: 'InProgress', label: 'In Progress' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Overdue', label: 'Overdue' },
  { value: 'Cancelled', label: 'Cancelled' },
]

/** The Admin's review of an emergency booking past budget. Only an Admin or SuperAdmin closes it: the server forbids everyone else, so this page does not offer what it would refuse. */
const isBudgetReview = (task: { taskType?: string }) => task.taskType === 'BudgetEmergencyReview'

export default function TasksPage() {
  const { canWrite, isAdmin, isSuperAdmin } = usePermissions()
  const mayCloseBudgetReview = !!isAdmin || !!isSuperAdmin
  // The one place the rule lives: a row the user may not change gets no tick, a held status and no edit or archive.
  const mayChange = (task: { taskType?: string }) => canWrite && (!isBudgetReview(task) || mayCloseBudgetReview)
  // The dashboard's Overdue tile links to /tasks?status=Overdue: open on that filter (the server answers it with the dashboard's own rule).
  const [searchParams] = useSearchParams()
  const [statusFilter, setStatusFilter] = useState(() => {
    const fromAddress = searchParams.get('status')
    return TASK_STATUS_ITEMS.some(item => item.value === fromAddress) ? fromAddress! : ''
  })
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
    await updateTask.mutateAsync({ id: task.id, data: { ...task, status: 'Completed', completedDate: localIsoDate() } })
  }

  const taskColumns: Column<any>[] = [
    {
      key: 'checkbox',
      header: '',
      hidden: showArchived,
      render: (t) => t.status !== 'Completed' && t.status !== 'Cancelled' && (!isBudgetReview(t) || mayCloseBudgetReview) ? (
        <Button variant="ghost" size="sm" iconOnly onClick={(e) => markComplete(e, t)} title="Mark complete">
          <CheckCircle className="w-4 h-4" />
        </Button>
      ) : null,
    },
    // Column budget (density §4): at 1280 the box is ~1006px and the fixed columns (tick, due, priority, status, Open, actions)
    // take ~500 of it, so the text columns are capped (an ellipsis, full text in the tooltip). Every column stays (Trip and Type were
    // deleted below 1536 and 1792, L3-04): what does not fit scrolls in the box with the task and the actions pinned.
    {
      key: 'title',
      header: 'Task',
      sortable: true,
      className: 'font-medium',
      maxWidth: '16rem',
      // The title is the way in when the task has one (this column is pinned, so it is always reachable; "Open" stays for the habit). The review of an emergency names the participant and the day LAST, which is
      // exactly what a one-line cap cuts, so its title wraps instead and the row says which emergency it is. Every other title is cut on the link itself (a wrapper would clip its focus ring).
      render: (t) => t.linkTo ? (
        <Link
          to={t.linkTo}
          title={t.title}
          className={`text-[var(--color-primary)] hover:underline ${isBudgetReview(t) ? 'whitespace-normal md:max-w-[16rem]' : 'block md:truncate md:max-w-[16rem]'}`}
        >
          {t.title}
        </Link>
      ) : isBudgetReview(t) ? (
        <span className="block whitespace-normal md:max-w-[16rem]" title={t.title}>{t.title}</span>
      ) : t.title,
    },
    {
      key: 'tripName',
      header: 'Trip',
      sortable: true,
      maxWidth: '11rem',
      render: (t) => t.tripInstanceId && t.tripName ? (
        // Truncation on the link itself (not a wrapper): a wrapper's overflow: hidden would clip the link's focus ring.
        <Link to={`/trips/${t.tripInstanceId}`} title={t.tripName} className="block truncate text-[var(--color-primary)] hover:underline md:max-w-[11rem]">
          {t.tripName}
        </Link>
      ) : (t.tripName ?? '—'),
    },
    { key: 'taskType', header: 'Type', sortable: true, maxWidth: '10rem', render: (t) => TASK_TYPE_LABELS[t.taskType as keyof typeof TASK_TYPE_LABELS] ?? t.taskType },
    // Nobody owns the review of an emergency until an Admin takes it, and it is the Admins' to take: say so rather than a dash that reads as "nobody's job".
    { key: 'ownerName', header: 'Owner', sortable: true, maxWidth: '8rem', render: (t) => t.ownerName ?? (isBudgetReview(t) ? 'Admins' : '—') },
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
                  ...(val === 'Completed' ? { completedDate: localIsoDate() } : {}),
                },
              }, {
                onError: () => setFailedRowId(t.id),
                onSuccess: () => setFailedRowId(prev => prev === t.id ? null : prev),
              })
            }}
            colorClass={getStatusColor(t.status)}
            items={TASK_STATUS_ITEMS}
            disabled={!mayChange(t)}
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
    { key: 'actions', header: '', render: (t) => mayChange(t) ? actionButtons(t) : null },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Tasks"
        subtitle={plural(tasks.length, 'task')}
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
