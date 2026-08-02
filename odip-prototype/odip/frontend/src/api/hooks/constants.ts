// ── Payment Status Constants ────────────────────────────────

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  NotInvoiced: 'Not Invoiced',
  InvoiceSent: 'Invoice Sent',
  Partial:     'Partial',
  Paid:        'Paid',
  Overdue:     'Overdue',
}

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  NotInvoiced: 'bg-neutral-100 text-neutral-600',
  InvoiceSent: 'bg-blue-100 text-blue-700',
  Partial:     'bg-amber-100 text-amber-700',
  Paid:        'bg-green-100 text-green-700',
  Overdue:     'bg-red-100 text-red-700',
}

export const PAYMENT_STATUS_ITEMS = [
  { value: 'NotInvoiced', label: 'Not Invoiced' },
  { value: 'InvoiceSent', label: 'Invoice Sent' },
  { value: 'Partial',     label: 'Partial' },
  { value: 'Paid',        label: 'Paid' },
  { value: 'Overdue',     label: 'Overdue' },
]
