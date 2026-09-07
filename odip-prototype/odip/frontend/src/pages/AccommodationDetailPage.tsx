import { useParams, Link } from 'react-router-dom'
import { useAccommodationDetail } from '@/api/hooks'
import { ArrowLeft, Pencil } from 'lucide-react'

export default function AccommodationDetailPage() {
  const { id } = useParams()
  const { data: property, isLoading, isError, refetch } = useAccommodationDetail(id)

  if (isLoading) return <div className="text-center py-12 text-[var(--color-muted-foreground)]">Loading...</div>
  if (isError) return (
    <div className="text-center py-12 space-y-3">
      <p className="text-sm text-[var(--color-muted-foreground)]" role="alert">
        Failed to load this property. Check your connection and try again.
      </p>
      <button
        type="button"
        onClick={() => refetch()}
        className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-[var(--color-border)] text-sm font-medium hover:bg-[var(--color-accent)] transition-colors"
      >
        Try again
      </button>
    </div>
  )
  if (!property) return <div className="text-center py-12 text-[var(--color-muted-foreground)]">Property not found</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Link to="/accommodation" className="p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl md:text-2xl font-bold">{property.propertyName}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-0.5">{property.location || 'No location'}{property.region ? ` · ${property.region}` : ''}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className={`text-xs px-2 py-0.5 rounded-full ${property.isActive ? 'badge-confirmed' : 'badge-cancelled'}`}>
            {property.isActive ? 'Active' : 'Inactive'}
          </span>
          <Link to={`/accommodation/${id}/edit`} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20">
            <Pencil className="w-4 h-4" /> Edit
          </Link>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Details */}
        <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 space-y-4">
          <h2 className="font-semibold text-lg">Property Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[var(--color-muted-foreground)]">Provider / Owner</p>
              <p className="font-medium">{property.providerOwner || '—'}</p>
            </div>
            <div>
              <p className="text-[var(--color-muted-foreground)]">Max Capacity</p>
              <p className="font-medium">{property.maxCapacity ?? '—'}</p>
            </div>
            <div>
              <p className="text-[var(--color-muted-foreground)]">Bedrooms</p>
              <p className="font-medium">{property.bedroomCount ?? '—'}</p>
            </div>
            <div>
              <p className="text-[var(--color-muted-foreground)]">Beds</p>
              <p className="font-medium">{property.bedCount ?? '—'}</p>
            </div>
          </div>
          {property.beddingConfiguration && (
            <div className="text-sm">
              <p className="text-[var(--color-muted-foreground)]">Bedding Configuration</p>
              <p className="font-medium">{property.beddingConfiguration}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            {property.isWheelchairAccessible && <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]">Wheelchair Accessible</span>}
            {property.isFullyModified && <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-secondary-container)] text-[#0d1c2e]">Fully Modified</span>}
            {property.isSemiModified && <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-secondary-container)] text-[#0d1c2e]">Semi Modified</span>}
          </div>
        </div>

        {/* Contact & Address */}
        <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 space-y-4">
          <h2 className="font-semibold text-lg">Contact & Address</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[var(--color-muted-foreground)]">Contact Person</p>
              <p className="font-medium">{property.contactPerson || '—'}</p>
            </div>
            <div>
              <p className="text-[var(--color-muted-foreground)]">Email</p>
              <p className="font-medium">{property.email || '—'}</p>
            </div>
            <div>
              <p className="text-[var(--color-muted-foreground)]">Phone</p>
              <p className="font-medium">{property.phone || '—'}</p>
            </div>
            <div>
              <p className="text-[var(--color-muted-foreground)]">Mobile</p>
              <p className="font-medium">{property.mobile || '—'}</p>
            </div>
          </div>
          <div className="text-sm">
            <p className="text-[var(--color-muted-foreground)]">Address</p>
            <p className="font-medium">
              {[property.address, property.suburb, property.state, property.postcode].filter(Boolean).join(', ') || '—'}
            </p>
          </div>
          {property.website && (
            <div className="text-sm">
              <p className="text-[var(--color-muted-foreground)]">Website</p>
              {/^[a-z]+:\/\//i.test(property.website) ? (
                <a href={property.website} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--color-primary)] hover:underline">{property.website}</a>
              ) : (
                <p className="font-medium">{property.website}</p>
              )}
            </div>
          )}
        </div>

        {/* Notes */}
        {(property.accessibilityNotes || property.hoistBathroomNotes || property.generalNotes) && (
          <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 space-y-4 md:col-span-2">
            <h2 className="font-semibold text-lg">Notes</h2>
            <div className="space-y-3 text-sm">
              {property.accessibilityNotes && (
                <div>
                  <p className="text-[var(--color-muted-foreground)]">Accessibility Notes</p>
                  <p>{property.accessibilityNotes}</p>
                </div>
              )}
              {property.hoistBathroomNotes && (
                <div>
                  <p className="text-[var(--color-muted-foreground)]">Hoist / Bathroom Notes</p>
                  <p>{property.hoistBathroomNotes}</p>
                </div>
              )}
              {property.generalNotes && (
                <div>
                  <p className="text-[var(--color-muted-foreground)]">General Notes</p>
                  <p>{property.generalNotes}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
