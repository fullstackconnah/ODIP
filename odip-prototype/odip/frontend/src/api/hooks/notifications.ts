import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiGetWithDefault, apiPost, apiPut } from '../client'
import type {
  NotificationPreferenceGridDto,
  UpdateNotificationPreferenceDto,
  NotificationOutboxDto,
  NotificationOutboxStatus,
  TestEmailResultDto,
  InboxDto,
} from '../types'

// ══════════════════════════════════════════════════════════════
// SELF-SERVICE — mirrors NotificationsController (api/v1/notifications)
// docs/specs/2026-09-08-notifications-design.md §2
// ══════════════════════════════════════════════════════════════

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => apiGet<NotificationPreferenceGridDto>('/notifications/preferences'),
  })
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rows: UpdateNotificationPreferenceDto[]) =>
      apiPut<NotificationPreferenceGridDto>('/notifications/preferences', rows),
    onSuccess: (data) => {
      // PUT's own response is the freshly-rebuilt grid — seed the cache with it directly rather
      // than invalidating and refetching.
      qc.setQueryData(['notification-preferences'], data)
    },
  })
}

// ══════════════════════════════════════════════════════════════
// ADMIN — mirrors AdminNotificationsController (api/v1/admin/notifications)
// docs/specs/2026-09-08-notifications-design.md §2
// ══════════════════════════════════════════════════════════════

export type AdminNotificationFilters = {
  status?: NotificationOutboxStatus
  from?: string
  to?: string
}

export function useAdminNotifications(filters: AdminNotificationFilters = {}) {
  return useQuery({
    queryKey: ['admin-notifications', filters],
    queryFn: () => apiGetWithDefault<NotificationOutboxDto[]>('/admin/notifications', [], filters),
  })
}

export function useRetryNotification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<NotificationOutboxDto>(`/admin/notifications/${id}/retry`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-notifications'] })
    },
  })
}

/** Bypasses the outbox entirely (SmtpEmailChannel.SendAsync called directly) — proves SMTP
 * config works right now, not "queue a real notification." 200 either way; { sent, error }
 * carries the outcome. */
export function useSendTestEmail() {
  return useMutation({
    mutationFn: (to: string) => apiPost<TestEmailResultDto>('/admin/notifications/test-email', { to }),
  })
}

// ══════════════════════════════════════════════════════════════
// THE BELL — the caller's own inbox (dashboard spec 2026-10-14)
// ══════════════════════════════════════════════════════════════

export const INBOX_KEY = ['notifications-inbox'] as const

/** The bell's newest 30, polled every 60 s like the completion badge (TanStack also refetches on window focus). */
export function useInbox() {
  return useQuery({
    queryKey: INBOX_KEY,
    queryFn: () => apiGet<InboxDto>('/notifications/inbox', { take: 30 }),
    refetchInterval: 60_000,
  })
}

/** Marks one item read, optimistically. A refused mark shows nothing: the refetch on settle puts the dot back. */
export function useMarkInboxRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<void>(`/notifications/inbox/${id}/read`),
    onMutate: async (id: string) => {
      // A poll still in the air would land after this and bring the dot back.
      await qc.cancelQueries({ queryKey: INBOX_KEY })
      qc.setQueryData<InboxDto>(INBOX_KEY, inbox => {
        const target = inbox?.items.find(n => n.id === id)
        if (!inbox || !target || target.readAt) return inbox
        const readAt = new Date().toISOString()
        return { ...inbox, unreadCount: Math.max(0, inbox.unreadCount - 1), items: inbox.items.map(n => (n.id === id ? { ...n, readAt } : n)) }
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: INBOX_KEY }),
  })
}

/** Marks everything read, optimistically. On a refusal the dots come back from the snapshot; the caller shows the alert. */
export function useMarkAllInboxRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<void>('/notifications/inbox/read-all'),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: INBOX_KEY })
      const previous = qc.getQueryData<InboxDto>(INBOX_KEY)
      if (previous) {
        const readAt = new Date().toISOString()
        qc.setQueryData<InboxDto>(INBOX_KEY, { ...previous, unreadCount: 0, items: previous.items.map(n => (n.readAt ? n : { ...n, readAt })) })
      }
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(INBOX_KEY, context.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: INBOX_KEY }),
  })
}
