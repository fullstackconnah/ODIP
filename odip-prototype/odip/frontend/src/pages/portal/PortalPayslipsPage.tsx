import { useEffect, useRef, useState } from 'react'
import { ReceiptText } from 'lucide-react'
import { useDownloadPayslip, useMyPayslips } from '@/api/hooks'
import type { PortalPayslipDto } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { Callout } from '@/components/Callout'
import { Button } from '@/components/Button'
import { formatDateRange } from '@/lib/dateRange'
import type { AxiosError } from 'axios'
import { httpStatusOf } from '@/lib/httpStatus'
import { retryingAfterError } from '@/lib/queryPhase'
import { serverSentence } from '@/api/hooks/data-export'
import { extractErrorMessage } from '@/lib/utils'

const DASH = '–'

/** "8 Oct 2026": a single day through the house range formatter ('date' columns write 08/10/2026). */
const day = (iso: string | null) => formatDateRange(iso, iso)
const what = (p: PortalPayslipDto) => (day(p.datePaid) ? `payslip paid ${day(p.datePaid)}` : 'payslip')

/**
 * My payslips: the signed-in person's own payslips from Employment Hero, newest first, each a PDF straight from Employment Hero.
 * Dates only, never a figure. The shape brief is SHAPE.md of the EH PR 4 plan.
 */
export default function PortalPayslipsPage() {
  const query = useMyPayslips()
  const download = useDownloadPayslip()
  // One shared mutation holds only the latest press in `variables`, so the page keeps every in-flight pay run id itself.
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set())
  // The failed payslip is remembered with the list it failed under: a reloaded list clears it without an effect.
  const [failed, setFailed] = useState<{ payslip: PortalPayslipDto; status?: number; message: string; list: unknown } | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const { data, isLoading, error, refetch } = query
  const slips = data?.payslips ?? []
  const retrying = retryingAfterError(query)
  const failure = failed && failed.list === data ? failed : null

  // The callout sits at the top, but the pressed row can be far down a long list (at 390 a card is ~138px): bring it into view, and only if it is off-screen.
  const failureRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (failure) failureRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [failure])

  // `failed.list === data` alone would keep the callout after a refresh that found the same list (react-query keeps the reference), so a settled refresh clears it.
  async function refresh() {
    if (!(await refetch()).isError) setFailed(null)
  }

  async function open(payslip: PortalPayslipDto) {
    if (busy.has(payslip.payRunId)) return
    setBusy(prev => new Set(prev).add(payslip.payRunId))
    try {
      await download.mutateAsync({ payRunId: payslip.payRunId, datePaid: payslip.datePaid })
      setFailed(null)
      setAnnouncement(`${what(payslip).replace(/^p/, 'P')} downloaded.`)
    } catch (err) {
      setFailed({ payslip, status: httpStatusOf(err), message: await serverSentence((err as AxiosError).response?.data, 'Try again in a few minutes.'), list: data })
      setAnnouncement('')
    } finally {
      setBusy(prev => {
        const next = new Set(prev)
        next.delete(payslip.payRunId)
        return next
      })
    }
  }

  const columns: Column<PortalPayslipDto>[] = [
    { key: 'datePaid', header: 'Paid', mobile: 'primary', render: p => day(p.datePaid) || DASH },
    { key: 'periodStart', header: 'Pay period', mobile: 'meta', render: p => formatDateRange(p.periodStart, p.periodEnd) || DASH },
    { key: 'paySchedule', header: 'Pay schedule', mobile: 'meta', render: p => p.paySchedule || DASH },
    {
      key: 'actions', header: '', align: 'right', render: p => {
        const pending = busy.has(p.payRunId)
        return (
          <Button
            size="sm" variant="secondary" className="min-w-[8.5rem]" disabled={pending} aria-busy={pending || undefined}
            aria-label={pending ? `Downloading ${what(p)}` : `Download PDF: ${what(p)}`}
            onClick={() => open(p)}
          >
            {pending ? 'Downloading…' : 'Download PDF'}
          </Button>
        )
      },
    },
  ]

  let body
  if (httpStatusOf(error) === 403) {
    body = (
      <Callout tone="info" title="Payslips are private">Only the staff member can open their payslips, signed in as themselves.</Callout>
    )
  } else if (isLoading && !retrying) {
    body = <PageState kind="loading" noun="payslips" />
  } else if (!data) {
    const reason = extractErrorMessage(error, '')
    body = (
      <div className="space-y-2">
        <PageState kind="error" noun="payslip list" onRetry={() => refetch()} />
        {reason && <p className="text-[13px] text-[var(--color-muted-foreground)]">{reason}</p>}
      </div>
    )
  } else if (data.status === 'NotLinked') {
    body = (
      <Callout tone="info" title="Your account isn't linked to Employment Hero yet">
        We can't find your payslips until an Admin links you. Ask your manager or an Admin; they appear here once you're linked.
      </Callout>
    )
  } else if (data.status === 'NotConnected') {
    body = (
      <Callout tone="info" title="Payslips aren't available in Bunya Support">
        Your organisation doesn't connect its payroll to Bunya Support. Ask your manager where to find your payslips.
      </Callout>
    )
  } else if (slips.length === 0) {
    body = (
      <EmptyState icon={ReceiptText} title="No payslips yet" description="Your payslips appear here after your first pay run in Employment Hero." />
    )
  } else {
    body = <DataTable data={slips} columns={columns} keyField="payRunId" emptyMessage="No payslips" />
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="My payslips" subtitle="From Employment Hero, newest first. We don't keep a copy." />
      {failure && (
        <div ref={failureRef} className="max-xl:scroll-mt-16">
          <Callout
            tone="danger"
            title={`Couldn't download the ${what(failure.payslip)}.`}
            actions={failure.status === 404
              ? <Button size="sm" variant="secondary" disabled={query.isFetching} onClick={refresh}>Refresh list</Button>
              : <Button size="sm" variant="secondary" disabled={busy.has(failure.payslip.payRunId)} onClick={() => open(failure.payslip)}>Try again</Button>}
          >
            {failure.status === 404 ? 'Employment Hero no longer has it. Refresh the list.' : failure.message}
          </Callout>
        </div>
      )}
      {body}
      {/* Always mounted, so a screen reader hears the text change. */}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  )
}
