/**
 * Shared nav-badge a11y pattern (leave-2 / I-4 follow-up): the visible digit box is
 * `aria-hidden`, and the announcement lives on the enclosing `NavLink`'s `aria-label` instead
 * (via the sibling `navBadgeLabel` helper), ordered "<count>, <label>" so the link's accessible
 * name still ends with the plain label — matching every other nav leaf's name-ends-with-label
 * convention (see e.g. AppLayout.test.tsx's `/Board$/`/`/Patterns$/` assertions) instead of
 * trailing off with the badge text.
 */
export function NavCountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-[var(--color-destructive)] text-white text-xs font-medium"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
