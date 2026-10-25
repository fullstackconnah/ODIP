import { Card } from '@/components/Card'
import { FactList } from '@/components/FactList'
import { ServiceStreamBadges } from '@/components/ServiceStreamBadges'
import { parseServiceStreams, type ParticipantDetailDto } from '@/api/types/participants'

/** Region and service streams, read-only: they are set in the wizard and the header badges only show them. */
export function ServicesCard({ p }: { p: ParticipantDetailDto }) {
  const streams = parseServiceStreams(p.serviceStreams)
  return (
    <Card title="Services">
      <FactList items={[
        { label: 'Region', value: p.region || undefined },
        { label: 'Service streams', value: streams.length ? <ServiceStreamBadges value={p.serviceStreams} /> : undefined },
      ]} />
    </Card>
  )
}
