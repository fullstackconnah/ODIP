import type { ReactNode, Ref } from 'react'
import { Button } from '@/components/Button'
import { ChevronLeft, ChevronRight, Lock, Plus, X, type LucideIcon } from 'lucide-react'

/** The small icon button of a page header and a row: a real `--tap-min` target on touch, `--control-h` on a mouse. */
export function HeaderIcon({ label, onClick, disabled, size = 'md', className = '', children }: { label: string; onClick: () => void; disabled?: boolean; size?: 'sm' | 'md'; className?: string; children: ReactNode }) {
  const side = size === 'sm' ? 'size-[max(var(--control-h-sm),var(--tap-min))]' : 'size-[max(var(--control-h),var(--tap-min))]'
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className={`inline-flex ${side} shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-hover-wash)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-ring)] disabled:opacity-50 ${className}`}>{children}</button>
  )
}

export const CloseIcon = () => <X className="h-5 w-5" aria-hidden="true" />

/**
 * One page of the sheet: the SlideOver's header pattern (back, heading, close), a body that scrolls, and a footer that stays. The heading takes focus when the page opens.
 * `ga-push` (index.css) is the entrance: a slide and fade below lg, a fade from lg, a fade under reduced motion.
 */
export function PageFrame({ title, hint, headingId, headingRef, onBack, backLabel, onClose, footer, children }: {
  title: string; hint?: string; headingId: string; headingRef: Ref<HTMLHeadingElement>
  onBack?: () => void; backLabel?: string; onClose: () => void; footer?: ReactNode; children: ReactNode
}) {
  return (
    <section aria-labelledby={headingId} className="ga-push flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-card)]">
      <header className="flex shrink-0 items-start gap-2 border-b border-[var(--color-border)] p-[var(--card-pad)]">
        {onBack && <HeaderIcon label={backLabel ?? 'Back'} onClick={onBack} className="-ml-2"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></HeaderIcon>}
        <div className="min-w-0 flex-1 self-center">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-display text-base font-semibold text-[var(--color-foreground)] focus:outline-none">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">{hint}</p>}
        </div>
        {/* Wide: the overview column beside it has the close button. */}
        <HeaderIcon label="Close" onClick={onClose} className="-mr-2 lg:hidden"><CloseIcon /></HeaderIcon>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-[var(--card-pad)]">{children}</div>
      {footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)]">{footer}</footer>}
    </section>
  )
}

/** An overview row: icon, label, its state, and a chevron (a lock where the page is read-only). The current page's row carries `aria-current` and the inset primary edge. */
export function OverviewRow({ id, icon: Icon, label, value, extra, current, locked, onOpen }: {
  id: string; icon: LucideIcon; label: string; value: string; extra?: ReactNode; current: boolean; locked?: boolean; onOpen: () => void
}) {
  return (
    <li>
      <button
        type="button" data-overview-row={id} aria-current={current ? 'page' : undefined} onClick={onOpen}
        className="flex min-h-[max(var(--row-h),var(--tap-min))] w-full items-center gap-3 px-4 py-2 text-left hover:bg-[var(--color-hover-wash)] active:bg-[var(--color-hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)] aria-[current=page]:bg-[var(--color-card)] aria-[current=page]:shadow-[inset_3px_0_0_var(--color-primary)]"
      >
        <Icon className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-[var(--color-foreground)]">{label}</span>
          <span className="block truncate text-xs text-[var(--color-muted-foreground)]">{value}</span>
          {extra}
        </span>
        {locked ? <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" aria-label="Locked" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden="true" />}
      </button>
    </li>
  )
}

/** A step of the create walk (lg and up): a disc in the activity pair when it is the current or a done step, a ring when it is still to come. */
export function StepItem({ n, label, sub, state }: { n: number; label: string; sub: string; state: 'done' | 'now' | 'next' }) {
  const disc = state === 'next'
    ? 'border border-[var(--color-muted-foreground)] text-[var(--color-muted-foreground)]'
    : 'bg-[var(--color-activity-container)] text-[var(--color-on-activity-container)]'
  return (
    <li aria-current={state === 'now' ? 'step' : undefined} className="flex min-h-[max(var(--row-h),var(--tap-min))] items-center gap-3 px-4 py-2">
      <span aria-hidden="true" className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${disc}`}>{state === 'done' ? '✓' : n}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-[var(--color-foreground)]">{label}</span>
        <span className="block truncate text-xs text-[var(--color-muted-foreground)]">{sub}</span>
      </span>
    </li>
  )
}

export function Skeleton({ lines = 2 }: { lines?: number }) {
  return <div className="flex flex-col gap-2" aria-busy="true">{Array.from({ length: lines }, (_, i) => <div key={i} className="h-[max(var(--control-h),var(--tap-min))] animate-pulse rounded-sm bg-muted" />)}</div>
}

export function AddButton({ disabled, primary, onClick, children }: { disabled?: boolean; primary?: boolean; onClick: () => void; children: string }) {
  return <Button variant={primary ? 'primary' : 'secondary'} onClick={onClick} disabled={disabled}><Plus className="h-3.5 w-3.5" aria-hidden="true" />{children}</Button>
}

/** A group of the participant picker: its label and rows. */
export function PickGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mb-2"><p className="mb-1 px-2 text-xs font-semibold text-[var(--color-muted-foreground)]">{label}</p><ul className="flex flex-col">{children}</ul></div>
}

export function PickRow({ label, sub, onPick }: { label: string; sub?: string; onPick: () => void }) {
  return (
    <li><button type="button" onClick={onPick} className="flex min-h-[max(var(--row-h),var(--tap-min))] w-full flex-col justify-center rounded-sm px-2 text-left hover:bg-[var(--color-hover-wash)] active:bg-[var(--color-hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"><span className="text-sm font-medium">{label}</span>{sub && <span className="text-xs text-[var(--color-muted-foreground)]">{sub}</span>}</button></li>
  )
}
