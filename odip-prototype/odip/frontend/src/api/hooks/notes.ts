import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw } from '../client'
import type { ParticipantNoteDto, CreateParticipantNoteDto, UpdateParticipantNoteDto } from '../types'

export function useParticipantNotes(participantId: string | undefined, includeArchived?: boolean) {
  return useQuery({
    queryKey: ['participant-notes', participantId, includeArchived ?? false],
    queryFn: () =>
      apiGet<ParticipantNoteDto[]>(`/participants/${participantId}/notes`, {
        includeArchived: includeArchived ?? undefined,
      }),
    enabled: !!participantId,
  })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, data }: { participantId: string; data: CreateParticipantNoteDto }) =>
      apiPostRaw<ParticipantNoteDto>(`/participants/${participantId}/notes`, data),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['participant-notes', variables.participantId] })
    },
  })
}

export function useUpdateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateParticipantNoteDto }) =>
      apiPutRaw<ParticipantNoteDto>(`/participants/notes/${id}`, data),
    onSuccess: (res) => {
      if (res.data?.participantId) {
        qc.invalidateQueries({ queryKey: ['participant-notes', res.data.participantId] })
      }
    },
  })
}
