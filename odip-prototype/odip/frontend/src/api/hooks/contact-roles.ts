import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type { ParticipantContactRoleDto, CreateParticipantContactRoleDto, UpdateParticipantContactRoleDto } from '../types'

/** CONTACT-01 — a participant's typed contact roles, the Contacts tab's data source. */
export function useParticipantContactRoles(participantId: string | undefined) {
  return useQuery({
    queryKey: ['participant-contact-roles', participantId],
    queryFn: () => apiGet<ParticipantContactRoleDto[]>(`/participants/${participantId}/contact-roles`),
    enabled: !!participantId,
  })
}

export function useCreateContactRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, data }: { participantId: string; data: CreateParticipantContactRoleDto }) =>
      apiPostRaw<ParticipantContactRoleDto>(`/participants/${participantId}/contact-roles`, data),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['participant-contact-roles', variables.participantId] })
      qc.invalidateQueries({ queryKey: ['persons'] })
      // PF-4 (SPEC-02): also refresh the participant record itself — its server-computed
      // planTypeComplianceWarning depends on the persisted contact-role set, and the wizard's
      // edit-mode Contacts step (a second entry point into this same nested-CRUD endpoint)
      // renders that banner from the useParticipant(id) query.
      qc.invalidateQueries({ queryKey: ['participant', variables.participantId] })
    },
  })
}

export function useUpdateContactRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateParticipantContactRoleDto }) =>
      apiPutRaw<ParticipantContactRoleDto>(`/participants/contact-roles/${id}`, data),
    onSuccess: (res) => {
      if (res.data?.participantId) {
        qc.invalidateQueries({ queryKey: ['participant-contact-roles', res.data.participantId] })
        qc.invalidateQueries({ queryKey: ['participant', res.data.participantId] })   // the planTypeComplianceWarning depends on the role set
      }
    },
  })
}

export function useDeleteContactRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; participantId: string }) => apiDeleteRaw<boolean>(`/participants/contact-roles/${id}`),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['participant-contact-roles', variables.participantId] })
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['participant', variables.participantId] })   // the planTypeComplianceWarning depends on the role set
    },
  })
}
