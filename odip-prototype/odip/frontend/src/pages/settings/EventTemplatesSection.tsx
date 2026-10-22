import { useState } from 'react'
import { LayoutTemplate, Pencil, Plus } from 'lucide-react'
import { useEventTemplates } from '@/api/hooks'
import type { EventTemplateDto } from '@/api/types'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import TemplateFormPanel from '@/components/TemplateFormPanel'
import { retryingAfterError } from '@/lib/queryPhase'

/** Content › Event templates: the template cards, with "New template" at the top right of the section, where Activity library has "New activity". */
export default function EventTemplatesSection() {
  const pageQuery = useEventTemplates()
  const { data: templates = [], isLoading, isError, refetch } = pageQuery
  const [panelOpen, setPanelOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<EventTemplateDto | undefined>(undefined)

  const activeTemplates = templates.filter((t) => t.isActive)
  // Only claim "no templates" once the fetch has settled, so the empty state doesn't flash on load.
  const empty = !isLoading && !isError && activeTemplates.length === 0
  const openNewTemplate = () => { setEditingTemplate(undefined); setPanelOpen(true) }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNewTemplate} size="md">
          <Plus className="w-4 h-4" /> New template
        </Button>
      </div>
      {(isError || retryingAfterError(pageQuery)) && templates.length === 0 ? (
        <PageState kind="error" noun="template list" onRetry={() => refetch()} />
      ) : empty ? (
        // "New template" is the section's action, so the empty state carries no second one.
        <EmptyState
          icon={LayoutTemplate}
          title="No event templates yet"
          description="Templates pre-fill the destination, region and duration when you create a trip. Add one to get started."
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {activeTemplates.map((t) => (
              <div key={t.id} className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)] group">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold">{t.eventName}</h3>
                    <span className="text-xs text-[var(--color-muted-foreground)] font-mono">{t.eventCode}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    onClick={() => { setEditingTemplate(t); setPanelOpen(true) }}
                    className="opacity-0 group-hover:opacity-100"
                    title="Edit template"
                    aria-label="Edit template"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                </div>
                <div className="text-sm text-[var(--color-muted-foreground)] space-y-1">
                  <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">location_on</span> {t.defaultDestination || '—'} · {t.defaultRegion || '—'}</p>
                  {t.standardDurationDays && <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">schedule</span> {t.standardDurationDays} days</p>}
                  {t.preferredTimeOfYear && <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">calendar_today</span> {t.preferredTimeOfYear}</p>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <TemplateFormPanel
        isOpen={panelOpen}
        onClose={() => { setPanelOpen(false); setEditingTemplate(undefined) }}
        template={editingTemplate}
      />
    </div>
  )
}
