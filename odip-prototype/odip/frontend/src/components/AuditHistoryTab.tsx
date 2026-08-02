import { useAuditHistory, type AuditEntry, type AuditChange } from '../api/hooks';

interface Props {
  entityType: string;
  entityId: string;
}

/**
 * Semantic action badge colors aligned with standard UX conventions.
 * These provide clear visual feedback on the type of change.
 */
const ACTION_STYLES: Record<string, string> = {
  Created: 'bg-[#d4edda] text-[#155724]',  // Green
  Updated: 'bg-[#cce5ff] text-[#004085]',  // Blue
  Deleted: 'bg-[#f8d7da] text-[#721c24]',  // Red
};

/**
 * Formats an ISO timestamp into both relative (e.g., "2m ago") and absolute (e.g., "27 Mar 2026, 13:45") forms.
 */
function formatRelative(iso: string): { relative: string; absolute: string } {
  const date = new Date(iso);
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
    <div className="flex items-start gap-2 text-xs text-[#43493a]">
      <span className="font-medium min-w-[140px] shrink-0 text-[#6b7280]">
        {field}
      </span>
      <span className="line-through text-[#9ca3af]">
        {oldVal ?? '—'}
      </span>
      <span className="text-[#6b7280]">→</span>
      <span className="font-medium">
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
    <div className="flex gap-3 py-4 border-b border-[#e8e8e3] last:border-0">
      {/* Timeline bullet */}
      <div className="w-2 h-2 rounded-full bg-[#396200] mt-[7px] shrink-0" />
      
      <div className="flex-1 min-w-0">
        {/* Header: action badge, user, timestamp */}
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              ACTION_STYLES[entry.action] ?? 'bg-[#efeeea] text-[#43493a]'
            }`}
          >
            {entry.action}
          </span>
          <span className="text-xs text-[#6b7280]">
            by {entry.changedByName ?? 'System'}
          </span>
          <span
            className="text-xs text-[#9ca3af] cursor-help transition-colors hover:text-[#6b7280]"
            title={absolute}
          >
            {relative}
          </span>
        </div>

        {/* Field changes (if any) */}
        {entry.changes.length > 0 && (
          <div className="flex flex-col gap-1 mt-2 pl-3 border-l-2 border-[#e8e8e3]">
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
      <div className="flex flex-col gap-3 py-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-16 bg-[#efeeea] rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-8 text-center text-sm text-[#b91c1c]">
        Failed to load history. Please try again.
      </div>
    );
  }

  if (!data || data.entries.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-[#6b7280]">
        No history recorded yet.
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-[#6b7280] mb-4">
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
