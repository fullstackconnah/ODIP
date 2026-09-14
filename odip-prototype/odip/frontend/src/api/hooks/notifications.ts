import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiGetWithDefault, apiPost, apiPut } from '../client'
import type {
  NotificationPreferenceGridDto,
  UpdateNotificationPreferenceDto,
  NotificationOutboxDto,
  NotificationOutboxStatus,
  TestEmailResultDto,
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
