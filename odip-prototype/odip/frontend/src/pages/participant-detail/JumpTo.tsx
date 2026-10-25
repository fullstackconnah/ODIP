import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListTree } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'

type JumpItem = { id: string; label: string }

const MIN_ITEMS = 3

/** The `[data-jump]` sections currently in the panel, in page order. State changes only when the id list does, so a re-render of the panel is not a re-render of the rail. */
function useJumpItems(ref: React.RefObject<HTMLElement | null>): JumpItem[] {
  const [items, setItems] = useState<JumpItem[]>([])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const next = [...el.querySelectorAll<HTMLElement>('[data-jump]')].map(s => ({ id: s.id, label: s.getAttribute('aria-label') ?? s.id }))
      setItems(prev => (prev.map(i => i.id).join('|') === next.map(i => i.id).join('|') ? prev : next))
    }
    read()
    const mo = new MutationObserver(read)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [ref])
  return items
}

/** The section the reader is in: the last one whose top has passed the upper 30% of the viewport. */
function useScrollSpy(ids: string[]): string | undefined {
  const [current, setCurrent] = useState<string>()
  const key = ids.join('|')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !key) return
    const seen = new Set<string>()
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) seen.add(e.target.id)
        else seen.delete(e.target.id)
      }
      setCurrent(key.split('|').find(id => seen.has(id)) ?? undefined)
    }, { rootMargin: '0px 0px -70% 0px' })
    for (const id of key.split('|')) { const el = document.getElementById(id); if (el) io.observe(el) }
    return () => io.disconnect()
  }, [key])
  return current
}

/**
 * Wraps a tab's panel with in-page navigation: a "Jump to" menu below 1100px of panel width, a sticky right-hand rail from there up.
 * Both list the panel's `[data-jump]` sections and go through the hash, so useScrollToHash scrolls and focuses. Nothing shows under
 * three sections: a short tab does not need a map.
 */
export function JumpPanel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const items = useJumpItems(ref)
  const current = useScrollSpy(items.map(i => i.id))
  const show = items.length >= MIN_ITEMS
  const go = (id: string) => navigate({ hash: `#${id}` }, { replace: true })

  return (
    <div ref={ref} className="@container">
      <div className="@min-[1100px]:grid @min-[1100px]:grid-cols-[minmax(0,1fr)_11rem] @min-[1100px]:gap-[var(--section-gap)]">
        <div className="min-w-0">
          {show && (
            <div className="mb-[var(--section-gap)] flex justify-end @min-[1100px]:hidden">
              <Dropdown variant="menu" triggerVariant="secondary" label="Jump to" icon={<ListTree className="w-4 h-4" />}
                items={items.map(i => ({ value: i.id, label: i.label }))} onSelect={go} />
            </div>
          )}
          {children}
        </div>
        {show && (
          <nav aria-label="On this page" className="hidden @min-[1100px]:block sticky top-14 self-start text-sm">
            <p className="mb-1 text-[13px] text-[var(--color-muted-foreground)]">On this page</p>
            <ul className="flex flex-col">
              {items.map(i => (
                <li key={i.id}>
                  <a
                    href={`#${i.id}`}
                    aria-current={current === i.id ? 'location' : undefined}
                    onClick={e => { e.preventDefault(); go(i.id) }}
                    className="flex min-h-[var(--tap-min)] items-center py-1 pl-2 border-l-2 border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] aria-[current=location]:border-[var(--color-primary)] aria-[current=location]:font-medium aria-[current=location]:text-[var(--color-primary)]"
                  >
                    {i.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  )
}
