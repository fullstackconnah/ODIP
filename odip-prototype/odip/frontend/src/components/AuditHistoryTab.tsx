import { useAuditHistory, type AuditEntry, type AuditChange } from '../api/hooks';
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateTimeAu, formatRelative, plural } from '@/lib/format'

interface Props {
  entityType: string;
  entityId: string;
  /** Plain names for the stored field names; a field not listed shows as stored. */
  fieldLabels?: Record<string, string>;
  /** Plain words for a stored value, by field then stored value (the field name as stored); a value not listed shows as stored. */
  valueLabels?: Record<string, Record<string, string>>;
  /** A field whose value reads as a list: how to split its stored value into one item per line (by the field name as stored). */
  valueFormat?: Record<string, (value: string) => string[]>;
}

/** An own entry only, so a stored value such as "constructor" never reads a property off the map. */
const own = <T,>(map: Record<string, T> | undefined, key: string) => (map && Object.hasOwn(map, key) ? map[key] : undefined)

/** An audit action's tone: a create is good news, a delete is the one to notice, an update is neutral information. */
const ACTION_TONES = { created: 'success', updated: 'info', deleted: 'danger' } as const

type FieldDiffProps = AuditChange & {
  /** This field's stored values in words (from valueLabels). */
  words?: Record<string, string>;
  /** This field's value as one item per line (from valueFormat). */
  lines?: (value: string) => string[];
}

/** A stored True or False reads Yes or No for every field; nothing else is split or re-cased ("McDonald" stays as it is). */
function DiffValue({ value, words, lines }: { value: string | null | undefined; words?: Record<string, string>; lines?: (value: string) => string[] }) {
  if (value == null) return '—'
  if (lines) return <ul className="m-0 list-none p-0">{lines(value).map((line, i) => <li key={i}>{line}</li>)}</ul>
  return own(words, value) ?? (value === 'True' ? 'Yes' : value === 'False' ? 'No' : value)
}

/**
 * FieldDiff: Displays a single field change with old → new values.
 * Part of the timeline entry, styled as a subsidiary detail. Its own width decides the layout: under 35rem the label sits
 * on a line of its own and the values wrap under it at full width; from 35rem up it is one row with a 140px label column.
 */
export function FieldDiff({ field, old: oldVal, new: newVal, words, lines }: FieldDiffProps) {
  return (
    <div className="@container">
      <div className="flex flex-col gap-0.5 py-1 text-xs text-[var(--color-muted-foreground)] @[35rem]:flex-row @[35rem]:items-start @[35rem]:gap-2 @[35rem]:py-0">
        <span className="font-medium break-words text-[var(--color-muted-foreground)] @[35rem]:w-[140px] @[35rem]:shrink-0">
          {field}
        </span>
        <div className="flex flex-wrap items-start gap-x-2 gap-y-0.5 @[35rem]:flex-nowrap">
          <div className="line-through text-[var(--color-muted-foreground)] opacity-70">
            <DiffValue value={oldVal} words={words} lines={lines} />
          </div>
          <span className="text-[var(--color-muted-foreground)]">→</span>
          <div className="font-medium text-[var(--color-foreground)]">
            <DiffValue value={newVal} words={words} lines={lines} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * AuditEntryRow: A single audit entry in the timeline.
 * Includes action badge, timestamp with tooltip, user info, and field changes.
 */
function AuditEntryRow({ entry, fieldLabels, valueLabels, valueFormat }: { entry: AuditEntry } & Pick<Props, 'fieldLabels' | 'valueLabels' | 'valueFormat'>) {

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
              <FieldDiff key={i} {...c} field={fieldLabels?.[c.field] ?? c.field} words={own(valueLabels, c.field)} lines={own(valueFormat, c.field)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Three placeholder rows while a history loads. */
export function AuditHistorySkeleton() {
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
export default function AuditHistoryTab({ entityType, entityId, fieldLabels, valueLabels, valueFormat }: Props) {
  const { data, isLoading, isError, refetch } = useAuditHistory(entityType, entityId);

  if (isLoading) return <AuditHistorySkeleton />;

  if (isError) return <PageState kind="error" noun="history" onRetry={() => refetch()} />;

  if (!data?.entries?.length) {
    return (
      <div className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">
        No history recorded yet.
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-[var(--color-muted-foreground)] mb-2 tabular-nums">
        {data.entries.length < data.total ? `Showing the latest ${data.entries.length} of ${plural(data.total, 'event')}` : `${plural(data.total, 'event')} recorded`}
      </p>
      <div>
        {data.entries.map((entry) => (
          <AuditEntryRow key={entry.id} entry={entry} fieldLabels={fieldLabels} valueLabels={valueLabels} valueFormat={valueFormat} />
        ))}
      </div>
    </div>
  );
}
