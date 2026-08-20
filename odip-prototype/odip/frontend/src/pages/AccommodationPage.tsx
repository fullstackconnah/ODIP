import { useAccommodation, useDeleteAccommodation, useUpdateAccommodation } from '@/api/hooks'
import type { AccommodationListDto } from '@/api/types'
import { Link } from 'react-router-dom'
import { Plus, Trash2, ArchiveRestore } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
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

  const handleRestore = (e: React.MouseEvent, a: AccommodationListDto) => {
    e.preventDefault()
    e.stopPropagation()
    setConfirmState({ type: 'restore', item: a })
  }

  const filtered = search
    ? properties.filter((a: AccommodationListDto) => a.propertyName.toLowerCase().includes(search.toLowerCase()) || a.location?.toLowerCase().includes(search.toLowerCase()))
    : properties

  const handleDelete = (e: React.MouseEvent, a: AccommodationListDto) => {
    e.preventDefault()
    e.stopPropagation()
    setConfirmState({ type: 'archive', item: a })
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Accommodation"
        subtitle={`${filtered.length} properties`}
        action={!showArchived && canWrite && (
          <Link to="/accommodation/new" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20 flex-shrink-0">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New Accommodation</span><span className="sm:hidden">New</span>
          </Link>
        )}
      >
        <div className="flex gap-2">
          <button onClick={() => setShowArchived(false)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${!showArchived ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]'}`}>
            Active
          </button>
          <button onClick={() => setShowArchived(true)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${showArchived ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]'}`}>
            Archived
          </button>
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search properties..." />
      </PageHeader>

      {isLoading ? (
        <div className="text-center py-12 text-[var(--color-muted-foreground)]">Loading...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((a: any) => (
            <Link key={a.id} to={`/accommodation/${a.id}`} className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 hover:border-[var(--color-primary)]/30 transition-colors block">
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold">{a.propertyName}</h3>
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.isActive ? 'Active' : 'Inactive'} />
                  {showArchived ? (
                    <button onClick={(e) => handleRestore(e, a)}
                      className="p-1.5 rounded hover:bg-green-500/20 text-[var(--color-muted-foreground)] hover:text-green-400 transition-colors" title="Restore">
                      <ArchiveRestore className="w-4 h-4" />
                    </button>
                  ) : (
                    <button onClick={(e) => handleDelete(e, a)}
                      className="p-1.5 rounded hover:bg-red-500/20 text-[var(--color-muted-foreground)] hover:text-red-400 transition-colors" title="Archive">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-2 text-sm text-[var(--color-muted-foreground)]">
                <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">location_on</span> {a.location || '—'} {a.region ? `· ${a.region}` : ''}</p>
                <div className="flex flex-wrap gap-2">
                  {a.isWheelchairAccessible && <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">accessible</span> Accessible</span>}
                  {a.isFullyModified && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">Fully Modified</span>}
                  {a.isSemiModified && <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">Semi Modified</span>}
                </div>
                <div className="flex gap-4 pt-2 border-t border-[var(--color-border)]">
                  <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">bed</span> {a.bedCount || '—'} beds</span>
                  <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">meeting_room</span> {a.bedroomCount || '—'} rooms</span>
                  <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">group</span> max {a.maxCapacity || '—'}</span>
                </div>
              </div>
            </Link>
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
