import { useParams } from 'react-router-dom'
import { useAccommodationDetail } from '@/api/hooks'
import { ArrowLeft, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { StatusBadge } from '@/components/StatusBadge'
import { Card } from '@/components/Card'
import { FactList } from '@/components/FactList'

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
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title={property.propertyName}
        subtitle={
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-[var(--color-muted-foreground)]">
            <StatusBadge status={property.isActive ? 'Active' : 'Inactive'} />
            <span>{property.location || 'No location'}{property.region ? ` · ${property.region}` : ''}</span>
          </div>
        }
        action={
          <div className="flex gap-2 shrink-0">
            <Button to="/accommodation" variant="secondary" size="md">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <Button to={`/accommodation/${id}/edit`} variant="primary" size="md">
              <Pencil className="w-4 h-4" /> Edit
            </Button>
          </div>
        }
      />

      {/* min(26rem,100%): a bare 26rem track floor (416px) overflows a 390px phone viewport. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))] items-start gap-[var(--section-gap)]">
        {/* Details */}
        <Card title="Property Details">
          <FactList
            items={[
              { label: 'Provider / Owner', value: property.providerOwner },
              { label: 'Max Capacity', value: property.maxCapacity },
              { label: 'Bedrooms', value: property.bedroomCount },
              { label: 'Beds', value: property.bedCount },
              { label: 'Bedding Configuration', value: property.beddingConfiguration },
            ]}
          />
          {(property.isWheelchairAccessible || property.isFullyModified || property.isSemiModified) && (
            <div className="flex flex-wrap gap-2 pt-2 mt-2 border-t border-[var(--color-border)]">
              {property.isWheelchairAccessible && <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]">Wheelchair Accessible</span>}
              {property.isFullyModified && <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-secondary-container)] text-[var(--color-foreground)]">Fully Modified</span>}
              {property.isSemiModified && <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-secondary-container)] text-[var(--color-foreground)]">Semi Modified</span>}
            </div>
          )}
        </Card>

        {/* Contact & Address */}
        <Card title="Contact & Address">
          <FactList
            items={[
              { label: 'Contact Person', value: property.contactPerson },
              { label: 'Email', value: property.email },
              { label: 'Phone', value: property.phone },
              { label: 'Mobile', value: property.mobile },
              { label: 'Address', value: [property.address, property.suburb, property.state, property.postcode].filter(Boolean).join(', ') || undefined },
              {
                label: 'Website',
                value: property.website
                  ? (/^[a-z]+:\/\//i.test(property.website)
                    ? <a href={property.website} target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] hover:underline">{property.website}</a>
                    : property.website)
                  : undefined,
              },
            ]}
          />
        </Card>

        {/* Notes */}
        {(property.accessibilityNotes || property.hoistBathroomNotes || property.generalNotes) && (
          <Card title="Notes" className="col-span-full">
            <FactList
              items={[
                { label: 'Accessibility Notes', value: property.accessibilityNotes },
                { label: 'Hoist / Bathroom Notes', value: property.hoistBathroomNotes },
                { label: 'General Notes', value: property.generalNotes },
              ]}
            />
          </Card>
        )}
      </div>
    </div>
  )
}
