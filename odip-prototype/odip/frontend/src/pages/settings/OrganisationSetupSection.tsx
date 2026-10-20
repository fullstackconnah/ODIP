import { useEffect } from 'react'
import { useProviderSettings } from '@/api/hooks/catalogue'
import { usePlanPricingSettings } from '@/api/hooks/plan-pricing'
import { Button } from '@/components/Button'
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { queryPhase } from '@/lib/queryPhase'

/** Optional guidance only: recorded facts never stand in for an administrator's review. Mounted by the gated Settings section. */
export default function OrganisationSetupSection() {
  const provider = useProviderSettings(true, 'always')
  const pricing = usePlanPricingSettings()
  const { refetch: refreshPricing } = pricing
  // The app caches fresh settings for 30 seconds; a return to this guide still reads current facts.
  useEffect(() => { void refreshPricing() }, [refreshPricing])
  const providerPhase = queryPhase(provider)
  const pricingPhase = queryPhase(pricing)
  const detailsRecorded = !!provider.data?.organisationName?.trim() && !!provider.data?.address?.trim()
    && ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].includes(provider.data?.state ?? '')
  const rows = [
    {
      title: 'Organisation details', purpose: 'Review the legal name and address used on your documents.',
      destination: 'organisation', action: 'Open organisation profile', phase: providerPhase,
      status: detailsRecorded ? 'Details recorded' : 'Not recorded',
      recorded: detailsRecorded, noun: 'organisation profile', retry: () => { void provider.refetch() },
    },
    {
      title: 'Registration groups', purpose: 'Review which registration groups your organisation holds.',
      destination: 'pricing', action: 'Open plan pricing', phase: pricingPhase,
      status: pricing.data?.registrationGroupsConfirmed === true ? 'Registration groups confirmed' : 'Review',
      recorded: pricing.data?.registrationGroupsConfirmed === true, noun: 'registration group list', retry: () => { void pricing.refetch() },
    },
    {
      title: 'Billing details', purpose: 'Review your invoice and billing choices.',
      destination: 'billing', action: 'Open billing details', phase: 'ready', status: 'Review', recorded: false,
    },
    {
      title: 'Safety checks', purpose: 'Review the existing warnings and checks for your organisation.',
      destination: 'safety', action: 'Open safety checks', phase: 'ready', status: 'Review', recorded: false,
    },
  ]

  return (
    <>
      <p className="max-w-prose text-[13px] text-[var(--color-muted-foreground)]">Recorded details do not mean setup is complete. Review each setting before use.</p>
      <ul className="divide-y divide-[var(--color-border)]">
        {rows.map(row => (
          <li key={row.destination} className="flex min-w-0 flex-col items-start gap-3 py-[var(--card-pad)] first:pt-0 sm:flex-row sm:items-center sm:gap-[var(--section-gap)]">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">{row.title}</h3>
              <p className="mt-1 max-w-prose text-[13px] text-[var(--color-muted-foreground)]">{row.purpose}</p>
              <div className="mt-2" aria-busy={row.phase === 'loading' || undefined}>
                {row.phase === 'loading' ? <p role="status" className="text-[13px] text-[var(--color-muted-foreground)]">Checking</p>
                  : row.phase === 'error' ? <PageState kind="error" noun={row.noun!} onRetry={row.retry} />
                    : <StatusBadge tone={row.recorded ? 'info' : 'neutral'} label={row.status} />}
              </div>
            </div>
            <Button variant="secondary" to={`/settings?section=${row.destination}`} className="shrink-0">{row.action}</Button>
          </li>
        ))}
      </ul>
    </>
  )
}
