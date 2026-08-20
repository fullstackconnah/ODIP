import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { getBalanceStatus, type BalanceStatus } from './balanceUtils'

const STATUS_TEXT_CLASS: Record<BalanceStatus, string> = {
  exhausted: 'text-[var(--color-destructive)]',
  low: 'text-[var(--color-conflict)]',
  healthy: 'text-[var(--color-success)]',
}

const STATUS_LABEL: Record<BalanceStatus, string> = {
  exhausted: 'Exhausted',
  low: 'Low balance',
  healthy: 'Healthy',
}

export type BalanceIndicatorProps = {
  remaining: number
  allocated: number
  /** Compact mode drops the pill/icon chrome for use inside a lines table. */
  compact?: boolean
}

/**
 * Renders remaining balance as the dominant visual element of the cell — bold,
 * larger type, colour-coded, with an icon and a filled pill on the exhausted
 * state so it reads at a glance from a full row of numbers. Uses only the
 * existing semantic tokens: --color-destructive (exhausted), --color-conflict
 * (low), --color-success (healthy).
 */
export function BalanceIndicator({ remaining, allocated, compact }: BalanceIndicatorProps) {
  const status = getBalanceStatus(remaining, allocated)
  const label = `${STATUS_LABEL[status]}: ${formatCurrency(remaining)} remaining of ${formatCurrency(allocated)} allocated`

  if (status === 'exhausted') {
    return (
      <div className="flex items-center justify-end gap-1.5" aria-label={label}>
        <span className={`inline-flex items-center gap-1 ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'} rounded-full bg-[var(--color-destructive)] text-white`}>
          <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
          <span className={`font-bold tabular-nums ${compact ? 'text-xs' : 'text-sm'}`}>{formatCurrency(remaining)}</span>
        </span>
      </div>
    )
  }

  return (
    <div className={`flex items-center justify-end gap-1.5 ${STATUS_TEXT_CLASS[status]}`} aria-label={label}>
      {status === 'low'
        ? <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
        : <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />}
      <span className={`font-bold tabular-nums ${compact ? 'text-sm' : 'text-base'}`}>{formatCurrency(remaining)}</span>
    </div>
  )
}
