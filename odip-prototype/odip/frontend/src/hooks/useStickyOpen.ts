import { useState, type SyntheticEvent } from 'react'

/**
 * Open state for a `<details>` that should open when `shouldOpen` turns true (content arrives) and never close on its own.
 * Binding `open` straight to a value derived from the form makes React close the fold under the person when they clear the last field.
 */
export function useStickyOpen(shouldOpen: boolean) {
  const [open, setOpen] = useState(shouldOpen)
  const [seen, setSeen] = useState(shouldOpen)
  // Adjusted during render, not in an effect: the fold opens in the same pass the content arrives.
  if (shouldOpen !== seen) {
    setSeen(shouldOpen)
    if (shouldOpen) setOpen(true)
  }
  return { open, onToggle: (e: SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open) }
}
