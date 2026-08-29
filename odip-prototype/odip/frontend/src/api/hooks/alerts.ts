import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { ParticipantAlertsDto } from '../types'

/**
 * Alerts for a single participant — feeds the alert banner on ParticipantDetailPage's header.
 * `enabled` should be gated on `usePermissions().canViewAlerts` — the backend endpoint is
 * Admin/Coordinator/SuperAdmin only, so callers visible to other roles (e.g. SupportWorker, who
 * can also open a participant's detail page) must not fire this request.
 */
export function useParticipantAlerts(participantId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['participant-alerts', participantId],
    queryFn: () => apiGet<ParticipantAlertsDto>(`/participants/${participantId}/alerts`),
    enabled: !!participantId && enabled,
  })
}

/**
 * Aggregate alerts across every participant visible to the current tenant — one request shared by
 * the participants table's badge column and the dashboard's Critical-alerts card, so neither pays
 * an N+1 per-participant cost. `enabled` should be gated on `usePermissions().canViewAlerts`.
 */
export function useParticipantAlertsAggregate(enabled = true) {
  return useQuery({
    queryKey: ['participant-alerts-aggregate'],
    queryFn: () => apiGet<ParticipantAlertsDto[]>('/participants/alerts'),
    enabled,
  })
}
