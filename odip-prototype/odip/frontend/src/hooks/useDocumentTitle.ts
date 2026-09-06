import { useEffect } from 'react'

/**
 * I-4: gives each route a distinct document.title. Before this, all 30 routes left index.html's
 * static "Odip — NDIS Trip Management" untouched, so tab-switching and the back button carried
 * no per-page orientation. Wired into PageHeader so any page already passing it a `title` gets
 * this for free.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previousTitle = document.title
    document.title = title ? `${title} — Odip` : 'Odip'
    return () => {
      document.title = previousTitle
    }
  }, [title])
}
