import type { ReactNode } from 'react'
import PlatformFooter from '@/components/layout/PlatformFooter'
import { TAP_FLOOR } from '@/components/tapArea'
import { Wordmark } from '@/components/Wordmark'

/**
 * The frame for the public reading pages: /accessibility now, and the legal documents once they are published. It has a 48px bar
 * holding only the wordmark (a link, not a heading, so the page keeps its one h1), one 68ch reading column at the body step
 * (1rem / 1.6: long-form text needs more than the 14px data step), and the public footer. There is no sidebar, nav or back button:
 * the browser's Back works, and the wordmark goes home. It is a plain <a>, not a router Link, on purpose: route-gate.js (the classic
 * script in index.html's head) only runs on a full page load, and it is what sends a signed-out reader on "/" to /welcome/; a
 * client-side Link would land them on /login instead. This frame holds no form, so the unsaved-changes blocker has nothing to guard.
 */
export default function PublicPage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-background)] text-[var(--color-foreground)]">
      <header className="flex h-12 items-center">
        {/* The reading column's own box, so the wordmark lines up with the h1 rather than the window edge. */}
        <div className="mx-auto w-full max-w-[68ch] px-[var(--gutter,20px)]">
          <a
            href="/"
            aria-label="Bunya Support home"
            className={`${TAP_FLOOR} rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]`}
          >
            <Wordmark size={21} />
          </a>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-[68ch] px-[var(--gutter,20px)] py-8 text-base leading-[1.6]">{children}</div>
      </main>
      <PlatformFooter variant="public" />
    </div>
  )
}
