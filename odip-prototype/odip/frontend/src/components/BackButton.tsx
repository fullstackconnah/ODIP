import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import clsx from 'clsx'
import { Button } from './Button'
import { useBackTarget } from '@/hooks/useBackNavigation'

export type BackButtonVariant = 'button' | 'icon' | 'link'

type CommonProps = {
  /**
   * Where the control goes, as a lower-case noun: `label="staff"` names it "Back to staff". The name is the control's
   * `aria-label` (the visible text stays "Back"), so a screen reader hears the destination.
   */
  label: string
  /**
   * `button` (default): a secondary `Button` with an arrow and "Back", for a page header's action cluster.
   * `icon`: a ghost icon-only `Button` with the `--tap-min` floor, for a form or wizard header where the title sits beside it.
   * `link`: a primary-coloured text link with an arrow, for a page with no action cluster (the portal, a sub-view).
   */
  variant?: BackButtonVariant
  /** Spacing only (`mt-1`, `py-3`): the look comes from the variant. */
  className?: string
  'data-testid'?: string
}

export type BackButtonProps =
  | (CommonProps & {
      /**
       * The fallback, a real route: where Back goes when there is no earlier in-app page (a deep link, a new tab). Otherwise Back
       * returns to the page the user came from (`useBackTarget`). It is the link's href, so open-in-new-tab and copy-link work.
       */
      to: string
      onBack?: undefined
    })
  | (CommonProps & {
      to?: undefined
      /**
       * For a view that is switched in place and has no route to link to (a master/detail pane held in component state). It renders a real
       * `<button>`, because nothing navigates; every routed Back is a link.
       */
      onBack: () => void
    })

// The `link` variant. `min-h-[var(--tap-min)]` is 0px on a mouse (no change) and 44px under a coarse pointer; it needs the
// `inline-flex items-center` the variant already has. The ring is keyboard-only (focus-visible), like every link in the app.
const LINK =
  'inline-flex items-center gap-1 min-h-[var(--tap-min)] rounded-[var(--radius-sm)] text-sm text-[var(--color-primary)] hover:underline ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]'

// The `icon` variant is the ghost icon-only Button (a --control-h-sm square, 24px on a mouse) lifted to a 44px square on touch.
const ICON_FLOOR = 'min-h-[var(--tap-min)] min-w-[var(--tap-min)] shrink-0'

const Arrow = () => <ArrowLeft className="w-4 h-4" />

type ControlProps = {
  variant: BackButtonVariant
  name: string
  className?: string
  testId?: string
  onClick?: (e: MouseEvent) => void
}

/** A routed Back: always an anchor with a real href. */
function LinkControl({ variant, name, className, testId, href, onClick }: ControlProps & { href: string }) {
  if (variant === 'link') {
    return (
      <Link to={href} onClick={onClick} aria-label={name} className={clsx(LINK, className)} data-testid={testId}>
        <Arrow /> Back
      </Link>
    )
  }
  if (variant === 'icon') {
    return (
      <Button to={href} onClick={onClick} variant="ghost" size="md" iconOnly aria-label={name} title={name} className={clsx(ICON_FLOOR, className)} data-testid={testId}>
        <Arrow />
      </Button>
    )
  }
  return (
    <Button to={href} onClick={onClick} variant="secondary" size="md" aria-label={name} className={className} data-testid={testId}>
      <Arrow /> Back
    </Button>
  )
}

/** An in-page Back: a real button, because there is no route to link to. */
function ButtonControl({ variant, name, className, testId, onBack }: ControlProps & { onBack: () => void }) {
  if (variant === 'link') {
    return (
      <button type="button" onClick={onBack} aria-label={name} className={clsx(LINK, className)} data-testid={testId}>
        <Arrow /> Back
      </button>
    )
  }
  if (variant === 'icon') {
    return (
      <Button variant="ghost" size="md" iconOnly onClick={onBack} aria-label={name} title={name} className={clsx(ICON_FLOOR, className)} data-testid={testId}>
        <Arrow />
      </Button>
    )
  }
  return (
    <Button variant="secondary" size="md" onClick={onBack} aria-label={name} className={className} data-testid={testId}>
      <Arrow /> Back
    </Button>
  )
}

/** The routed form, split out so `useBackTarget` is only called where there is a `to` (the in-page form needs no router state). */
function RoutedBack({ to, label, variant = 'button', className, 'data-testid': testId }: CommonProps & { to: string }) {
  // The hook is called unconditionally and INSIDE this component, so a page can render a BackButton after an early return without
  // putting a hook below it (the class of bug #155 fixed on the onboarding page).
  const target = useBackTarget(to)
  // The name says where a click goes: the previous screen when it is known, "Go back" when history exists but the page is unknown
  // (a click still runs navigate(-1)), else the caller's label (a deep link goes to the fallback).
  const name = target.previousPath && target.previousPath !== to ? target.ariaLabel : target.goesBack && target.previousPath !== to ? 'Go back' : `Back to ${label}`
  return <LinkControl variant={variant} name={name} className={className} testId={testId} href={to} onClick={target.onLinkClick} />
}

/**
 * A form's Cancel (or an end-of-form "Back to ..." button): goes where the page's header Back goes, `to` being the same fallback.
 * A component, not a hook call in the page, so it can sit below an early return.
 */
export function BackActionButton({ to, children = 'Cancel', className }: { to: string; children?: ReactNode; className?: string }) {
  const target = useBackTarget(to)
  return <Button variant="secondary" to={to} onClick={target.onLinkClick} className={className}>{children}</Button>
}

/**
 * The one Back control: first action in a detail header, secondary, and it names its destination.
 *
 *   <BackButton to="/staff" label="staff" />                                  // secondary button, "Back", named "Back to staff"
 *   <BackButton to="/participants" label="participants" variant="icon" />     // ghost icon, for a header with a title beside it
 *   <BackButton to="/portal" label="my shifts" variant="link" />
 *
 * Back returns to the page the user came from, and `to` is the fallback for a deep link or a new tab. Always a link to a real route (`onBack` is the one escape hatch, for an in-page view that has no route). Under a coarse pointer every
 * variant is 44px tall.
 */
export function BackButton(props: BackButtonProps) {
  if (props.to === undefined) {
    const { label, variant = 'button', className, 'data-testid': testId, onBack } = props
    return <ButtonControl variant={variant} name={`Back to ${label}`} className={className} testId={testId} onBack={onBack} />
  }
  return <RoutedBack {...props} />
}
