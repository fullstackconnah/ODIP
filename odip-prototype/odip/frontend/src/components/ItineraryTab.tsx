import { useTripItinerary } from '@/api/hooks'
import { formatCurrency, formatDateAu } from '@/lib/utils'
import { MapPin, Clock, Users, Building2, UserCog, FileDown, Calendar, Utensils, Camera, Bus, Compass, Palette, Dumbbell, Star } from 'lucide-react'
import { Fragment, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Dropdown } from './Dropdown'
import { EmptyState } from './EmptyState'
import { PageState } from './PageState'
import { statusClass } from '@/lib/tone'
import { Callout } from '@/components/Callout'
import { retryingAfterError } from '@/lib/queryPhase'

interface TripAdminData {
  eventTemplateName?: string | null
  oopDueDate?: string
  bookingCutoffDate?: string | null
  minParticipants?: number | null
  minStaffRequired?: number | null
  requiredWheelchairCapacity?: number | null
  requiredBeds?: number | null
  requiredBedrooms?: number | null
}

interface ItineraryTabProps {
  tripId: string
  trip?: TripAdminData
}

// Palette tokens only (DESIGN.md, The Semantic Colour Rule): there are fewer tokens than categories, so some share a fill; the icon and the label tell them apart.
const categoryConfig: Record<string, { icon: typeof Star; color: string; bg: string }> = {
  Leisure: { icon: Star, color: 'var(--color-primary)', bg: 'var(--color-primary-fixed)' },
  Dining: { icon: Utensils, color: 'var(--color-on-warning-container)', bg: 'var(--color-warning-container)' },
  Transport: { icon: Bus, color: 'var(--color-secondary)', bg: 'var(--color-secondary-container)' },
  Sightseeing: { icon: Camera, color: 'var(--color-on-primary-fixed)', bg: 'var(--color-primary-fixed)' },
  Adventure: { icon: Compass, color: 'var(--color-destructive)', bg: 'var(--color-error-container)' },
  Cultural: { icon: Palette, color: 'var(--color-on-warning-container)', bg: 'var(--color-warning-container)' },
  Sport: { icon: Dumbbell, color: 'var(--color-info)', bg: 'var(--color-secondary-container)' },
  Other: { icon: Star, color: 'var(--color-muted-foreground)', bg: 'var(--color-input)' },
}

function getCategoryStyle(category: string | null) {
  return categoryConfig[category ?? 'Other'] ?? categoryConfig.Other
}

function formatTime(time: string | null | undefined) {
  if (!time) return null
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'pm' : 'am'
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return `${h12}:${m}${ampm}`
}

