import type { LeaveBalanceDto } from '@/api/types'

/** "76.0 hours", "−3.8 hours" (U+2212), "10.0 days": one decimal, en-AU, as EH reports it. */
export function formatBalance(b: LeaveBalanceDto): string {
  const n = b.amount.toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace('-', '−')
  return `${n} ${b.unit.toLowerCase()}`
}
