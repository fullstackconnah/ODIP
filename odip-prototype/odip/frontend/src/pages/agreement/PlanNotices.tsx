import { Link } from 'react-router-dom'
import type { PlanNotice } from '@/api/types'
import { Callout } from '@/components/Callout'
import { friendlyMessage } from '@/lib/planQuote'
import { usePermissions } from '@/lib/permissions'

const REGISTRATION_NOTICE = 'registration-groups-not-confirmed'

const NOTICE_TITLE: Record<string, { title: string; tone: 'warning' | 'info' }> = {
  'holiday-calendar-missing': { title: 'The public holiday calendar has gaps', tone: 'warning' },
  'holiday-overrides-end': { title: 'Part-day holidays may be missing', tone: 'info' },
}

type PlanNoticesProps = {
  notices: readonly PlanNotice[]
}

/**
 * What applies to the whole agreement rather than to one line, in the engine's own words: the registration groups nobody has confirmed (a quiet line, with the way to confirm them), and the
 * stretches of the agreement the holiday calendar cannot be trusted for. Never blocks anything, and never interrupts: these are standing notices, so they are not announced again each
 * time the step they are on comes back.
 */
export function PlanNotices({ notices }: PlanNoticesProps) {
  const { isAdmin, isSuperAdmin } = usePermissions()
  const registration = notices.find(notice => notice.code === REGISTRATION_NOTICE)
  const others = notices.filter(notice => notice.code !== REGISTRATION_NOTICE)
  if (!registration && others.length === 0) return null
  const loud = others.filter(notice => (NOTICE_TITLE[notice.code]?.tone ?? 'info') === 'warning')
  const quiet = others.filter(notice => (NOTICE_TITLE[notice.code]?.tone ?? 'info') !== 'warning')
  return (
    <section aria-labelledby="check-notices" className="flex flex-col gap-2">
      <h3 id="check-notices" className="text-sm font-semibold">Good to know</h3>
      {registration && (
        <p className="text-sm text-[var(--color-muted-foreground)]" title={registration.message}>
          Registration groups are not confirmed.{' '}
          {isAdmin || isSuperAdmin
            ? <Link to="/settings?section=pricing" className="whitespace-nowrap font-medium text-[var(--color-primary)] underline underline-offset-2">Confirm in Settings</Link>
            : 'Ask an Admin to confirm them.'}
        </p>
      )}
      {loud.map(notice => (
        <Callout key={notice.code} tone="warning" announce={false} className="max-w-prose" title={NOTICE_TITLE[notice.code]?.title}>
          {friendlyMessage(notice.message, [])}
        </Callout>
      ))}
      {quiet.length > 0 && (
        <details className="text-sm text-[var(--color-muted-foreground)]">
          <summary className="cursor-pointer select-none">{quiet.map(notice => (NOTICE_TITLE[notice.code]?.title ?? 'Check this before you rely on the prices')).join('; ')}</summary>
          <ul className="mt-1 flex max-w-prose flex-col gap-1">{quiet.map(notice => <li key={notice.code}>{friendlyMessage(notice.message, [])}</li>)}</ul>
        </details>
      )}
    </section>
  )
}
