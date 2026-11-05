import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { Link } from 'react-router-dom'
import { buttonClasses, type ButtonVariant, type ButtonSize } from './buttonClasses'

export type { ButtonVariant, ButtonSize }

export type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** When set, renders as a React Router Link instead of a <button>. */
  to?: string
  /** When set (and `to` is not), renders a plain <a> for an external or tel:/mailto: link. `target` and `rel` pass through only if given. */
  href?: string
  target?: string
  rel?: string
  /**
   * Renders an icon-style square button (for table-row actions). Always a `--control-h-sm`
   * square (24px on fine pointers, 36px on coarse) regardless of `size`, so a row of them lines
   * up with `size="sm"` buttons and status pills and never pushes a table row past `--row-h`.
   * On coarse pointers it also carries a 44px hit area (TAP_AREA), so a cluster of them needs 8px
   * between buttons there (RowActions does this).
   */
  iconOnly?: boolean
  className?: string
  children?: ReactNode
  /** Reaches the <button> (React 19 passes `ref` as a prop); a link-style Button ignores it. */
  ref?: Ref<HTMLButtonElement>
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

export function Button({
  variant = 'primary',
  size = 'md',
  to,
  href,
  target,
  rel,
  iconOnly = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const cls = buttonClasses(variant, size, iconOnly, className)
  if (to || href) {
    // React Router's <Link> only forwards `to`/`ref`/children. Anything else (aria-label, title,
    // tabIndex) has to be passed explicitly so the link keeps the same semantics as a <button>.
    const { 'aria-label': ariaLabel, title, tabIndex, onClick: linkOnClick } = rest as {
      'aria-label'?: string
      title?: string
      tabIndex?: number
      onClick?: React.MouseEventHandler<HTMLAnchorElement>
    }
    // `data-*` (a test id) passes through too, so a Button that became a link keeps the hooks tests and tooling find it by.
    const dataAttributes = Object.fromEntries(Object.entries(rest).filter(([name]) => name.startsWith('data-')))
    const linkProps = { className: cls, 'aria-label': ariaLabel, title, tabIndex, onClick: linkOnClick, ...dataAttributes }
    return to ? (
      <Link to={to} {...linkProps}>
        {children}
      </Link>
    ) : (
      <a href={href} target={target} rel={rel} {...linkProps}>
        {children}
      </a>
    )
  }
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  )
}