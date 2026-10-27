/**
 * Shared nav-badge a11y pattern (leave-2 / I-4 follow-up): the visible digit box is
 * `aria-hidden`, and the announcement lives on the enclosing `NavLink`'s `aria-label` instead
 * (via the sibling `navBadgeLabel` helper), ordered "<count>, <label>" so the link's accessible
 * name still ends with the plain label — matching every other nav leaf's name-ends-with-label
 * convention (see e.g. AppLayout.test.tsx's `/Board$/`/`/Patterns$/` assertions) instead of
 * trailing off with the badge text.
 */
/** `fold`: the badge of a wide row, which the collapsing sidebar hides at once (AppLayout's `data-fold`). */
export function NavCountBadge({ count, fold = false }: { count: number; fold?: boolean }) {
  if (count <= 0) return null
  return (
    <span
      aria-hidden="true"
      data-fold={fold ? 'trail' : undefined}
      className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] text-xs font-medium"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
