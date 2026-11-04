import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { TAP_FLOOR } from '@/components/tapArea'
import { PLATFORM_INFO, type PlatformInfo } from '@/lib/platformInfo'
import { ACKNOWLEDGEMENT_OF_COUNTRY, platformFacts } from '@/lib/platformFacts'

type Variant = 'shell' | 'public'

/**
 * The variant sets the frame; there is no className prop. shell: below lg the fixed bottom nav covers the screen foot, so the footer,
 * the last thing in AppLayout's column, carries its clearance (main used to). public: one centred column, like the pages it closes.
 */
const FRAME: Record<Variant, string> = {
  shell: 'px-[var(--gutter,20px)] pb-[calc(var(--mobile-nav-h)+0.75rem)] lg:pb-3',
  public: 'mx-auto w-full max-w-3xl px-[var(--gutter,20px)] pb-[calc(var(--safe-bottom)+0.75rem)]',
}

/** Facts first, links after: one row in the shell from md (facts at the start, links at the end), otherwise stacked and centred. */
const ROW: Record<Variant, string> = {
  shell: 'flex flex-col items-center gap-y-1 text-center md:flex-row md:flex-wrap md:justify-between md:gap-x-6 md:text-left',
  public: 'flex flex-col items-center gap-y-1 text-center',
}

const LIST: Record<Variant, string> = {
  shell: 'flex flex-wrap justify-center gap-x-4 md:ml-auto md:justify-end',
  public: 'flex flex-wrap justify-center gap-x-4',
}

/**
 * TAP_FLOOR plus a width floor: 44px each way on touch. A floor adds real height, so a wrapped second row never overlaps the first,
 * where TAP_AREA's pads would. On a mouse, a plain underlined link.
 */
const LINK = `${TAP_FLOOR} min-w-[var(--tap-min)] pointer-coarse:justify-center rounded-sm font-medium underline underline-offset-2 hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]`

/** The in-app pages open in a new tab so a half-filled form is not lost (owner, 2026-10-23). */
function NewTabLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}<span className="sr-only"> (opens in a new tab)</span>
    </Link>
  )
}

/**
 * The platform footer: who runs Odip, which build this is, and where help and the rules are. Scroll-end content, never fixed or sticky.
 * It is a <footer> beside <main>, so it is the page's one contentinfo landmark. It holds no <nav>, because the caregiver tests find the
 * step rail as the page's only navigation. Every value comes through platformFacts, so a missing or malformed one hides. Accessibility
 * always shows, which keeps the footer, and the nav clearance on it, rendering.
 */
export default function PlatformFooter({ variant, support = true, info = PLATFORM_INFO }: {
  variant: Variant
  /** false on the caregiver form: carers contact the provider who sent the link, never a platform inbox. */
  support?: boolean
  /** Tests pass their own facts; the app uses the committed ones. */
  info?: PlatformInfo
}) {
  const facts = platformFacts(info)
  const parts = [facts.copyright, facts.abn && `ABN ${facts.abn}`, facts.build].filter((part): part is string => !!part)
  const email = support ? facts.supportEmail : null
  return (
    <footer className={FRAME[variant]}>
      <div className="border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-muted-foreground)]">
        <p className={variant === 'shell' ? 'mb-2 hidden max-w-[68ch] md:block' : 'mx-auto mb-2 max-w-[68ch] text-center text-[13px]'}>
          {ACKNOWLEDGEMENT_OF_COUNTRY}
        </p>
        <div className={ROW[variant]}>
          {parts.length > 0 && (
            <p className="tabular-nums">
              {parts.map((part, i) => (
                <Fragment key={part}>
                  {i > 0 && <span aria-hidden="true"> · </span>}
                  <span className="whitespace-nowrap">{part}</span>
                </Fragment>
              ))}
            </p>
          )}
          <ul role="list" className={LIST[variant]}>
            {email && (
              <li>
                <a href={`mailto:${email}`} aria-label={`Support: ${email}`} className={LINK}>
                  <span className="md:hidden">Support</span>
                  <span className="hidden md:inline">Support: {email}</span>
                </a>
              </li>
            )}
            {facts.legal && (
              <>
                <li><NewTabLink to="/legal/privacy">Privacy</NewTabLink></li>
                <li><NewTabLink to="/legal/terms">Terms</NewTabLink></li>
              </>
            )}
            <li><NewTabLink to="/accessibility">Accessibility</NewTabLink></li>
            {facts.statusUrl && (
              <li>
                <a href={facts.statusUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
                  Status<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            )}
          </ul>
        </div>
      </div>
    </footer>
  )
}
