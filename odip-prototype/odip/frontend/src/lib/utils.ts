import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function maskNdisNumber(ndis: string | null | undefined): string {
  if (!ndis) return '—'
  return '••••••••' + ndis.slice(-1)
}

export function formatDateAu(date: string | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function getStatusColor(status: string): string {
  const s = status.toLowerCase()
  if (['confirmed', 'completed', 'available'].includes(s)) return 'bg-[#bbf37c] text-[#0f2000]'
  if (['draft', 'proposed'].includes(s)) return 'bg-[#e4e2de] text-[#43493a]'
  if (['cancelled', 'unavailable', 'nolongerattending', 'expired'].includes(s)) return 'bg-[#ffdad6] text-[#93000a]'
  if (['overdue', 'conflict'].includes(s)) return 'bg-[#ffdad6] text-[#93000a]'
  if (['none'].includes(s)) return 'bg-[#e4e2de] text-[#43493a]'
  return 'bg-[#fef3c7] text-[#92400e]'
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount)
}
