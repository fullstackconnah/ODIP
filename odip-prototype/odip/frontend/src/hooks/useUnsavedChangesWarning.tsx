import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useBlocker, useLocation, type BlockerFunction, type Location } from 'react-router-dom'
import { Button } from '@/components/Button'
import { useDialogBehavior } from './useDialogBehavior'

type UnsavedChangesWarningReturn = {
  dialog: ReactNode
}

type UnsavedChangesOptions = {
  /**
   * An extra reason to block a move that keeps the pathname. Settings passes "the section differs", so switching section asks too;
   * leaving the page always asks while `when` is true.
   */
  blockIf?: (current: Location, next: Location) => boolean
  /** The dialog's words for a move that keeps the pathname. Leaving the page keeps the default words below. */
  stayCopy?: { title: string; message: string; confirmLabel: string }
}

const LEAVE_COPY = {
  title: 'Leave without saving?',
  message: 'You have unsaved changes. If you leave this page now, those changes will be lost.',
  confirmLabel: 'Leave page',
}

/**
 * Warns the user before they lose unsaved form data — both when navigating
 * within the app (react-router 7's useBlocker) and when closing/refreshing
 * the tab (native beforeunload).
 *
 * Pass `options.blockIf` to also block a move that keeps the pathname (Settings: another `?section=`), and `options.stayCopy` for the words of that dialog.
 *
 * `when` should track a dirty flag, e.g. react-hook-form's `formState.isDirty`.
 *
 * Requires a data router (createBrowserRouter/RouterProvider) — useBlocker
 * throws under the plain declarative <BrowserRouter>.
 *
 * To navigate away intentionally without triggering the prompt (e.g. after a
 * successful save), clear the dirty flag *synchronously* before calling
 * navigate — wrap the reset in `flushSync` from 'react-dom' so the blocker
 * sees the cleared flag before the navigation is evaluated:
 *
 *   flushSync(() => reset(data))
 *   navigate('/somewhere')
 */
export function useUnsavedChangesWarning(when: boolean, options: UnsavedChangesOptions = {}): UnsavedChangesWarningReturn {
  // The blocker predicate below is created once (stable identity) and reads
  // this ref at call time, so it always sees the latest `when` value even
  // though react-router only re-registers the predicate on identity change.
  // Synced via useLayoutEffect (not during render) so that wrapping a dirty
  // -> false transition in flushSync (see doc comment above) flushes this
  // ref synchronously before a subsequent navigate() call is evaluated.
  const whenRef = useRef(when)
  useLayoutEffect(() => {
    whenRef.current = when
  }, [when])
  // Read at call time like `when`: callers pass a new function each render, and the blocker predicate below is created once.
  const blockIfRef = useRef(options.blockIf)
  useLayoutEffect(() => {
    blockIfRef.current = options.blockIf
  })

  // Native tab close / refresh.
  useEffect(() => {
    if (!when) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [when])

  // In-app navigation.
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      whenRef.current &&
      (currentLocation.pathname !== nextLocation.pathname || !!blockIfRef.current?.(currentLocation, nextLocation)),
    []
  )
  const blocker = useBlocker(shouldBlock)
  const { pathname } = useLocation()

  const handleCancel = useCallback(() => {
    blocker.reset?.()
  }, [blocker])

  const handleConfirm = useCallback(() => {
    blocker.proceed?.()
  }, [blocker])

  const isOpen = blocker.state === 'blocked'
  const copy = blocker.state === 'blocked' && blocker.location.pathname === pathname && options.stayCopy ? options.stayCopy : LEAVE_COPY

  // Escape (= keep editing), the Tab trap, scroll lock and focus in / back, shared with Modal and SlideOver. Focus starts on
  // "Keep editing" (the safe answer); `autoFocus` is out because the hook must see the real opener to give focus back to it.
  const dialogRef = useRef<HTMLDivElement>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  useDialogBehavior({ open: isOpen, onClose: handleCancel, containerRef: dialogRef, initialFocusRef: keepEditingRef })

  const dialog: ReactNode = isOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={handleCancel}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        aria-describedby="unsaved-changes-message"
        tabIndex={-1}
        className="w-full max-w-sm rounded-lg bg-[var(--color-card)] p-6 shadow-xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="unsaved-changes-title" className="text-base font-semibold text-[var(--color-foreground)]">
          {copy.title}
        </h2>
        <p id="unsaved-changes-message" className="mt-2 text-sm text-[var(--color-foreground)] opacity-70">
          {copy.message}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={keepEditingRef}
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-[var(--color-foreground)]/20 px-4 py-2 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-foreground)]/5"
          >
            Keep editing
          </button>
          <Button variant="danger" onClick={handleConfirm}>
            {copy.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  ) : null

  return { dialog }
}
