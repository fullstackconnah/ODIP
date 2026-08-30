import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type { ParticipantRoutineDto, CreateParticipantRoutineDto, UpdateParticipantRoutineDto } from '../types'

export function useParticipantRoutines(participantId: string | undefined, includeInactive?: boolean) {
  return useQuery({
    queryKey: ['participant-routines', participantId, includeInactive ?? false],
    queryFn: () =>
      apiGet<ParticipantRoutineDto[]>(`/participants/${participantId}/routines`, {
        includeInactive: includeInactive ?? undefined,
      }),
    enabled: !!participantId,
  })
}

export function useCreateRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, data }: { participantId: string; data: CreateParticipantRoutineDto }) =>
      apiPostRaw<ParticipantRoutineDto>(`/participants/${participantId}/routines`, data),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['participant-routines', variables.participantId] })
    },
  })
}

export function useUpdateRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateParticipantRoutineDto }) =>
      apiPutRaw<ParticipantRoutineDto>(`/participants/routines/${id}`, data),
    onSuccess: (res) => {
      if (res.data?.participantId) {
        qc.invalidateQueries({ queryKey: ['participant-routines', res.data.participantId] })
      }
    },
  })
}

export function useDeleteRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; participantId: string }) =>
      apiDeleteRaw<boolean>(`/participants/routines/${id}`),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['participant-routines', variables.participantId] })
    },
  })
}
