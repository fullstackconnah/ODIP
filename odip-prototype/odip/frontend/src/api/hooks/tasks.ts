import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type { TaskDto, CreateTaskDto, UpdateTaskDto, TaskItemStatus } from '../types'

export function useTasks(params?: Record<string, string>, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => apiGet<TaskDto[]>('/tasks', params),
    enabled: options?.enabled ?? true,
  })
}

/** PP-10/PP-11: single-task fetch for the edit page — mirrors useIncident's shape/pattern. */
export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => apiGet<TaskDto>(`/tasks/${id}`),
    enabled: !!id,
  })
}

export function useTripTasks(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip-tasks', tripId],
    queryFn: () => apiGet<TaskDto[]>(`/trips/${tripId}/tasks`),
    enabled: !!tripId,
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateTaskDto) => apiPostRaw<TaskDto>('/tasks', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['trip-tasks'] })
    },
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTaskDto }) =>
      apiPutRaw<TaskDto>(`/tasks/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task', vars.id] })
      qc.invalidateQueries({ queryKey: ['trip-tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

/** The one-tap Done: the server sets status and completion date on the stored row and nothing else, so no other field the caller read can be written back stale. */
export function useCompleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, completedDate }: { id: string; completedDate: string }) =>
      apiPostRaw<boolean>(`/tasks/${id}/complete`, { completedDate }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task', vars.id] })
      qc.invalidateQueries({ queryKey: ['trip-tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

/** A status change from the Tasks page or a trip's Tasks tab: the server writes status and completion date on the stored row and nothing else, so an edit made since the list loaded is never reverted (useUpdateTask rewrites the whole row). */
export function useSetTaskStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, completedDate }: { id: string; status: TaskItemStatus; completedDate?: string }) =>
      apiPostRaw<TaskDto>(`/tasks/${id}/status`, { status, completedDate }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task', vars.id] })
      qc.invalidateQueries({ queryKey: ['trip-tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['trip-tasks'] })
    },
  })
}
