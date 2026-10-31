import type { PagedResult, TaskDto } from '@/api/types'

/** GET /tasks reply: at most 500 rows plus the true total (the Tasks list bound). */
export const pagedTasks = (items: object[], totalCount = items.length): PagedResult<TaskDto> => ({
  items: items as TaskDto[], totalCount, page: 1, pageSize: 500, totalPages: 1, hasNext: false, hasPrevious: false,
})
