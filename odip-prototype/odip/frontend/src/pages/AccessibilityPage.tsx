import PublicPage from '@/components/layout/PublicPage'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PLATFORM_INFO, type PlatformInfo } from '@/lib/platformInfo'
import { platformFacts } from '@/lib/platformFacts'

/** Each section opens on a Ruled Line, like a ledger (SHAPE 10.3). */
const H2 = 'mt-8 border-t border-[var(--color-border)] pt-4 text-base font-bold'
const LIST = 'mt-3 list-disc space-y-1 pl-6'
const LINK = 'rounded-sm text-[var(--color-primary)] underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]'

/**
 * The accessibility statement: W3C's minimum contents (a commitment, the standard, a contact, known limits) in plain words.
 * Every "What we do" line is evidenced in DESIGN.md or the code (SHAPE 10.5 lists where); change a line when its evidence changes.
 */
export default function AccessibilityPage({ info = PLATFORM_INFO }: { info?: PlatformInfo }) {
  useDocumentTitle('Accessibility')
  const { supportEmail } = platformFacts(info)
  return (
    <PublicPage>
      <h1 className="text-xl font-bold">Accessibility</h1>
      <p className="mt-4">Odip should work for everyone who uses it, including people who use a screen reader, a keyboard, voice control, magnification or a touch screen.</p>

      <h2 className={H2}>Our target</h2>
      <p className="mt-3">We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA. That's our target, not a claim: Odip hasn't been independently audited yet, so we can't say it meets every requirement.</p>

      <h2 className={H2}>What we do</h2>
      <ul className={LIST}>
        <li>The colours we use for status labels and alerts are checked automatically against the WCAG AA contrast ratio.</li>
        <li>On a touch screen, buttons and links are at least 44 pixels tall, or have a 44 pixel touch area.</li>
        <li>Buttons, links and fields show a clear outline when they have keyboard focus.</li>
        <li>Dialogs and the main menu close with Escape, and the keyboard returns to where you were.</li>
        <li>Text is never smaller than 12 pixels.</li>
        <li>From tablet width up, tables keep every column. A wide table scrolls inside its own box.</li>
        <li>On our public page, you can pause the moving background, and it stays still if your device asks for reduced motion.</li>
      </ul>

      <h2 className={H2}>What we know isn't right yet</h2>
      <ul className={LIST}>
        <li>The page that resets your password is run by Google (Firebase), not by us, so we can't change how it works.</li>
        <li>We haven't yet tested the PDF documents Odip creates, such as invoices and service agreements, with screen readers. They may be hard to read with one.</li>
      </ul>

      <h2 className={H2}>Tell us about a problem</h2>
      <p className="mt-3">If part of Odip is hard or impossible for you to use, please tell us. Say which page you were on, what you were trying to do and what happened. If you can, include the build number from the bottom of the page.</p>
      {supportEmail ? (
        <p className="mt-3">Email us at <a href={`mailto:${supportEmail}`} className={LINK}>{supportEmail}</a>.</p>
      ) : (
        <p className="mt-3">Tell the person who manages Odip at your organisation, usually your administrator, and they'll pass it on to us.</p>
      )}
      <p className="mt-3">If a provider sent you a link to a form, you can also tell the person who sent it.</p>
      <p className="mt-3">We'll let you know what we're going to do about it.</p>

      <h2 className={H2}>If you're not happy with our response</h2>
      <p className="mt-3">
        You can contact the Australian Human Rights Commission:{' '}
        <a href="https://humanrights.gov.au/complaints" className={LINK}>humanrights.gov.au/complaints</a>.
      </p>

      <p className="mt-8 text-[13px] text-[var(--color-muted-foreground)]">Last reviewed 14 October 2026.</p>
    </PublicPage>
  )
}
