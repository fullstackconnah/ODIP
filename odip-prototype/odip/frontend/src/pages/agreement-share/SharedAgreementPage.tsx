/**
 * The page a contact reaches from the emailed link (agreement PR3b): the agreement to read and download, nothing to approve. Public, token-authenticated and outside the app shell, like the
 * caregiver form: no PrivateRoute, no layout chrome, and its requests carry no session (useSharedAgreement). An unknown, expired or replaced link shows one message for all three.
 */
import { useEffect, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { sharedAgreementPdfUrl, useSharedAgreement } from '@/api/hooks/service-agreement-drafts'
import { Callout } from '@/components/Callout'
import PlatformFooter from '@/components/layout/PlatformFooter'
import { TAP_FLOOR } from '@/components/tapArea'
import { Wordmark } from '@/components/Wordmark'
import { formatCurrency, formatWithTimeZone } from '@/lib/utils'

const day = (iso: string) => formatWithTimeZone(iso, undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// A person's link must not be indexed or kept as a page title in a shared history.
function useNoIndex() {
  useEffect(() => {
    const previous = document.title
    document.title = 'Service agreement'
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => { document.title = previous; meta.remove() }
  }, [])
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-background)] text-[var(--color-foreground)]">
      <header className="flex h-12 items-center">
        <div className="mx-auto w-full max-w-3xl px-[var(--gutter)]"><Wordmark size={21} /></div>
      </header>
      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-[var(--gutter)] pb-8">{children}</div>
      </main>
      <PlatformFooter variant="public" support={false} />
    </div>
  )
}

export default function SharedAgreementPage() {
  const { token } = useParams<{ token: string }>()
  const agreement = useSharedAgreement(token)
  useNoIndex()

  if (agreement.isLoading) return <Shell><p role="status">Loading…</p></Shell>
  const data = agreement.data
  if (!data) {
    return (
      <Shell>
        <h1 className="mb-3 text-xl font-bold">Service agreement</h1>
        <Callout tone="warning">This link isn&apos;t valid any more. It may have expired or been replaced. Please contact the organisation that sent it.</Callout>
      </Shell>
    )
  }

  const reach = [data.contactEmail && `reply to ${data.contactEmail}`, data.contactPhone && `call ${data.contactPhone}`].filter(Boolean).join(' or ')
  return (
    <Shell>
      <div className="mb-[var(--section-gap)]">
        <p className="mb-1 text-sm text-[var(--color-muted-foreground)]">From {data.providerName}</p>
        <h1 className="text-xl font-bold">Service agreement for {data.participantName}</h1>
        <p className="mt-1 text-sm">{data.periodText}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">What the agreement provides and what it costs</caption>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left">
              <th scope="col" className="py-2 pr-3 font-semibold">Support</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Quantity</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Price</th>
              <th scope="col" className="py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line, index) => (
              <tr key={`${line.item}-${index}`} className="border-b border-[var(--color-border)] align-top">
                <th scope="row" className="py-2 pr-3 text-left font-normal">{line.item}</th>
                <td className="py-2 pr-3 text-right tabular-nums">{line.quantity} {line.unit}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(line.unitPrice)}</td>
                <td className="py-2 text-right tabular-nums">{formatCurrency(line.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3} className="py-2 pr-3 text-right font-semibold">Total</th>
              <td className="py-2 text-right font-semibold tabular-nums">{formatCurrency(data.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-[var(--section-gap)] flex flex-col gap-3">
        <a className={`${TAP_FLOOR} gap-2 self-start font-medium underline`} href={sharedAgreementPdfUrl(token!)}>
          <Download className="h-4 w-4" aria-hidden="true" />Download PDF
        </a>
        {reach && <p className="text-sm">To agree to this service agreement, {reach}.</p>}
        <p className="text-sm text-[var(--color-muted-foreground)]">This link works until {day(data.expiresAt)}. You can read and download the agreement here but not approve it.</p>
      </div>
    </Shell>
  )
}
