import { useAuditHistory, type AuditEntry, type AuditChange } from '../api/hooks';
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateTimeAu, formatRelative, plural } from '@/lib/format'

interface Props {
  entityType: string;
  entityId: string;
}

/** An audit action's tone: a create is good news, a delete is the one to notice, an update is neutral information. */
const ACTION_TONES = { created: 'success', updated: 'info', deleted: 'danger' } as const

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

  return (
    <div className="flex gap-3 py-2 border-b border-[var(--color-border)] last:border-0 tabular-nums">
      {/* Timeline bullet */}
      <div className="w-2 h-2 rounded-full bg-[var(--color-primary)] mt-[7px] shrink-0" />
      
      <div className="flex-1 min-w-0">
        {/* Header: action badge, user, timestamp */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <StatusBadge status={entry.action} colorMap={ACTION_TONES} />
          <span className="text-xs text-[var(--color-muted-foreground)]">
            by {entry.changedByName ?? 'System'}
          </span>
          <span
            className="text-xs text-[var(--color-muted-foreground)] cursor-help transition-colors hover:text-[var(--color-foreground)]"
            title={formatDateTimeAu(entry.changedAt)}
          >
            {formatRelative(entry.changedAt, { style: 'compact' })}
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
        {plural(data.total, 'event')} recorded
      </p>
      <div>
        {data.entries.map((entry) => (
          <AuditEntryRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
