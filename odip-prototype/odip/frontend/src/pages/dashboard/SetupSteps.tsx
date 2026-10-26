import { CircleCheck } from 'lucide-react'
import type { ProviderSettingsDto, SetupStatusDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { StatusBadge } from '@/components/StatusBadge'
import { plural } from '@/lib/format'
import { organisationDetailsRecorded, setSetupHidden } from '@/lib/organisationSetup'
import { usePermissions } from '@/lib/permissions'
import { TONE } from '@/lib/tone'

type Action = { label: string; to: string }
type Row = { title: string; status: string; purpose?: string; done: boolean; optional?: boolean; actions: Action[] }

/** The setup steps, in order. Done rows fold to a line with no actions; the first required row not done carries the card's one primary. */
function buildRows(status: SetupStatusDto, provider: ProviderSettingsDto | null, canManageIntegrations: boolean): Row[] {
  const { staffCount: staff, participantCount: people, participantsWithPlanCount: plans } = status
  const fromEh = !!provider?.employmentHeroConnected
  const staffActions: Action[] = fromEh
    ? canManageIntegrations ? [{ label: 'Open integrations', to: '/settings?section=integrations' }] : []
    : [
        { label: 'Import staff', to: '/settings/import/staff' },
        { label: 'Add one', to: '/staff/new' },
        ...(status.employmentHeroAvailable && canManageIntegrations ? [{ label: 'Connect Employment Hero', to: '/settings?section=integrations' }] : []),
      ]
  const staffNoun = plural(staff, 'staff member')
  return [
    { title: 'Organisation details', done: organisationDetailsRecorded(provider), status: organisationDetailsRecorded(provider) ? 'Details recorded' : 'Not recorded',
      purpose: 'Check the legal name, address and state that go on your invoices and claims.', actions: [{ label: 'Review details', to: '/settings?section=setup' }] },
    { title: 'Staff', done: staff >= 1,
      status: fromEh ? (staff ? `${staffNoun}, from Employment Hero` : 'Waiting for the first check from Employment Hero') : staff ? `${staffNoun}, not counting Admins` : 'No staff yet',
      purpose: fromEh ? 'Bunya Support checks Employment Hero for staff every 30 minutes.' : 'Import your staff list, or add people one at a time. Each one gets a sign-in invite.',
      actions: staffActions },
    { title: 'Participants', done: people >= 1, status: people ? plural(people, 'participant') : 'No participants yet',
      purpose: 'Import your participant list, or add one at a time.',
      actions: [{ label: 'Import participants', to: '/settings/import/participants' }, { label: 'Add one', to: '/participants/new' }] },
    { title: 'Funding plans', done: plans >= 1,
      status: people < 1 ? 'Add participants first' : plans ? `${plans} of ${plural(people, 'participant')} ${people === 1 ? 'has' : 'have'} a plan` : 'No plans yet',
      purpose: "Import each participant's plan dates and budgets from a spreadsheet.",
      actions: people >= 1 ? [{ label: 'Import plans', to: '/settings/import/funding-plans' }] : [] },
    { title: 'First week rostered', done: false, status: 'Not published yet',
      purpose: 'Shifts come from approved service agreements. Start the week, assign staff, then publish it.',
      actions: [{ label: 'Open roster', to: '/rostering' }] },
    { title: 'First invoice', optional: true, done: status.hasInvoice, status: status.hasInvoice ? 'First invoice issued' : 'After your first week is delivered and claimed', actions: [] },
  ]
}

export function SetupSteps({ status, provider, card, onHide }: { status: SetupStatusDto; provider: ProviderSettingsDto | null; card: 'steps' | 'done'; onHide: () => void }) {
  const { canManageIntegrations } = usePermissions()
  const hide = (
    <Button variant="ghost" size="sm" aria-label="Hide setup steps" className="ml-auto" onClick={() => {
      setSetupHidden(true)
      document.getElementById('dashboard-alerts')?.focus()   // the card unmounts with the click, so focus goes to a stable target first
      onHide()
    }}>Hide</Button>
  )

  if (card === 'done') {
    return (
      <div className={`flex items-center gap-3 rounded-md px-[var(--section-gap)] py-[var(--section-gap)] ${TONE.success.solid}`}>
        <CircleCheck className="h-6 w-6 shrink-0" aria-hidden="true" />
        <p className="text-base font-semibold">You're set up. Your first week is published.</p>
        {hide}
      </div>
    )
  }

  const rows = buildRows(status, provider, canManageIntegrations)
  const required = rows.slice(0, 5)
  const doneCount = required.filter((r) => r.done).length
  const next = required.find((r) => !r.done)
  return (
    <Card>
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Get set up</h2>
        <span className="text-[13px] tabular-nums text-[var(--color-muted-foreground)]">{doneCount} of 5 done</span>
        {hide}
      </div>
      <ol className="mt-3 divide-y divide-[var(--color-border)]">
        {rows.map((row, i) => (
          <li key={row.title} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2 py-[var(--card-pad)] first:pt-0 last:pb-0 lg:grid-cols-[24px_minmax(0,1fr)_auto]">
            <span aria-hidden="true" className="mt-0.5">
              {row.done
                ? <CircleCheck className={`h-5 w-5 ${TONE.success.ink}`} />
                : <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs tabular-nums ${row === next ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'border border-[var(--color-border)] text-[var(--color-muted-foreground)]'}`}>{i + 1}</span>}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3">
                <span className="text-sm font-medium">{row.title}</span>
                {row.optional ? <StatusBadge tone="neutral" label="Optional" /> : null}
                <span className="text-[13px] text-[var(--color-muted-foreground)]">{row.status}</span>
              </div>
              {row === next && row.purpose ? <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">{row.purpose}</p> : null}
            </div>
            {!row.done && row.actions.length ? (
              <div className="col-start-2 mt-2 flex flex-wrap gap-2 lg:col-start-3 lg:row-start-1 lg:mt-0">
                {row.actions.map((a, j) => (
                  <Button key={a.label} to={a.to} size="md" variant={row === next && j === 0 ? 'primary' : 'secondary'} className="whitespace-nowrap">{a.label}</Button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  )
}
