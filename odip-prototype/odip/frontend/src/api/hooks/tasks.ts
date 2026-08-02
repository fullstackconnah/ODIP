import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type { TaskDto, CreateTaskDto, UpdateTaskDto } from '../types'

export function useTasks(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => apiGet<TaskDto[]>('/tasks', params),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
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
