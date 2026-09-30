import { useAuditHistory, type AuditEntry, type AuditChange } from '../api/hooks';
import { parseApiDate } from '@/lib/utils';

interface Props {
  entityType: string;
  entityId: string;
}

/**
 * Semantic action badge colors aligned with standard UX conventions.
 * These provide clear visual feedback on the type of change.
 */
const ACTION_STYLES: Record<string, string> = {
  Created: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',  // Green
  Updated: 'bg-[var(--color-secondary-container)] text-[var(--color-secondary)]',  // Blue-grey
  Deleted: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',  // Red
};

/**
 * Formats an ISO timestamp into both relative (e.g., "2m ago") and absolute (e.g., "27 Mar 2026, 13:45") forms.
 */
function formatRelative(iso: string): { relative: string; absolute: string } {
  const date = parseApiDate(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  let relative: string;
  if (diffMins < 1) relative = 'Just now';
  else if (diffMins < 60) relative = `${diffMins}m ago`;
  else if (diffHours < 24) relative = `${diffHours}h ago`;
  else if (diffDays === 1) relative = 'Yesterday';
  else relative = `${diffDays}d ago`;

  const absolute = date.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return { relative, absolute };
}

/**
 * FieldDiff: Displays a single field change with old → new values.
 * Part of the timeline entry, styled as a subsidiary detail.
 */
function FieldDiff({ field, old: oldVal, new: newVal }: AuditChange) {
  return (
    <div className="flex items-start gap-2 text-xs text-[var(--color-muted-foreground)]">
      <span className="font-medium min-w-[140px] shrink-0 text-[var(--color-muted-foreground)]">
        {field}
      </span>
      <span className="line-through text-[var(--color-muted-foreground)] opacity-70">
        {oldVal ?? '—'}
      </span>
      <span className="text-[var(--color-muted-foreground)]">→</span>
      <span className="font-medium text-[var(--color-foreground)]">
        {newVal ?? '—'}
      </span>
    </div>
  );
}

/**
 * AuditEntryRow: A single audit entry in the timeline.
 * Includes action badge, timestamp with tooltip, user info, and field changes.
 */
function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const { relative, absolute } = formatRelative(entry.changedAt);

  return (
    <div className="flex gap-3 py-2 border-b border-[var(--color-border)] last:border-0 tabular-nums">
      {/* Timeline bullet */}
      <div className="w-2 h-2 rounded-full bg-[var(--color-primary)] mt-[7px] shrink-0" />
      
      <div className="flex-1 min-w-0">
        {/* Header: action badge, user, timestamp */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              ACTION_STYLES[entry.action] ?? 'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]'
            }`}
          >
            {entry.action}
          </span>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            by {entry.changedByName ?? 'System'}
          </span>
          <span
            className="text-xs text-[var(--color-muted-foreground)] cursor-help transition-colors hover:text-[var(--color-foreground)]"
            title={absolute}
          >
            {relative}
          </span>
        </div>

        {/* Field changes (if any) */}
        {entry.changes.length > 0 && (
          <div className="flex flex-col gap-0.5 mt-1 pl-3 border-l-2 border-[var(--color-border)]">
            {entry.changes.map((c, i) => (
              <FieldDiff key={i} {...c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * AuditHistoryTab: Main component that displays the complete audit trail for an entity.
 *
 * Features:
 * - Lazy-loaded data via useAuditHistory hook
 * - Skeleton loading state (3 placeholder rows)
 * - Error handling with user-friendly message
 * - Empty state when no history exists
 * - Timeline layout with semantic action badges
 * - Chronological listing (newest first, implicit from API)
 */
export default function AuditHistoryTab({ entityType, entityId }: Props) {
  const { data, isLoading, isError } = useAuditHistory(entityType, entityId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 py-[var(--card-pad)]">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-12 bg-[var(--color-surface-container)] rounded-[var(--radius-md)] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-6 text-center text-sm text-[var(--color-destructive)]">
        Failed to load history. Please try again.
      </div>
    );
  }

  if (!data || data.entries.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">
        No history recorded yet.
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-[var(--color-muted-foreground)] mb-2 tabular-nums">
        {data.total} event{data.total !== 1 ? 's' : ''} recorded
      </p>
      <div>
        {data.entries.map((entry) => (
          <AuditEntryRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
