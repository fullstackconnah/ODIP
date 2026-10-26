import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Location } from 'react-router-dom'
import { Check, Lock } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { plural } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { TONE } from '@/lib/tone'
import { shownSection, visibleSections } from './settingsSections'

/** What the page hands every section: its rail label as the heading, its sentence, whether this person may only read it, and whether a switch (not a first load) brought them here. */
export type SectionFrame = { title: string; description: string; readOnly: boolean; focusOnMount: boolean }

/** What became of the last Save this visit: it landed, it failed with this line (notSavedText), or nothing yet. */
export type SaveResult = 'saved' | { error: string } | null

/** A whole-form section's one Save. Pass it only once the form has its data, so Save never sits over a spinner. */
export type SectionSave = {
  dirty: boolean
  pending: boolean
  result: SaveResult
  /** Fields showing an error: Save waits, and the foot says how many to fix. */
  problems?: number
  onSave: () => void
}

type SettingsSectionProps = SectionFrame & {
  /** Records and tools take the whole column; forms stop at 60rem. */
  wide?: boolean
  save?: SectionSave
  children: ReactNode
}

// A locked section's text fields read as values in boxes: no Field Grey fill; the Ruled Line border and full ink stay.
const LOCKED = '[&_input:read-only]:bg-transparent [&_textarea:read-only]:bg-transparent'

/**
 * The frame of every Settings section: the h2 (the screen's title below md), one sentence, the locked note for a read-only role, the
 * body, and for a whole-form section the sticky save foot. A read-only section gets no foot at all.
 */
export function SettingsSection({ title, description, readOnly, focusOnMount, wide = false, save, children }: SettingsSectionProps) {
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  // A switch (rail, list row, Back) lands on the new heading; a first load, a reload or a deep link leaves focus where it is.
  useEffect(() => {
    if (focusOnMount) heading.current?.focus()
  }, [focusOnMount])

  return (
    <section aria-labelledby={headingId} className={`flex min-w-0 flex-col ${wide ? '' : 'max-w-[60rem]'} ${readOnly ? LOCKED : ''}`}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className="scroll-mt-16 text-xl font-bold focus:outline-none md:text-base md:font-semibold">
        {title}
      </h2>
      <p className="mt-1 max-w-prose text-[13px] text-[var(--color-muted-foreground)]">{description}</p>
      {readOnly && (
        <Callout tone="info" icon={Lock} announce={false} className="mt-[var(--section-gap)] max-w-prose">
          Only an Admin can change these. Ask an Admin if something here needs updating.
        </Callout>
      )}
      <div className="mt-[var(--section-gap)] flex min-w-0 flex-col gap-[var(--section-gap)]">{children}</div>
      {save && !readOnly && <SaveFoot title={title} {...save} />}
    </section>
  )
}

/** A titled block inside a section: an h3 over its fields. Every block after the first is ruled off above. */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-[var(--field-gap-y)] border-[var(--color-border)] [&:not(:first-child)]:border-t [&:not(:first-child)]:pt-[var(--section-gap)]">
      <h3 id={id} className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

/**
 * The sticky foot: the status on the left, the one Save on the right. It also holds the unsaved-changes guard, so only a section with
 * a Save registers a blocker (react-router allows one; one section is mounted at a time). The guard resolves both locations the way
 * the page does, breakpoint included, so a move to another section asks and a move within this one doesn't.
 */
function SaveFoot({ title, dirty, pending, result, problems = 0, onSave }: SectionSave & { title: string }) {
  // The foot only needs which section a location names; Microsoft sign-in has no Save, so whether the server offers it can't change when a move is blocked.
  const perms = { ...usePermissions(), microsoftSignIn: true, viewingAs: false }
  const belowMd = useIsBelowMd()
  const sections = visibleSections(perms)
  const at = (l: Location) => shownSection(new URLSearchParams(l.search), sections, belowMd)?.key ?? null
  const { dialog } = useUnsavedChangesWarning(dirty, {
    blockIf: (current, next) => at(current) !== at(next),
    stayCopy: {
      title: `Leave ${title} without saving?`,
      message: "Your changes in this section haven't been saved. If you leave it now, they'll be lost.",
      confirmLabel: 'Discard changes',
    },
  })
  const error = result !== null && result !== 'saved' ? result.error : null
  const saved = result === 'saved' && !dirty
  const status = error ? null : saved ? 'Saved' : !dirty ? null : problems > 0 ? `Fix ${plural(problems, 'field')} to save.` : 'Unsaved changes'

  return (
    <div className="sticky bottom-[var(--mobile-nav-h)] z-10 mt-[var(--section-gap)] flex items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-background)]/80 py-3 backdrop-blur-xl lg:bottom-0">
      {/* Portalled: the foot's backdrop blur would make it the containing block of the prompt's fixed scrim. */}
      {dialog && createPortal(dialog, document.body)}
      <div className="min-w-0 flex-1 text-[13px]">
        <p role="status" className={saved ? `inline-flex items-center gap-1 ${TONE.success.ink}` : 'text-[var(--color-muted-foreground)]'}>
          {saved && <Check className="h-4 w-4" aria-hidden="true" />}
          {status}
        </p>
        {error && <p role="alert" className={TONE.danger.ink}>{error}</p>}
      </div>
      <Button size="lg" onClick={onSave} disabled={!dirty || problems > 0 || pending} aria-busy={pending || undefined}>
        {pending ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  )
}
