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
      /** The destination, a real route. It is a real link, so open-in-new-tab and copy-link work. */
      to: string
      /**
       * Default `true`: when the user got here from another in-app screen, Back returns to that screen (`useBackTarget`) and
       * `to` is only the fallback for a deep link or a reload. `false` pins Back to `to`.
       */
      history?: boolean
      onBack?: undefined
    })
  | (CommonProps & {
      to?: undefined
      history?: undefined
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
}

/** A routed Back: always an anchor with a real href. */
function LinkControl({ variant, name, className, testId, href }: ControlProps & { href: string }) {
  if (variant === 'link') {
    return (
      <Link to={href} aria-label={name} className={clsx(LINK, className)} data-testid={testId}>
        <Arrow /> Back
      </Link>
    )
  }
  if (variant === 'icon') {
    return (
      <Button to={href} variant="ghost" size="md" iconOnly aria-label={name} title={name} className={clsx(ICON_FLOOR, className)} data-testid={testId}>
        <Arrow />
      </Button>
    )
  }
  return (
    <Button to={href} variant="secondary" size="md" aria-label={name} className={className} data-testid={testId}>
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
function RoutedBack({ to, label, variant = 'button', history = true, className, 'data-testid': testId }: CommonProps & { to: string; history?: boolean }) {
  // The hook is called unconditionally and INSIDE this component, so a page can render a BackButton after an early return without
  // putting a hook below it (the class of bug #155 fixed on the onboarding page). `history={false}` ignores the answer; it does
  // not skip the call.
  const target = useBackTarget(to)
  const rerouted = history && target.to !== to
  // The name always says where the control goes: the caller's label for the fallback, the previous screen's own label when history won.
  const name = rerouted ? target.ariaLabel : `Back to ${label}`
  return <LinkControl variant={variant} name={name} className={className} testId={testId} href={history ? target.to : to} />
}

/**
 * The one Back control: first action in a detail header, secondary, and it names its destination.
 *
 *   <BackButton to="/staff" label="staff" />                                  // secondary button, "Back", named "Back to staff"
 *   <BackButton to="/participants" label="participants" variant="icon" />     // ghost icon, for a header with a title beside it
 *   <BackButton to="/portal" label="my shifts" variant="link" history={false} />
 *
 * Always a link to a real route (`onBack` is the one escape hatch, for an in-page view that has no route). Under a coarse pointer every
 * variant is 44px tall.
 */
export function BackButton(props: BackButtonProps) {
  if (props.to === undefined) {
    const { label, variant = 'button', className, 'data-testid': testId, onBack } = props
    return <ButtonControl variant={variant} name={`Back to ${label}`} className={className} testId={testId} onBack={onBack} />
  }
  return <RoutedBack {...props} />
}
