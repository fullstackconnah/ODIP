import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** When set, renders as a React Router Link instead of a <button>. */
  to?: string
  /** Renders an icon-style square button (for table-row actions). */
  iconOnly?: boolean
  className?: string
  children?: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

const BASE = 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary)]/90 shadow-md shadow-[var(--color-primary)]/20',
  secondary: 'border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]',
  danger: 'bg-[var(--color-destructive)] text-white hover:opacity-90',
  ghost: 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-primary)]',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-4 py-2.5 text-sm',
}

function classes(variant: ButtonVariant, size: ButtonSize, iconOnly: boolean, className?: string): string {
  const sizeClass = iconOnly ? 'p-1.5' : SIZE[size]
  return `${BASE} ${VARIANT[variant]} ${sizeClass} ${className ?? ''}`
}

export function Button({
  variant = 'primary',
  size = 'md',
  to,
  iconOnly = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const cls = classes(variant, size, iconOnly, className)
  if (to) {
    // React Router's <Link> only forwards `to`/`ref`/children. Anything else (aria-label, title,
    // tabIndex) has to be passed explicitly so the link keeps the same semantics as a <button>.
    const { 'aria-label': ariaLabel, title, tabIndex, onClick: linkOnClick } = rest as {
      'aria-label'?: string
      title?: string
      tabIndex?: number
      onClick?: React.MouseEventHandler<HTMLAnchorElement>
    }
    return (
      <Link to={to} className={cls} aria-label={ariaLabel} title={title} tabIndex={tabIndex} onClick={linkOnClick}>
        {children}
      </Link>
    )
  }
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  )
}