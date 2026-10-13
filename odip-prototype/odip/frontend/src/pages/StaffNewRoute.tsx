import { Link } from 'react-router-dom'
import { useProviderSettings } from '@/api/hooks'
import { Callout } from '@/components/Callout'
import StaffCreatePage from './StaffCreatePage'

/** /staff/new. A connected organisation's staff come from Employment Hero, so the form gives way to where to add them. The server refuses a create too. */
export default function StaffNewRoute() {
  const settings = useProviderSettings()
  if (settings.isLoading) return null
  if (settings.data?.employmentHeroConnected) {
    return (
      <Callout tone="info" title="Staff come from Employment Hero for this organisation. Add them there; they appear here within 30 minutes.">
        <Link to="/staff" className="underline">Back to staff</Link>
      </Callout>
    )
  }
  return <StaffCreatePage />
}
