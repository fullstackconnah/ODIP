import type { ReactNode } from 'react'

/** Wraps each claim or invoice reference (TC-20261022-0003, INV-0042) in a no-wrap span, so server text never breaks mid-reference and still copies as typed. */
export function noBreakRefs(text: string): ReactNode {
  return text.split(/(\b(?:TC|INV)(?:-\d+)+\b)/).map((part, i) => i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part)
}
