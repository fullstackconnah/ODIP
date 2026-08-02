import { useAccommodation, useDeleteAccommodation, useUpdateAccommodation } from '@/api/hooks'
import { Link } from 'react-router-dom'
import { Plus, Trash2, ArchiveRestore } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { StatusBadge } from '@/components/StatusBadge'
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

  const handleRestore = (e: React.MouseEvent, a: any) => {
    e.preventDefault()
    e.stopPropagation()
    if (window.confirm(`Restore "${a.propertyName}"?`)) {
      updateAccommodation.mutate({ id: a.id, data: { ...a, isActive: true } })
    }
  }

  const filtered = search
    ? properties.filter((a: any) => a.propertyName.toLowerCase().includes(search.toLowerCase()) || a.location?.toLowerCase().includes(search.toLowerCase()))
    : properties

  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (window.confirm(`Archive "${name}"? This can be undone from the Archived view.`)) {
      deleteAccommodation.mutate(id)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Accommodation"
        subtitle={`${filtered.length} properties`}
        action={!showArchived && canWrite && (
          <Link to="/accommodation/new" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-blue-500/20 flex-shrink-0">
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
                    <button onClick={(e) => handleDelete(e, a.id, a.propertyName)}
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
    </div>
  )
}
