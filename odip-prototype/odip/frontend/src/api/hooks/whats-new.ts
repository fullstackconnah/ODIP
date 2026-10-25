import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut } from '../client'
import type { AdminWhatsNewEntry, SaveWhatsNewEntry, WhatsNewFeed } from '../types'

// ══════════════════════════════════════════════════════════════
// WHAT'S NEW — mirrors WhatsNewController (api/v1/whats-new) and AdminWhatsNewController (api/v1/admin/whats-new)
// ══════════════════════════════════════════════════════════════

export const WHATS_NEW_KEY = ['whats-new'] as const
export const ADMIN_WHATS_NEW_KEY = ['admin-whats-new'] as const

/** The caller's feed. Refetches on window focus (TanStack default) and not on a timer: entries change with a release or an admin edit. */
export function useWhatsNew() {
  return useQuery({
    queryKey: WHATS_NEW_KEY,
    queryFn: () => apiGet<WhatsNewFeed>('/whats-new'),
  })
}

/** The panel was opened: clears the dot at once, and puts it back from the snapshot if the server refuses. */
export function useMarkWhatsNewSeen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<boolean>('/whats-new/seen'),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: WHATS_NEW_KEY })
      const previous = qc.getQueryData<WhatsNewFeed>(WHATS_NEW_KEY)
      if (previous) qc.setQueryData<WhatsNewFeed>(WHATS_NEW_KEY, { ...previous, unreadCount: 0, popup: [] })
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(WHATS_NEW_KEY, context.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: WHATS_NEW_KEY }),
  })
}

/** The pop-up was dismissed. No rollback on a refusal: a dismissed pop-up must not come back in the same visit. */
export function useMarkWhatsNewPopupSeen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<boolean>('/whats-new/popup-seen'),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: WHATS_NEW_KEY })
      qc.setQueryData<WhatsNewFeed>(WHATS_NEW_KEY, feed => (feed ? { ...feed, popup: [] } : feed))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: WHATS_NEW_KEY }),
  })
}

export function useAdminWhatsNew() {
  return useQuery({
    queryKey: ADMIN_WHATS_NEW_KEY,
    queryFn: () => apiGet<AdminWhatsNewEntry[]>('/admin/whats-new'),
  })
}

/** Every admin write changes what people read, so both keys are refetched. */
function useAdminWrite<V>(fn: (v: V) => Promise<AdminWhatsNewEntry>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ADMIN_WHATS_NEW_KEY })
      qc.invalidateQueries({ queryKey: WHATS_NEW_KEY })
    },
  })
}

export const useCreateWhatsNewEntry = () => useAdminWrite((dto: SaveWhatsNewEntry) => apiPost<AdminWhatsNewEntry>('/admin/whats-new', dto))
export const useUpdateWhatsNewEntry = () =>
  useAdminWrite(({ id, ...dto }: SaveWhatsNewEntry & { id: string }) => apiPut<AdminWhatsNewEntry>(`/admin/whats-new/${id}`, dto))
export const useArchiveWhatsNewEntry = () => useAdminWrite((id: string) => apiPost<AdminWhatsNewEntry>(`/admin/whats-new/${id}/archive`))
export const useRestoreWhatsNewEntry = () => useAdminWrite((id: string) => apiPost<AdminWhatsNewEntry>(`/admin/whats-new/${id}/restore`))
