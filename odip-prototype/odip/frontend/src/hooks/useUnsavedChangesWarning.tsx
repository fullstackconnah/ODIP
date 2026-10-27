import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useBlocker, useLocation, type BlockerFunction, type Location } from 'react-router-dom'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'

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
  /**
   * Words for a page where leaving loses nothing (the roster's drafts are saved): they replace the house leave words AND stayCopy for every
   * blocked move, label the stay button, and draw the confirm as primary, not danger.
   */
  leaveCopy?: { title: string; message: string; confirmLabel: string; stayLabel: string }
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
 * Pass `options.leaveCopy` where leaving loses nothing: its words win for every blocked move, and the confirm is primary.
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
  const copy = options.leaveCopy ?? (blocker.state === 'blocked' && blocker.location.pathname === pathname && options.stayCopy ? options.stayCopy : LEAVE_COPY)

  // Modal owns Escape (= keep editing), the Tab trap, scroll lock, focus back to the opener, the backdrop click and the phone bottom-nav inset.
  // Focus starts on the stay button, the safe answer.
  const keepEditingRef = useRef<HTMLButtonElement>(null)

  const dialog: ReactNode = (
    <Modal
      open={isOpen}
      onClose={handleCancel}
      title={copy.title}
      size="sm"
      role="alertdialog"
      initialFocusRef={keepEditingRef}
      footer={
        <>
          <Button ref={keepEditingRef} variant="secondary" onClick={handleCancel}>
            {options.leaveCopy?.stayLabel ?? 'Keep editing'}
          </Button>
          <Button variant={options.leaveCopy ? 'primary' : 'danger'} onClick={handleConfirm}>
            {copy.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-[var(--color-muted-foreground)]">{copy.message}</p>
    </Modal>
  )

  return { dialog }
}
