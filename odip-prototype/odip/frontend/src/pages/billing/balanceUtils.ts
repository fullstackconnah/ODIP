/** A booking/line is "low" once 15% or less of its allocated amount remains. */
const LOW_BALANCE_RATIO = 0.15

export type BalanceStatus = 'exhausted' | 'low' | 'healthy'

export function getBalanceStatus(remaining: number, allocated: number): BalanceStatus {
  if (remaining <= 0) return 'exhausted'
  if (allocated > 0 && remaining / allocated <= LOW_BALANCE_RATIO) return 'low'
  return 'healthy'
}

/** Tailwind row-tint classes for DataTable's rowClassName — reinforces the exhausted/low
 *  state at a glance without relying on the balance column alone. */
export function balanceRowClassName(remaining: number, allocated: number): string {
  const status = getBalanceStatus(remaining, allocated)
  if (status === 'exhausted') return 'bg-[var(--color-destructive)]/5'
  if (status === 'low') return 'bg-[var(--color-conflict)]/5'
  return ''
}
