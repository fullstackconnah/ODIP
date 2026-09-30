import { useAccommodation, useDeleteAccommodation, useUpdateAccommodation } from '@/api/hooks'
import type { AccommodationListDto } from '@/api/types'
import { Link } from 'react-router-dom'
import { Plus, Home } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { StatusBadge } from '@/components/StatusBadge'
import { ActionButtons } from '@/components/ActionButtons'
import { TAP_FLOOR } from '@/components/tapArea'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/Button'
import { ToggleGroup } from '@/components/ToggleGroup'
import { useState } from 'react'
import { usePermissions } from '@/lib/permissions'

export default function AccommodationPage() {
  const { canWrite } = usePermissions()
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const params: Record<string, string> = { isActive: showArchived ? 'false' : 'true' }
  const { data: properties = [], isLoading } = useAccommodation(params)
  const deleteAccommodation = useDeleteAccommodation()
  const updateAccommodation = useUpdateAccommodation()
  const [confirmState, setConfirmState] = useState<{ type: 'archive' | 'restore'; item: AccommodationListDto } | null>(null)

  const handleRestore = (a: AccommodationListDto) => {
    setConfirmState({ type: 'restore', item: a })
  }

  const filtered = search
    ? properties.filter((a: AccommodationListDto) => a.propertyName.toLowerCase().includes(search.toLowerCase()) || a.location?.toLowerCase().includes(search.toLowerCase()))
    : properties

  const handleDelete = (a: AccommodationListDto) => {
    setConfirmState({ type: 'archive', item: a })
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Accommodation"
        subtitle={`${filtered.length} properties`}
        action={!showArchived && canWrite && (
          <Button to="/accommodation/new" size="md">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New Accommodation</span><span className="sm:hidden">New</span>
          </Button>
        )}
      >
        <ToggleGroup
          ariaLabel="Filter properties by status"
          options={[{ key: 'active', label: 'Active' }, { key: 'archived', label: 'Archived' }]}
          value={showArchived ? 'archived' : 'active'}
          onChange={key => setShowArchived(key === 'archived')}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search properties..." />
      </PageHeader>

      {isLoading ? (
        <div className="text-center py-12 text-[var(--color-muted-foreground)]">Loading...</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Home}
          title={properties.length === 0 ? 'No properties yet' : 'No results for your search'}
          description={properties.length === 0 ? undefined : 'Try a different search term.'}
          action={properties.length === 0 && !showArchived && canWrite ? { label: 'Add your first property', to: '/accommodation/new' } : undefined}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))] items-start gap-[var(--section-gap)]">
          {filtered.map((a: any) => (
            <div key={a.id} className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)] hover:border-[var(--color-primary)]/30 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <Link to={`/accommodation/${a.id}`} className={`${TAP_FLOOR} font-semibold hover:underline`}>{a.propertyName}</Link>
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.isActive ? 'Active' : 'Inactive'} />
                  <ActionButtons
                    onDelete={() => handleDelete(a)}
                    onRestore={() => handleRestore(a)}
                    showArchived={showArchived}
                  />
                </div>
              </div>
              <Link to={`/accommodation/${a.id}`} className="block space-y-2 text-sm text-[var(--color-muted-foreground)]">
                <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">location_on</span> {a.location || '—'} {a.region ? `· ${a.region}` : ''}</p>
                <div className="flex flex-wrap gap-2">
                  {a.isWheelchairAccessible && <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)] inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">accessible</span> Accessible</span>}
                  {a.isFullyModified && <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-secondary-container)] text-[var(--color-foreground)]">Fully Modified</span>}
                  {a.isSemiModified && <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-secondary-container)] text-[var(--color-foreground)]">Semi Modified</span>}
                </div>
                <div className="flex gap-4 pt-2 border-t border-[var(--color-border)]">
                  <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">bed</span> {a.bedCount || '—'} beds</span>
                  <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">meeting_room</span> {a.bedroomCount || '—'} rooms</span>
                  <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">group</span> max {a.maxCapacity || '—'}</span>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmState !== null}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          if (!confirmState) return
          if (confirmState.type === 'restore') {
            const item = confirmState.item
            updateAccommodation.mutate({ id: item.id, data: {
              propertyName: item.propertyName,
              location: item.location ?? undefined,
              region: item.region ?? undefined,
              address: item.address ?? undefined,
              suburb: item.suburb ?? undefined,
              state: item.state ?? undefined,
              postcode: item.postcode ?? undefined,
              isFullyModified: item.isFullyModified,
              isSemiModified: item.isSemiModified,
              isWheelchairAccessible: item.isWheelchairAccessible,
              bedroomCount: item.bedroomCount ?? undefined,
              bedCount: item.bedCount ?? undefined,
              maxCapacity: item.maxCapacity ?? undefined,
              isActive: true,
            } }, { onSuccess: () => setConfirmState(null) })
          } else {
            deleteAccommodation.mutate(confirmState.item.id, { onSuccess: () => setConfirmState(null) })
          }
        }}
        title={confirmState?.type === 'restore' ? 'Restore Property' : 'Archive Property'}
        message={
          confirmState?.type === 'restore'
            ? `Restore "${confirmState.item.propertyName}"?`
            : `Archive "${confirmState?.item?.propertyName}"? This can be undone from the Archived view.`
        }
        confirmLabel={confirmState?.type === 'restore' ? 'Restore' : 'Archive'}
        variant={confirmState?.type === 'restore' ? 'default' : 'danger'}
        loading={updateAccommodation.isPending || deleteAccommodation.isPending}
      />
    </div>
  )
}
