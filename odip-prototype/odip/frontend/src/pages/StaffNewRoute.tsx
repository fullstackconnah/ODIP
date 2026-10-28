import { useProviderSettings } from '@/api/hooks'
import { BackButton } from '@/components/BackButton'
import { Callout } from '@/components/Callout'
import { PageHeader } from '@/components/PageHeader'
import StaffCreatePage from './StaffCreatePage'

/** /staff/new. A connected organisation's staff come from Employment Hero, so the form gives way to where to add them. The server refuses a create too. */
export default function StaffNewRoute() {
  const settings = useProviderSettings()
  if (settings.isLoading) return null
  if (settings.data?.employmentHeroConnected) {
    return (
      <div className="flex flex-col gap-[var(--section-gap)]">
        <PageHeader title="New staff member" />
        <Callout tone="info" title="Staff come from Employment Hero for this organisation. Add them there; they appear here within 30 minutes.">
          <BackButton to="/staff" label="staff" variant="link" />
        </Callout>
      </div>
    )
  }
  return <StaffCreatePage />
}
