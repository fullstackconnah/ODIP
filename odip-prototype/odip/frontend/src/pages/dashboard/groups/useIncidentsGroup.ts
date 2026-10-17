import { MAX_PAGE_SIZE, useIncidents } from '@/api/hooks'
import { INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS } from '@/api/types'
import { toneForStatus } from '@/lib/tone'
import { formatWallClock } from '@/lib/wallClock'
import { groupPhase, type GroupModel, type QuickRow } from '../quickGroupModel'

/**
 * The Incidents group (SHAPE §5, call 12), links only in PR A: what still needs somebody, QSC-overdue first. The QSC-overdue page comes first, then the
 * needsAttention page (open, or QSC overdue even resolved or closed): every row the server sends, up to 200, and its total is the count, so every row is
 * inside the count.
 */
export function useIncidentsGroup(enabled: boolean): GroupModel {
  // The server's MaxPageSize, so the group pages what it holds (dtable SHAPE §6).
  const overdueQsc = useIncidents({ isOverdueQsc: 'true', page: '1', pageSize: String(MAX_PAGE_SIZE) }, { enabled })
  const needsAttention = useIncidents({ needsAttention: 'true', page: '1', pageSize: String(MAX_PAGE_SIZE) }, { enabled })

  const listed = [...(overdueQsc.data ?? []), ...(needsAttention.data ?? [])]
  const rows = listed.filter((i, n) => listed.findIndex((other) => other.id === i.id) === n).map((i): QuickRow => {
    const flags: QuickRow['flags'] = []
    if (i.isOverdue24h) flags.push({ label: 'QSC overdue', tone: 'danger' })
    flags.push({ label: INCIDENT_STATUS_LABELS[i.status], tone: toneForStatus(i.status) ?? 'neutral' })
    return {
      id: i.id,
      subject: i.title,
      // When it happened is a provider wall-clock value: printed as written (lib/wallClock).
      facts: [i.involvedParticipantName, INCIDENT_TYPE_LABELS[i.incidentType], formatWallClock(i.incidentDateTime, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })],
      flags,
      // PR C adds one action here (Mark QSC reported, or Start review), after Open.
      actions: [{ kind: 'link', label: 'Open', name: `Open incident: ${i.title}`, to: `/incidents/${i.id}` }],
    }
  })

  return {
    key: 'incidents',
    title: 'Incidents',
    noun: 'open incidents',
    subjectHeader: 'Incident',
    columns: [{ header: 'Participant', long: true }, { header: 'Type' }, { header: 'When' }],
    phase: groupPhase(overdueQsc, needsAttention),
    refetch: () => { void overdueQsc.refetch(); void needsAttention.refetch() },
    count: needsAttention.data?.totalCount ?? 0,
    rows,
    link: { to: '/incidents', openLabel: 'Open Incidents' },
  }
}
