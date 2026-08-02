import { DataTable } from '@/components/DataTable'
import { getStatusColor } from '@/lib/utils'

export default function TasksTab({ tasks }: { tasks: any[] }) {
  return (
    <DataTable
      data={tasks}
      keyField="id"
      emptyMessage="No tasks yet"
      sortable
      columns={[
        {
          key: 'title',
          header: 'Task',
          className: 'font-medium',
          sortable: true,
        },
        {
          key: 'taskType',
          header: 'Type',
          sortable: true,
        },
        {
          key: 'ownerName',
          header: 'Owner',
          sortable: true,
          render: (t: any) => t.ownerName || 'Unassigned',
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
          sortFn: (a: any, b: any) => {
            const order: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 }
            return (order[a.priority] ?? 99) - (order[b.priority] ?? 99)
          },
          render: (t: any) => (
            <span className={`text-xs px-2 py-0.5 rounded-full ${t.priority === 'High' || t.priority === 'Urgent' ? 'badge-overdue' : 'badge-info'}`}>
              {t.priority}
            </span>
          ),
        },
        {
          key: 'status',
          header: 'Status',
          sortable: true,
          render: (t: any) => (
            <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(t.status)}`}>
              {t.status}
            </span>
          ),
        },
      ]}
    />
  )
}
