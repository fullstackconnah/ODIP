import { statusClass } from '@/lib/tone'

// ── Payment Status Constants ────────────────────────────────

// Through the one status table (lib/tone.ts), so a payment word wears the same tone as on any StatusBadge.
export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  NotInvoiced: statusClass('NotInvoiced'),
  InvoiceSent: statusClass('InvoiceSent'),
  Partial:     statusClass('Partial'),
  Paid:        statusClass('Paid'),
  Overdue:     statusClass('Overdue'),
}

export const PAYMENT_STATUS_ITEMS = [
  { value: 'NotInvoiced', label: 'Not Invoiced' },
  { value: 'InvoiceSent', label: 'Invoice Sent' },
  { value: 'Partial',     label: 'Partial' },
  { value: 'Paid',        label: 'Paid' },
  { value: 'Overdue',     label: 'Overdue' },
]
