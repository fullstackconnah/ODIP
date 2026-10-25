import { useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

export const PARTICIPANT_TAB_KEYS = ['overview', 'about', 'health', 'daily', 'people', 'funding', 'records'] as const
export type ParticipantTabKey = typeof PARTICIPANT_TAB_KEYS[number]

/** The strip, in order. `noun` names a badge count for assistive tech (the badge itself is aria-hidden); `short` is the fallback label if the full ones overflow. */
export const NEW_TABS: readonly { id: ParticipantTabKey; label: string; short: string; noun?: [singular: string, plural: string] }[] = [
  { id: 'overview', label: 'Overview', short: 'Overview' },
  { id: 'about', label: 'About', short: 'About' },
  { id: 'health', label: 'Health & safety', short: 'Health', noun: ['active risk', 'active risks'] },
  { id: 'daily', label: 'Daily support', short: 'Daily', noun: ['routine', 'routines'] },
  { id: 'people', label: 'People & roster', short: 'People', noun: ['contact', 'contacts'] },
  { id: 'funding', label: 'Funding & claims', short: 'Funding' },
  { id: 'records', label: 'Notes & records', short: 'Records', noun: ['note', 'notes'] },
]

const isTabKey = (k: string): k is ParticipantTabKey => (PARTICIPANT_TAB_KEYS as readonly string[]).includes(k)

// The tabs before the regroup. Every link that carries one still works (alerts, e-mails, bookmarks). `funding` is also a new key, so it is not here.
export const OLD_KEY_TARGET: Record<string, { tab: ParticipantTabKey; hash?: string }> = {
  details: { tab: 'about', hash: 'ndis-plan' }, contacts: { tab: 'people', hash: 'contacts' },
  bookings: { tab: 'people', hash: 'trips' }, support: { tab: 'daily', hash: 'support-profile' },
  medications: { tab: 'health', hash: 'medications' }, notes: { tab: 'records', hash: 'notes' },
  routines: { tab: 'daily', hash: 'routines' },
  'restrictive-practices': { tab: 'health', hash: 'restrictive-practices' },
  claims: { tab: 'funding', hash: 'claims' }, rostering: { tab: 'people', hash: 'roster' },
  history: { tab: 'records', hash: 'history' },
}

/** An old or new tab key as {tab, hash}. A hidden tab lands on Overview with no hash; an unknown key is null. */
export function resolveTabKey(raw: string, visible: readonly ParticipantTabKey[]): { tab: ParticipantTabKey; hash?: string } | null {
  const t = OLD_KEY_TARGET[raw] ?? (isTabKey(raw) ? { tab: raw } : null)
  if (!t) return null
  return visible.includes(t.tab) ? t : { tab: 'overview' }
}

/** Rewrites an old `?tab=` key in the URL to its new tab and hash with `replace`, so Back still leaves the page. Reading the raw key is why detailScaffolding allows this file. */
export function useParticipantTabRedirect(visible: readonly ParticipantTabKey[]) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const raw = params.get('tab')
  useEffect(() => {
    if (!raw || !(raw in OLD_KEY_TARGET)) return
    const t = resolveTabKey(raw, visible)!
    const next = new URLSearchParams(params)
    if (t.tab === 'overview') next.delete('tab'); else next.set('tab', t.tab)
    navigate({ search: next.toString(), hash: t.hash ?? '' }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the key or the visible tabs change, not on every params object
  }, [raw, visible.join()])
}

/** In-page navigation for an old or new key (alert rows, the support profile's links): a push, so Back returns to where the user clicked. */
export function useParticipantGoTo(visible: readonly ParticipantTabKey[]) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  return (raw: string) => {
    const t = resolveTabKey(raw, visible)
    if (!t) return
    const next = new URLSearchParams(params)
    if (t.tab === 'overview') next.delete('tab'); else next.set('tab', t.tab)
    navigate({ search: next.toString(), hash: t.hash ?? '' })
  }
}

/**
 * Scrolls to `#section` and focuses its heading, once per hash, when the element exists and none of this participant's queries is fetching (cards
 * mount after their data, so an early scroll lands short). It stops waiting after 5 s. An enclosing <details> (the not-recorded fold) opens first.
 */
export function useScrollToHash(participantId: string | undefined) {
  const { hash, key } = useLocation()
  const qc = useQueryClient()
  useEffect(() => {
    if (!hash) return
    const id = decodeURIComponent(hash.slice(1))
    let done = false
    const holds: (() => void)[] = []
    const go = (force: boolean) => {
      if (done) return
      const el = document.getElementById(id)
      if (!el) return
      if (!force && qc.isFetching({ predicate: q => q.queryKey.includes(participantId) }) > 0) return
      done = true
      el.closest('details')?.setAttribute('open', '')
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
      const target = el.querySelector<HTMLElement>('h2,h3') ?? el
      target.tabIndex = -1
      target.focus({ preventScroll: true })
      // Sections above the target can still grow after this (their own lists load late): hold the target at the top for 3 s unless the person scrolls.
      if (typeof ResizeObserver === 'undefined') return
      let moved = false
      const stop = () => { moved = true }
      for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) window.addEventListener(ev, stop, { once: true, passive: true })
      const ro = new ResizeObserver(() => { if (!moved) el.scrollIntoView({ block: 'start', behavior: 'auto' }) })
      ro.observe(document.body)
      holds.push(() => { ro.disconnect(); for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) window.removeEventListener(ev, stop) })
      setTimeout(() => ro.disconnect(), 3000)
    }
    const first = setTimeout(() => go(false), 0) // after the tab's first render, so queries that have not started do not read as settled
    const unsubscribe = qc.getQueryCache().subscribe(() => go(false))
    const giveUp = setTimeout(() => go(true), 5000)
    return () => { done = true; holds.forEach(h => h()); clearTimeout(first); clearTimeout(giveUp); unsubscribe() }
  }, [hash, key, participantId, qc])
}