function parseLocalDate(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDayName(date: string) {
  return parseLocalDate(date).toLocaleDateString('en-AU', { weekday: 'long' })
}

export default function ItineraryTab({ tripId, trip }: ItineraryTabProps) {
  const pageQuery = useTripItinerary(tripId)
  const { data: itinerary, isLoading, isError, refetch } = pageQuery
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  if (isLoading && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="itinerary" />
  if (!itinerary) {
    // A failed request is not an empty itinerary: offer the retry instead of the "no schedule yet" hint.
    if (isError || retryingAfterError(pageQuery)) return <PageState kind="error" noun="itinerary" onRetry={() => refetch()} />
    // Rendered inline at the top of the pane (size="inline"), not centered in an otherwise-empty
    // viewport void, so it reads as part of the page rather than a floating standalone state.
    return (
      <EmptyState
        size="inline"
        icon={Calendar}
        title="Unable to load itinerary"
        description="Make sure the trip has dates and a generated schedule."
      />
    )
  }

  // [label, value] facts with a value; a 0 minimum or requirement counts as not set, as it always has.
  const recorded = (facts: [string, ReactNode][]) => facts.filter(([, value]) => !!value)
  const factGroups = ([
    ['Trip details', recorded([
      ['Event template', trip?.eventTemplateName],
      ['Region', itinerary.region],
      ['OOP due date', trip?.oopDueDate && formatDateAu(trip.oopDueDate)],
      ['Booking cutoff', trip?.bookingCutoffDate && formatDateAu(trip.bookingCutoffDate)],
      ['Lead coordinator', itinerary.leadCoordinatorName],
      ['Min participants', trip?.minParticipants],
      ['Min staff', trip?.minStaffRequired],
      ['Est. cost', Number(itinerary.totalEstimatedCost) > 0 && formatCurrency(Number(itinerary.totalEstimatedCost))],
    ])],
    ['Requirements', recorded([
      ['Wheelchair capacity', trip?.requiredWheelchairCapacity],
      ['Required beds', trip?.requiredBeds],
      ['Required bedrooms', trip?.requiredBedrooms],
    ])],
  ] as [string, [string, ReactNode][]][]).filter(([, facts]) => facts.length > 0)

  const handleExport = async (version: 'staff' | 'participant') => {
    setExporting(true)
    setExportError(null)
    try {
      // The PDF library is large: fetch it when a PDF is asked for, not with every trip page.
      const { generateItineraryPdf } = await import('./ItineraryPdf')
      await generateItineraryPdf(itinerary, version)
    } catch (err) {
      console.error('PDF export failed:', err)
      setExportError(err instanceof Error ? err.message : 'Export failed — check browser console for details.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Export buttons */}
      {exportError && (
        <Callout tone="error">{exportError}</Callout>
      )}
      <div className="flex items-center justify-end">
        <Dropdown
          variant="menu"
          triggerVariant="secondary"
          icon={<FileDown className="w-4 h-4" />}
          label={exporting ? 'Exporting…' : 'Export trip package'}
          loading={exporting}
          onSelect={val => handleExport(val as 'staff' | 'participant')}
          items={[
            { value: 'participant', label: 'Participant Version', icon: <Users className="w-4 h-4 text-[var(--color-primary)]" />, description: 'Without staff details' },
            { value: 'staff', label: 'Staff Version', icon: <UserCog className="w-4 h-4 text-[var(--color-secondary)]" />, description: 'Includes operational details' },
          ]}
        />
      </div>

      {itinerary.notes && <p className="text-sm text-[var(--color-muted-foreground)]">{itinerary.notes}</p>}

      {/* Admin details (from trip data): only what is recorded. The title, dates, days and head counts are in the header and the glance strip.
          Label and value sit side by side at every width: stacked on a phone, seven facts took ~450px. */}
      {factGroups.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          {factGroups.map(([title, facts]) => (
            <div key={title} className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)] p-5 space-y-3">
              <h3 className="font-semibold text-[var(--color-foreground)]">{title}</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {facts.map(([label, value]) => (
                  <Fragment key={label}><span className="text-[var(--color-muted-foreground)]">{label}</span><span className="text-[var(--color-foreground)]">{value}</span></Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Day-by-day timeline */}
      <div>
        <h3 className="font-bold text-lg mb-4 flex items-center gap-2 text-[var(--color-foreground)]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          <Calendar className="w-5 h-5 text-[var(--color-primary)]" />
          Day-by-day schedule
        </h3>

        <div className="relative">
          {/* Timeline connector line */}
          <div className="absolute left-6 top-0 bottom-0 w-1 bg-[var(--color-secondary-container)] rounded-full hidden md:block" />

          <div className="space-y-6">
            {itinerary.days.map((day: any) => (
              <div key={day.dayNumber} className="relative md:pl-16">
                {/* Day number badge on timeline */}
                <div className="hidden md:flex absolute left-0 top-5 w-12 h-12 rounded-full bg-[var(--color-on-accessible-container)] items-center justify-center text-[var(--color-card)] font-bold text-sm z-10 shadow-lg">
                  {day.dayNumber}
                </div>

                <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] overflow-hidden shadow-[var(--shadow-hairline)]">
                  {/* Day header */}
                  <div className="bg-gradient-to-r from-[var(--color-primary)]/8 to-transparent px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="md:hidden w-8 h-8 rounded-full bg-[var(--color-on-accessible-container)] flex items-center justify-center text-[var(--color-card)] font-bold text-xs">{day.dayNumber}</span>
                      <div>
                        <h4 className="font-bold text-[var(--color-foreground)]">{day.dayTitle || `Day ${day.dayNumber}`}</h4>
                        <p className="text-sm text-[var(--color-muted-foreground)]">{formatDayName(day.date)} · {formatDateAu(day.date)}</p>
                      </div>
                    </div>
                    {day.dayNotes && <p className="text-sm text-[var(--color-muted-foreground)] mt-2 ml-11 md:ml-0">{day.dayNotes}</p>}
                  </div>

                  <div className="p-5 space-y-3">
                    {/* Accommodation events */}
                    {day.accommodationEvents?.map((ae: any, i: number) => (
                      <div key={`ae-${i}`} className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)]">
                        <Building2 className="w-5 h-5 text-[var(--color-primary)] shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-[var(--color-foreground)]">
                            <span className="text-[var(--color-primary)]">{ae.eventType}</span> — {ae.propertyName}
                          </p>
                          {ae.address && <p className="text-xs text-[var(--color-muted-foreground)]">{ae.address}</p>}
                          {ae.confirmationReference && <p className="text-xs text-[var(--color-muted-foreground)]">Ref: {ae.confirmationReference}</p>}
                        </div>
                      </div>
                    ))}

                    {/* Staff on duty */}
                    {day.staffOnDuty?.length > 0 && (
                      <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)] flex-wrap">
                        <UserCog className="w-3.5 h-3.5 text-[var(--color-secondary)]" />
                        <span className="font-medium text-[var(--color-secondary)]">Staff:</span>
                        {day.staffOnDuty.map((name: string, i: number) => (
                          <span key={i} className="px-2 py-0.5 rounded-full bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]">
                            {name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Activities */}
                    {day.activities?.length > 0 ? (
                      <div className="space-y-2">
                        {day.activities.map((activity: any, i: number) => {
                          const cat = getCategoryStyle(activity.category)
                          const CatIcon = cat.icon
                          return (
                            <div key={i} className="flex gap-3 p-4 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] hover:bg-[var(--color-surface-container)] transition-colors">
                              <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: cat.bg }}>
                                <CatIcon className="w-5 h-5" style={{ color: cat.color }} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-sm text-[var(--color-foreground)]">{activity.title}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass(activity.status)}`}>
                                    {activity.status}
                                  </span>
                                  {activity.category && (
                                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: cat.bg, color: cat.color }}>
                                      {activity.category}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-[var(--color-muted-foreground)] mt-1 flex-wrap">
                                  {(activity.startTime || activity.endTime) && (
                                    <span className="flex items-center gap-1 text-[var(--color-primary)] font-bold whitespace-nowrap">
                                      <Clock className="w-3 h-3" />
                                      {formatTime(activity.startTime)}{activity.endTime && ` – ${formatTime(activity.endTime)}`}
                                    </span>
                                  )}
                                  {activity.location && (
                                    <span className="flex items-center gap-1">
                                      <MapPin className="w-3 h-3" /> {activity.location}
                                    </span>
                                  )}
                                  {activity.estimatedCost != null && (
                                    <span>{formatCurrency(Number(activity.estimatedCost))}</span>
                                  )}
                                </div>
                                {activity.providerName && (
                                  <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                                    Provider: {activity.providerName}
                                    {activity.providerPhone && ` · ${activity.providerPhone}`}
                                  </p>
                                )}
                                {activity.bookingReference && (
                                  <p className="text-xs text-[var(--color-muted-foreground)]">Ref: {activity.bookingReference}</p>
                                )}
                                {activity.accessibilityNotes && (
                                  <p className="flex items-center gap-1 text-xs text-[var(--color-warning)] mt-1"><span className="material-symbols-outlined text-base leading-none">accessible</span> {activity.accessibilityNotes}</p>
                                )}
                                {activity.notes && (
                                  <p className="text-xs text-[var(--color-muted-foreground)] mt-1 italic">{activity.notes}</p>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      !day.accommodationEvents?.length && (
                        <p className="text-sm text-[var(--color-muted-foreground)] italic py-2">No activities scheduled</p>
                      )
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {itinerary.days.length === 0 && (
        <div className="text-center py-12 text-[var(--color-muted-foreground)]">
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-40 text-[var(--color-primary)]" />
          <p className="font-medium text-[var(--color-foreground)]">No schedule has been generated yet.</p>
          <p className="text-sm mt-1">
            Go to the{' '}
            {/* The trip page keeps its tab in ?tab=, so a link to it switches tabs (replace, as the tab strip does). */}
            <Link to={{ search: '?tab=activities' }} replace className="font-medium text-[var(--color-primary)] underline underline-offset-2">Activities tab</Link>
            {' '}to generate the day-by-day schedule first.
          </p>
        </div>
      )}
    </div>
  )
}
