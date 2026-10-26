import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPut } from '../client'
import type { MicrosoftAccountDto, MicrosoftLinkDto, MicrosoftRole } from '../types'

const LINK_KEY = ['microsoft-link']
const ACCOUNT_KEY = ['microsoft-account']

/** The organisation's linked Microsoft directory (Admin), or null when none is linked. */
export function useMicrosoftLink() {
  return useQuery({ queryKey: LINK_KEY, queryFn: () => apiGet<MicrosoftLinkDto | null>('/auth/microsoft/link') })
}

/** Changes the role new Microsoft people get. `expectedUpdatedAt` is the link as the page last read it; the server answers 409 if someone changed it since. */
export function useSaveMicrosoftRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { defaultRole: MicrosoftRole; expectedUpdatedAt: string }) => apiPut<unknown>('/auth/microsoft/link', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: LINK_KEY }),
  })
}

export function useTurnOffMicrosoft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiDelete('/auth/microsoft/link'),
    // Profile offers Link or Unlink by whether the organisation is linked, so its cached answer goes stale too.
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: LINK_KEY }), qc.invalidateQueries({ queryKey: ACCOUNT_KEY })]),
  })
}

/** Whether the organisation and the signed-in person's own account are linked to Microsoft. */
export function useMicrosoftAccount(enabled = true) {
  return useQuery({ queryKey: ACCOUNT_KEY, queryFn: () => apiGet<MicrosoftAccountDto>('/auth/microsoft/account'), enabled, retry: false })
}

export function useUnlinkMicrosoftAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiDelete('/auth/microsoft/account'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNT_KEY }),
  })
}
