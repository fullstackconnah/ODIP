import { useEffect, useState, type SyntheticEvent } from 'react'

/**
 * Open state for a `<details>` that should open when `shouldOpen` turns true (content arrives) and never close on its own.
 * Binding `open` straight to a value derived from the form makes React close the fold under the person when they clear the last field.
 */
export function useStickyOpen(shouldOpen: boolean) {
  const [open, setOpen] = useState(shouldOpen)
  useEffect(() => { if (shouldOpen) setOpen(true) }, [shouldOpen])
  return { open, onToggle: (e: SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open) }
}
