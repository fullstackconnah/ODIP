import { useLocation } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'

/**
 * The catch-all route's page (L5-11): any URL no route claims (a typo, an old bookmark, a retired `/trips/:id/edit`) lands here, inside the
 * authenticated shell, instead of on React Router's bare default error page with no sidebar and no way home. A record that does not exist
 * under a route that does (`/trips/<bad id>`) is a different case, and its page says so with `PageState kind="not-found"`.
 */
export default function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader title="Page not found" />
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          There is nothing at <code className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 text-[13px] text-[var(--color-foreground)]">{pathname}</code>. The
          address may be mistyped, or the page may have moved.
        </p>
        <Button variant="primary" size="md" to="/">Go to the dashboard</Button>
      </div>
    </div>
  )
}
