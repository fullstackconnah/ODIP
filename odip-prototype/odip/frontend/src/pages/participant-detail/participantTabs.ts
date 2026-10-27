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
  bookings: { tab: 'people', hash: 'trips' }, support: { tab: 'daily', hash: 'support-needs' },
  medications: { tab: 'health', hash: 'medications' }, notes: { tab: 'records', hash: 'notes' },
  routines: { tab: 'daily', hash: 'routines' },
  'restrictive-practices': { tab: 'health', hash: 'restrictive-practices' },
  claims: { tab: 'funding', hash: 'claims' }, rostering: { tab: 'people', hash: 'roster' },
  history: { tab: 'records', hash: 'history' },
}

/** What hides a section, beyond the tab itself. The page computes each from the role and the participant. */
export type SectionGate = 'rostering' | 'planBudget' | 'claims' | 'history' | 'communityStream' | 'earlierChecklist'
export type CountKey = 'health' | 'daily' | 'people' | 'records' // useParticipantTabCounts' keys, which are also tab ids
/** `list`: never quiet, it owns its empty state. `nested`: ids of elements inside this section that a `#hash` may name. */
export type SubTab = { id: string; label: string; list?: true; count?: CountKey; gate?: SectionGate; nested?: readonly string[] }
export type GroupedTabKey = Exclude<ParticipantTabKey, 'overview'>

/** The sections of each grouped tab in page order, one sub-tab each. Labels are the short chip labels; a section's card keeps its full heading. */
export const SUB_TABS: Record<GroupedTabKey, readonly SubTab[]> = {
  about: [
    { id: 'identity', label: 'Identity' }, { id: 'home-and-living', label: 'Address & living' }, { id: 'ndis-plan', label: 'NDIS & funding' },
    { id: 'services', label: 'Services' }, { id: 'key-identifiers', label: 'Key identifiers' }, { id: 'culture-and-rights', label: 'Cultural background' },
    { id: 'about-me', label: 'About me' },
  ],
  health: [
    { id: 'emergency', label: 'Emergency' }, { id: 'medical', label: 'Medical' }, { id: 'health-conditions', label: 'Conditions', list: true },
    { id: 'medications', label: 'Medications', list: true }, { id: 'behaviour-and-communication', label: 'Behaviour & communication' },
    { id: 'behaviour-support', label: 'Behaviour support' }, { id: 'risks', label: 'Risks', list: true, count: 'health', nested: ['risks-summary'] },
    { id: 'restrictive-practices', label: 'Restrictive practices', list: true }, { id: 'community-access-risk', label: 'Earlier checklist', gate: 'earlierChecklist' },
  ],
  daily: [
    { id: 'support-needs', label: 'Support needs' }, { id: 'mobility-and-personal-care', label: 'Mobility & personal care' },
    { id: 'equipment-and-overnight', label: 'Equipment & overnight' }, { id: 'daily-living', label: 'Daily living', list: true },
    { id: 'routines', label: 'Routines', list: true, count: 'daily' }, { id: 'meals', label: 'Meals & diet' },
    { id: 'typical-day', label: 'Typical day', gate: 'communityStream' }, { id: 'transport-and-travel', label: 'Transport & travel' },
  ],
  people: [
    { id: 'contacts', label: 'Contacts', list: true, count: 'people' }, { id: 'roster', label: 'Rostering', list: true, gate: 'rostering' },
    { id: 'trips', label: 'Bookings', list: true },
  ],
  funding: [{ id: 'plan-budget', label: 'Plan budget', gate: 'planBudget' }, { id: 'claims', label: 'Claims', list: true, gate: 'claims' }],
  records: [
    { id: 'notes', label: 'Notes', list: true, count: 'records' }, { id: 'consents', label: 'Consents', list: true },
    { id: 'history', label: 'History', list: true, gate: 'history' },
  ],
}

export const visibleSubTabs = (tab: GroupedTabKey, gates: Record<SectionGate, boolean>) => SUB_TABS[tab].filter(r => !r.gate || gates[r.gate])

/** The section a hash names on this tab: a row id, or an element nested in one (`risks-summary` is in `risks`). Another tab's id is null. */
export const sectionForHash = (rows: readonly SubTab[], hashId: string) => rows.find(r => r.id === hashId || r.nested?.includes(hashId))?.id ?? null

/** The shown section: the hash's, else a visible `section=`, else the first visible row. An unknown or hidden `section=` falls back. */
export const resolveSection = (rows: readonly SubTab[], hashId: string, param: string | null) =>
  sectionForHash(rows, hashId) ?? (rows.some(r => r.id === param) ? param! : rows[0]?.id)

/** The hash is read during render now, so a malformed one (`#%E0`) must not throw: it matches no row. */
export const safeDecode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

/**
 * `?section=` for the open grouped tab, and the two setters. Both write with `replace`, drop the hash (a leftover `#id` would override the next
 * choice) and do nothing for the current value (Tabs fires onChange on a click on the active tab). `selectTab` also drops `section`, in the same write.
 */
export function useParticipantSection(tab: ParticipantTabKey, rows: readonly SubTab[]) {
  const [params] = useSearchParams()
  const { hash } = useLocation()
  const navigate = useNavigate()
  const section = tab === 'overview' ? undefined : resolveSection(rows, safeDecode(hash.slice(1)), params.get('section'))
  const write = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    mutate(next)
    navigate({ search: next.toString(), hash: '' }, { replace: true })
  }
  const setSection = (id: string) => {
    if (id !== section && rows.some(r => r.id === id)) write(p => { if (id === rows[0].id) p.delete('section'); else p.set('section', id) })
  }
  const selectTab = (next: ParticipantTabKey) => {
    if (next !== tab) write(p => { p.delete('section'); if (next === 'overview') p.delete('tab'); else p.set('tab', next) })
  }
  return { section, setSection, selectTab }
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
    if (t.hash) next.set('section', t.hash); else next.delete('section')
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
    if (t.hash) next.set('section', t.hash); else next.delete('section')
    navigate({ search: next.toString(), hash: t.hash ?? '' })
  }
}

/**
 * Scrolls to `#section` and focuses its heading, once per hash, when the element exists and none of this participant's queries is fetching (cards
 * mount after their data, so an early scroll lands short). It stops waiting after 5 s. An enclosing <details> (a fixed-list fold) opens first.
 */
export function useScrollToHash(participantId: string | undefined) {
  const { hash, key } = useLocation()
  const qc = useQueryClient()
  useEffect(() => {
    if (!hash) return
    const id = safeDecode(hash.slice(1))
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
      // A heading inside a still-closed fold is not rendered, so focusing it would drop focus: skip those.
      const target = [...el.querySelectorAll<HTMLElement>('h2,h3')].find(h => !h.closest('details:not([open])')) ?? el
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
