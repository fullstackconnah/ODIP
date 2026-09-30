import type { ReactNode } from 'react'
import { AlertTriangle, AlertCircle, Info, CheckCircle2, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { toneOf } from '@/lib/tone'

/**
 * Severity for `Callout`. `error` and `warning` are announced assertively to assistive
 * tech (`role="alert"`); `info` and `success` are polite (`role="status"`), per the WAI-ARIA
 * guidance for "informational" vs "interrupting" content. `error` is the older word for the `danger` tone (lib/tone.ts); both work.
 */
export type CalloutTone = 'error' | 'danger' | 'warning' | 'info' | 'success'

type ToneStyle = {
  icon: LucideIcon
  container: string
  iconClass: string
  /** ARIA role for this tone. */
  role: 'alert' | 'status'
  /** Default `aria-live` value paired with the role; explicit for documentation. */
  ariaLive: 'assertive' | 'polite'
}

// Keyed by the canonical tone: the `error` alias is resolved to `danger` before the lookup.
const TONE_STYLES: Record<'danger' | 'warning' | 'info' | 'success', ToneStyle> = {
  // Danger (`error`): destructive container tint, destructive ink — the canonical "something went
  // wrong" banner that was previously copy-pasted across ~20 pages.
  danger: {
    icon: AlertTriangle,
    container: 'bg-[var(--color-destructive)]/10 border-[var(--color-destructive)]/30 text-[var(--color-destructive)]',
    iconClass: 'text-[var(--color-destructive)]',
    role: 'alert',
    ariaLive: 'assertive',
  },
  // Warning: warning container with on-warning-container ink — matches the existing
  // draft/resume banner in ParticipantDetailPage.
  warning: {
    icon: AlertCircle,
    container: 'bg-[var(--color-warning-container)] border-[var(--color-on-warning-container)]/20 text-[var(--color-on-warning-container)]',
    iconClass: 'text-[var(--color-on-warning-container)]',
    role: 'alert',
    ariaLive: 'assertive',
  },
  // Info: muted container, info-coloured icon — the "FYI" callout.
  info: {
    icon: Info,
    container: 'bg-[var(--color-muted)] border-[var(--color-border)] text-[var(--color-foreground)]',
    iconClass: 'text-[var(--color-info)]',
    role: 'status',
    ariaLive: 'polite',
  },
  // Success: surface-container with primary accent on the icon — "operation succeeded".
  success: {
    icon: CheckCircle2,
    container: 'bg-[var(--color-surface-container)] border-[var(--color-primary)]/30 text-[var(--color-foreground)]',
    iconClass: 'text-[var(--color-primary)]',
    role: 'status',
    ariaLive: 'polite',
  },
}

export type CalloutProps = {
  /** Visual + a11y severity. See {@link CalloutTone}. */
  tone: CalloutTone
  /** Optional heading; rendered bold above `children`. */
  title?: ReactNode
  /** Body content (string or JSX). */
  children?: ReactNode
  /**
   * Override the default tone icon. Pass `null` to suppress the icon entirely (for dense
   * layouts or when the title itself carries the meaning).
   */
  icon?: LucideIcon | null
  /** Optional action area rendered to the right of the body on wide viewports. */
  actions?: ReactNode
  className?: string
}

/**
 * Page-level callout/banner with severity-driven tone. Replaces the recurring copy-pasted
 * `<div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 …">` pattern
 * that used to live on every mutation-error surface.
 *
 * Accessibility:
 * - `role` and `aria-live` are derived from `tone`. Error and warning interrupt (assertive);
 *   info and success are polite (`status`).
 * - The icon is decorative (`aria-hidden`); the visible text is the source of meaning.
 */
export function Callout({ tone, title, children, icon, actions, className }: CalloutProps) {
  const style = TONE_STYLES[toneOf(tone) as keyof typeof TONE_STYLES]
  const Icon = icon === null ? null : (icon ?? style.icon)
  return (
    <div
      role={style.role}
      aria-live={style.ariaLive}
      className={clsx(
        'flex flex-wrap items-start gap-3 p-3 rounded-lg border text-sm',
        style.container,
        className,
      )}
    >
      {Icon && (
        <Icon className={clsx('w-4 h-4 mt-0.5 shrink-0', style.iconClass)} aria-hidden="true" />
      )}
      <div className="flex-1 min-w-0 space-y-1">
        {title && <p className="font-medium leading-snug">{title}</p>}
        {children && <div className="leading-snug">{children}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
