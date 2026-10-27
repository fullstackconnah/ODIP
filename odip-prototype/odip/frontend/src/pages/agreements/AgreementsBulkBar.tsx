import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/Button'
import { Dropdown } from '@/components/Dropdown'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { MAX_SELECTED } from './agreementRows'

interface Props {
  selected: number
  /** Ticked rows that have a draft waiting. */
  approvable: number
  /** The Approve button exists only for a role that may approve. */
  canApprove: boolean
  shown: number
  allShownSelected: boolean
  onToggleShown: () => void
  onClear: () => void
  onApprove: () => void
}

/** The bar above the table: how many are ticked, Clear, and Approve. In flow (never sticky), so nothing covers it and ticking moves nothing. */
export function AgreementsBulkBar({ selected, approvable, canApprove, shown, allShownSelected, onToggleShown, onClear, onApprove }: Props) {
  const narrow = useIsBelowMd()
  const tooMany = selected > MAX_SELECTED
  const reason = tooMany ? `Choose ${MAX_SELECTED} or fewer (${selected} selected).`
    : selected > 0 && approvable === 0 ? 'None of the ticked rows has a draft waiting.' : null
  const label = approvable > 0 ? `Approve ${approvable}` : 'Approve'
  const disabled = tooMany || approvable === 0
  return (
    <div className="mb-3 flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 max-md:flex-nowrap max-md:gap-x-3" role="region" aria-label="Selection">
      {narrow && (
        // The same box as the table's row boxes (DataTable), so it wears the house accent and a 44 px target.
        <label className="inline-flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] shrink-0 items-center justify-center">
          <input type="checkbox" className="rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer" checked={allShownSelected} onChange={onToggleShown} disabled={shown === 0} />
          <span className="sr-only">Select shown</span>
        </label>
      )}
      <span className="text-sm tabular-nums" aria-live="polite">{selected === 0 ? 'None selected' : `${selected} selected`}</span>
      {/* A phone has no room for Clear or a reason line: the box clears, and the reason is the Actions item's own. */}
      {!narrow && (
        <>
          <Button variant="ghost" size="sm" onClick={onClear} className={selected > 0 ? "" : "invisible"}>Clear</Button>
          <span className={`text-sm empty:hidden ${tooMany ? 'text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}`}>{reason}</span>
        </>
      )}
      {canApprove && (
        <div className="ml-auto">
          {narrow ? (
            <Dropdown variant="menu" label="Actions" align="right" disabled={selected === 0} items={[{ value: 'approve', label, description: reason ?? undefined, disabled }]} onSelect={onApprove} />
          ) : (
            <Button size="sm" onClick={onApprove} disabled={disabled}><ShieldCheck className="h-4 w-4" aria-hidden="true" />{label}</Button>
          )}
        </div>
      )}
    </div>
  )
}
