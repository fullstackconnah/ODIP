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
    <div className="mb-3 flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5" role="region" aria-label="Selection">
      {narrow && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={allShownSelected} onChange={onToggleShown} disabled={shown === 0} />
          Select shown
        </label>
      )}
      <span className="text-sm tabular-nums" aria-live="polite">{selected === 0 ? 'None selected' : `${selected} selected`}</span>
      <Button variant="ghost" size="sm" onClick={onClear} className={selected > 0 ? "" : "invisible"}>Clear</Button>
      {/* Always present on a phone so the bar never grows when a reason appears; empty it takes no room from md up. */}
      <span className={`text-sm max-md:basis-full max-md:min-h-5 empty:md:hidden ${tooMany ? 'text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}`}>{reason}</span>
      {canApprove && (
        <div className="ml-auto">
          {narrow ? (
            <Dropdown variant="menu" label="Actions" align="right" disabled={disabled} items={[{ value: 'approve', label }]} onSelect={onApprove} />
          ) : (
            <Button size="sm" onClick={onApprove} disabled={disabled}><ShieldCheck className="h-4 w-4" aria-hidden="true" />{label}</Button>
          )}
        </div>
      )}
    </div>
  )
}
