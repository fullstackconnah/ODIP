import { useQueryClient } from '@tanstack/react-query'
import { apiGet } from '@/api/client'
import { useTasks, useUpdateTask } from '@/api/hooks'
import { TASK_TYPE_LABELS, type TaskDto, type UpdateTaskDto } from '@/api/types'
import { formatDayMonth } from '@/lib/dateRange'
import { groupPhase, type GroupModel, type QuickRow, type RowAction } from '../quickGroupModel'

const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 }
const isOpen = (t: TaskDto) => t.status !== 'Completed' && t.status !== 'Cancelled'
const dueDay = (t: TaskDto) => t.dueDate?.slice(0, 10) ?? ''

/** The Tasks due group (SHAPE §5, call 11): overdue, then due today, ticked with TasksPage's own PUT of the stored row. */
export function useTasksGroup(enabled: boolean, { today, mayCloseBudgetReview }: { today: string; mayCloseBudgetReview: boolean }): GroupModel {
  // Overdue is the server's own rule (the dashboard's Overdue figure); due today is the server's too (dueToday, on the provider's day, never the browser's). Both are full rows with their
  // notes, so Done never wipes them (the summary's overdueTasks leave Notes out).
  const overdue = useTasks({ status: 'Overdue' }, { enabled })
  const dueOnToday = useTasks({ dueToday: 'true' }, { enabled })
  const updateTask = useUpdateTask()
  const qc = useQueryClient()

  const late = [...(overdue.data ?? [])].sort((a, b) => dueDay(a).localeCompare(dueDay(b)))
  const lateIds = new Set(late.map((t) => t.id))
  const dueToday = (dueOnToday.data ?? [])
    .filter((t) => isOpen(t) && !lateIds.has(t.id))
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))

  const row = (t: TaskDto, isLate: boolean): QuickRow => {
    // Only an Admin or SuperAdmin closes the review of an emergency over budget (BudgetReviewAudience.MayAct, TasksPage's mayChange): a Coordinator opens it.
    const signOff = t.taskType === 'BudgetEmergencyReview' && !mayCloseBudgetReview
    const done: RowAction = {
      kind: 'tap', label: 'Done', busyLabel: 'Saving…', name: `Done: ${t.title}`, failText: "Couldn't mark it done. Try again.",
      run: async () => {
        // TasksPage's tick on the stored row as it is NOW (the PUT rewrites every field and the server checks no version, so a list row hours old would
        // undo a note or a date, or complete a cancelled task: deep S2).
        const fresh = await apiGet<TaskDto>(`/tasks/${t.id}`)
        if (!isOpen(fresh)) {
          void overdue.refetch(); void dueOnToday.refetch()
          return { announce: `Already ${fresh.status.toLowerCase()} by someone else.`, stale: true }
        }
        await updateTask.mutateAsync({ id: t.id, data: { ...fresh, status: 'Completed', completedDate: today } as UpdateTaskDto })
        return { announce: `Marked done: ${t.title}.` }
      },
    }
    const actions: RowAction[] =
      // A leave cover task closes itself when the shift is reassigned: it is never ticked by hand. Its own link (the server writes /rostering?date=<the shift's day>) opens the board there.
      t.taskType === 'LeaveCoverage' ? [{ kind: 'link', label: 'Open roster', name: `Open roster for: ${t.title}`, to: t.linkTo ?? '/rostering' }]
      : signOff ? [{ kind: 'link', label: 'Open', name: `Open task: ${t.title}`, to: t.linkTo ?? `/tasks/${t.id}/edit` }]
      : t.linkTo ? [{ kind: 'link', label: 'Open', name: `Open task: ${t.title}`, to: t.linkTo }, done]
      : [done]
    return {
      id: t.id,
      subject: t.title,
      facts: [TASK_TYPE_LABELS[t.taskType], formatDayMonth(t.dueDate), t.priority, t.tripName],
      // Why the row has no Done is a flag, which never truncates.
      flags: [isLate ? { label: 'Overdue', tone: 'danger' } : { label: 'Due today', tone: 'warning' }, ...(signOff ? [{ label: 'An admin signs this off', tone: 'neutral' as const }] : [])],
      actions,
    }
  }

  const rows = [...late.map((t) => row(t, true)), ...dueToday.map((t) => row(t, false))]
  return {
    key: 'tasks',
    title: 'Tasks',
    noun: 'tasks due',
    subjectHeader: 'Task',
    // The trip is on a card only from lg: one tap away, and the longest wrap on a phone.
    columns: [{ header: 'Type' }, { header: 'Due' }, { header: 'Priority' }, { header: 'Trip', long: true, fromLg: true }],
    phase: groupPhase(overdue, dueOnToday),
    refetch: () => { void overdue.refetch(); void dueOnToday.refetch() },
    readAt: Math.min(overdue.dataUpdatedAt, dueOnToday.dataUpdatedAt),
    reread: async () => {
      try {
        const [o, d] = await Promise.all([overdue.refetch({ throwOnError: true }), dueOnToday.refetch({ throwOnError: true })])
        return [...(o.data ?? []), ...(d.data ?? []).filter(isOpen)].map((t) => t.id)
      } finally {
        // A Done with no reply never ran its onSuccess, and may have committed: refresh what it would have (useUpdateTask).
        void qc.invalidateQueries({ queryKey: ['tasks'] })
        void qc.invalidateQueries({ queryKey: ['trip-tasks'] })
        void qc.invalidateQueries({ queryKey: ['dashboard'] })
      }
    },
    count: rows.length,
    rows,
    link: { to: '/tasks', openLabel: 'Open Tasks' },
  }
}
