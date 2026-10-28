import { CalendarPlus, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react'
import { Button } from '@/components/Button'
import { Dropdown } from '@/components/Dropdown'
import type { AgreementBulkAction } from '@/api/types'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { MAX_SELECTED } from './agreementRows'

const RENEW_REASON = "Your role can't renew agreements. An Admin can change who may approve in Settings, Plan pricing."

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
  /** Renew, Reprice and Extend: absent where only Approve belongs (the review screen). */
  onAction?: (action: AgreementBulkAction) => void
  /** A line for the status area when nothing else needs saying, e.g. who an Approve leaves out. */
  note?: string
}

/** The bar above the table: how many are ticked, Clear, and Approve. In flow (never sticky), so nothing covers it and ticking moves nothing. */
export function AgreementsBulkBar({ selected, approvable, canApprove, shown, allShownSelected, onToggleShown, onClear, onApprove, onAction, note }: Props) {
  const narrow = useIsBelowMd()
  const tooMany = selected > MAX_SELECTED
  const reason = tooMany ? `Choose ${MAX_SELECTED} or fewer (${selected} selected).` : null
  const approveReason = selected > 0 && approvable === 0 ? 'None of the ticked rows has a draft waiting.' : null
  const label = approvable > 0 ? `Approve ${approvable}` : 'Approve'
  const approveOff = tooMany || approvable === 0
  const draftOff = tooMany || selected === 0
  // Renew needs an approver; Reprice and Extend do not.
  const renewOff = !canApprove
  const renewReason = renewOff && selected > 0 ? RENEW_REASON : null
  const verbs: { value: AgreementBulkAction; label: string; icon: typeof RefreshCw }[] = [
    { value: 'renew', label: selected > 0 ? `Renew ${selected}` : 'Renew', icon: RefreshCw },
    { value: 'reprice', label: 'Reprice to…', icon: TrendingUp },
    { value: 'extend', label: 'Extend to…', icon: CalendarPlus },
  ]
  const items = [
    ...(onAction ? verbs.map(v => ({ value: v.value, label: v.label, description: reason ?? (v.value === 'renew' ? renewReason : null) ?? undefined, disabled: draftOff || (v.value === 'renew' && renewOff) })) : []),
    ...(canApprove ? [{ value: 'approve', label, description: reason ?? approveReason ?? undefined, disabled: approveOff }] : []),
  ]
  return (
    <div className="mb-3 flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 max-md:flex-nowrap max-md:gap-x-3" role="region" aria-label="Selection">
      {narrow && (
        // The same box as the table's row boxes (DataTable), so it wears the house accent and a 44 px target.
        <label className="inline-flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] shrink-0 items-center justify-center">
          <input type="checkbox" className="rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer" checked={allShownSelected} onChange={onToggleShown} disabled={shown === 0} />
          <span className="sr-only">Select shown</span>
        </label>
      )}
      <span className={`text-sm tabular-nums ${tooMany && narrow ? 'text-[var(--color-destructive)]' : ''}`} aria-live="polite">{tooMany && narrow ? reason : selected === 0 ? 'None selected' : `${selected} selected`}</span>
      {/* A phone has no room for Clear or a reason line: the box clears, and a disabled item gives its own reason. */}
      {!narrow && (
        <>
          <Button variant="ghost" size="sm" onClick={onClear} className={selected > 0 ? "" : "invisible"}>Clear</Button>
          <span className={`text-sm empty:hidden ${tooMany ? 'text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}`}>{tooMany ? reason : (onAction && renewReason) || (canApprove && approveReason) || note}</span>
        </>
      )}
      {items.length > 0 && (
        <div className="ml-auto">
          {narrow ? (
            <Dropdown variant="menu" label="Actions" align="right" disabled={selected === 0} items={items} onSelect={value => (value === 'approve' ? onApprove() : onAction?.(value as AgreementBulkAction))} />
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {onAction && verbs.map(v => (
                <Button key={v.value} size="sm" variant="secondary" onClick={() => onAction(v.value)} disabled={draftOff || (v.value === 'renew' && renewOff)}><v.icon className="h-4 w-4" aria-hidden="true" />{v.label}</Button>
              ))}
              {canApprove && <Button size="sm" onClick={onApprove} disabled={approveOff} title={reason ?? approveReason ?? undefined}><ShieldCheck className="h-4 w-4" aria-hidden="true" />{label}</Button>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
