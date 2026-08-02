import { useTripItinerary } from '@/api/hooks'
import { formatDateAu } from '@/lib/utils'
import { MapPin, Clock, Users, Building2, UserCog, DollarSign, FileDown, Calendar, Utensils, Camera, Bus, Compass, Palette, Dumbbell, Star } from 'lucide-react'
import { useState } from 'react'
import { generateItineraryPdf } from './ItineraryPdf'
import { Dropdown } from './Dropdown'

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

const categoryConfig: Record<string, { icon: typeof Star; color: string; bg: string }> = {
  Leisure: { icon: Star, color: '#396200', bg: '#bbf37c' },
  Dining: { icon: Utensils, color: '#92400e', bg: '#fef3c7' },
  Transport: { icon: Bus, color: '#515f74', bg: '#d5e3fc' },
  Sightseeing: { icon: Camera, color: '#065f46', bg: '#d1fae5' },
  Adventure: { icon: Compass, color: '#ba1a1a', bg: '#ffdad6' },
  Cultural: { icon: Palette, color: '#9a3412', bg: '#fed7aa' },
  Sport: { icon: Dumbbell, color: '#115e59', bg: '#ccfbf1' },
  Other: { icon: Star, color: '#43493a', bg: '#e4e2de' },
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

function formatDateLong(date: string) {
  return parseLocalDate(date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

const activityStatusStyle: Record<string, string> = {
  Planned: 'bg-[#e4e2de] text-[#43493a]',
  Booked: 'bg-[#fef3c7] text-[#92400e]',
  Confirmed: 'bg-[#bbf37c] text-[#0f2000]',
  Completed: 'bg-[#d5e3fc] text-[#0d1c2e]',
  Cancelled: 'bg-[#ffdad6] text-[#93000a]',
}

export default function ItineraryTab({ tripId, trip }: ItineraryTabProps) {
  const { data: itinerary, isLoading, isError } = useTripItinerary(tripId)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  if (isLoading) return <div className="flex items-center justify-center h-64 text-[#43493a]">Loading itinerary...</div>
  if (isError || !itinerary) return <div className="text-center py-12 text-[#43493a]">Unable to load itinerary. Make sure the trip has dates and a generated schedule.</div>

  const handleExport = async (version: 'staff' | 'participant') => {
    setExporting(true)
    setExportError(null)
    try {
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
        <div className="text-sm text-[#ba1a1a] bg-[#ffdad6]/60 rounded-2xl px-4 py-2">{exportError}</div>
      )}
      <div className="flex items-center justify-end">
        <Dropdown
          variant="menu"
          icon={<FileDown className="w-4 h-4" />}
          label={exporting ? 'Exporting…' : 'Export Trip Package'}
          loading={exporting}
          onSelect={val => handleExport(val as 'staff' | 'participant')}
          items={[
            { value: 'participant', label: 'Participant Version', icon: <Users className="w-4 h-4 text-[#396200]" />, description: 'Without staff details' },
            { value: 'staff', label: 'Staff Version', icon: <UserCog className="w-4 h-4 text-[#515f74]" />, description: 'Includes operational details' },
          ]}
        />
      </div>

      {/* Overview Hero Card */}
      <div className="bg-white rounded-2xl p-6 relative overflow-hidden shadow-[0_24px_32px_-12px_rgba(27,28,26,0.04)]">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#396200]/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="relative">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-[#396200] font-bold mb-1">Trip Overview</p>
              <h2 className="text-2xl font-bold text-[#1b1c1a]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{itinerary.tripName}</h2>
              <div className="flex items-center gap-2 mt-2 text-[#43493a]">
                <MapPin className="w-4 h-4 text-[#396200]" />
                <span>{itinerary.destination || 'Destination TBD'}</span>
                {itinerary.region && <span className="text-xs px-2 py-0.5 rounded-full bg-[#efeeea] text-[#43493a]">{itinerary.region}</span>}
              </div>
              <p className="text-sm text-[#43493a] mt-1">
                {formatDateLong(itinerary.startDate)} — {formatDateLong(itinerary.endDate)}
              </p>
            </div>
            {itinerary.tripCode && (
              <span className="font-mono text-sm bg-[#efeeea] text-[#43493a] px-3 py-1.5 rounded-lg">{itinerary.tripCode}</span>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            {[
              { icon: Calendar, label: 'Duration', value: `${itinerary.durationDays} days` },
              { icon: Users, label: 'Participants', value: itinerary.participantCount },
              { icon: UserCog, label: 'Staff', value: itinerary.staffCount },
              { icon: DollarSign, label: 'Est. Cost', value: `$${Number(itinerary.totalEstimatedCost).toLocaleString('en-AU', { minimumFractionDigits: 2 })}` },
            ].map(s => (
              <div key={s.label} className="bg-[#efeeea] rounded-2xl p-3 text-center">
                <s.icon className="w-4 h-4 mx-auto text-[#396200] mb-1" />
                <p className="text-lg font-bold text-[#1b1c1a]">{s.value}</p>
                <p className="text-xs text-[#43493a]">{s.label}</p>
              </div>
            ))}
          </div>

          {itinerary.notes && (
            <p className="text-sm text-[#43493a] mt-4 pt-4">{itinerary.notes}</p>
          )}
        </div>
      </div>

      {/* Admin details (from trip data) */}
      {trip && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-[#f5f3ef] rounded-2xl p-5 space-y-3">
            <h3 className="font-semibold text-[#1b1c1a]">Trip Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
              <span className="text-[#43493a]">Event Template</span><span className="text-[#1b1c1a]">{trip.eventTemplateName || '—'}</span>
              <span className="text-[#43493a]">Region</span><span className="text-[#1b1c1a]">{itinerary.region || '—'}</span>
              <span className="text-[#43493a]">OOP Due Date</span><span className="text-[#1b1c1a]">{trip.oopDueDate ? formatDateAu(trip.oopDueDate) : '—'}</span>
              <span className="text-[#43493a]">Booking Cutoff</span><span className="text-[#1b1c1a]">{trip.bookingCutoffDate ? formatDateAu(trip.bookingCutoffDate) : '—'}</span>
              <span className="text-[#43493a]">Lead Coordinator</span><span className="text-[#1b1c1a]">{itinerary.leadCoordinatorName || '—'}</span>
              <span className="text-[#43493a]">Min Participants</span><span className="text-[#1b1c1a]">{trip.minParticipants || '—'}</span>
              <span className="text-[#43493a]">Min Staff</span><span className="text-[#1b1c1a]">{trip.minStaffRequired || '—'}</span>
            </div>
          </div>
          <div className="bg-[#f5f3ef] rounded-2xl p-5 space-y-3">
            <h3 className="font-semibold text-[#1b1c1a]">Requirements</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
              <span className="text-[#43493a]">Wheelchair Capacity</span><span className="text-[#1b1c1a]">{trip.requiredWheelchairCapacity || '—'}</span>
              <span className="text-[#43493a]">Required Beds</span><span className="text-[#1b1c1a]">{trip.requiredBeds || '—'}</span>
              <span className="text-[#43493a]">Required Bedrooms</span><span className="text-[#1b1c1a]">{trip.requiredBedrooms || '—'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Day-by-day timeline */}
      <div>
        <h3 className="font-bold text-lg mb-4 flex items-center gap-2 text-[#1b1c1a]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          <Calendar className="w-5 h-5 text-[#396200]" />
          Day-by-Day Schedule
        </h3>

        <div className="relative">
          {/* Timeline connector line */}
          <div className="absolute left-6 top-0 bottom-0 w-1 bg-[#b9c7df] rounded-full hidden md:block" />

          <div className="space-y-6">
            {itinerary.days.map((day: any) => (
              <div key={day.dayNumber} className="relative md:pl-16">
                {/* Day number badge on timeline */}
                <div className="hidden md:flex absolute left-0 top-5 w-12 h-12 rounded-full bg-[#8e337b] items-center justify-center text-white font-bold text-sm z-10 shadow-[0_8px_24px_-4px_rgba(142,51,123,0.35)]">
                  {day.dayNumber}
                </div>

                <div className="bg-white rounded-2xl overflow-hidden shadow-[0_24px_32px_-12px_rgba(27,28,26,0.04)]">
                  {/* Day header */}
                  <div className="bg-gradient-to-r from-[#396200]/8 to-transparent px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="md:hidden w-8 h-8 rounded-full bg-[#8e337b] flex items-center justify-center text-white font-bold text-xs">{day.dayNumber}</span>
                      <div>
                        <h4 className="font-bold text-[#1b1c1a]">{day.dayTitle || `Day ${day.dayNumber}`}</h4>
                        <p className="text-sm text-[#43493a]">{formatDayName(day.date)} · {formatDateAu(day.date)}</p>
                      </div>
                    </div>
                    {day.dayNotes && <p className="text-sm text-[#43493a] mt-2 ml-11 md:ml-0">{day.dayNotes}</p>}
                  </div>

                  <div className="p-5 space-y-3">
                    {/* Accommodation events */}
                    {day.accommodationEvents?.map((ae: any, i: number) => (
                      <div key={`ae-${i}`} className="flex items-center gap-3 p-3 rounded-2xl bg-[#f5f3ef]">
                        <Building2 className="w-5 h-5 text-[#396200] shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-[#1b1c1a]">
                            <span className="text-[#396200]">{ae.eventType}</span> — {ae.propertyName}
                          </p>
                          {ae.address && <p className="text-xs text-[#43493a]">{ae.address}</p>}
                          {ae.confirmationReference && <p className="text-xs text-[#43493a]">Ref: {ae.confirmationReference}</p>}
                        </div>
                      </div>
                    ))}

                    {/* Staff on duty */}
                    {day.staffOnDuty?.length > 0 && (
                      <div className="flex items-center gap-2 text-xs text-[#43493a] flex-wrap">
                        <UserCog className="w-3.5 h-3.5 text-[#515f74]" />
                        <span className="font-medium text-[#515f74]">Staff:</span>
                        {day.staffOnDuty.map((name: string, i: number) => (
                          <span key={i} className="px-2 py-0.5 rounded-full bg-[#efeeea] text-[#43493a]">
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
                            <div key={i} className="flex gap-3 p-4 rounded-2xl bg-[#f5f3ef] hover:bg-[#efeeea] transition-colors">
                              <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: cat.bg }}>
                                <CatIcon className="w-5 h-5" style={{ color: cat.color }} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-sm text-[#1b1c1a]">{activity.title}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${activityStatusStyle[activity.status] || activityStatusStyle.Planned}`}>
                                    {activity.status}
                                  </span>
                                  {activity.category && (
                                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: cat.bg, color: cat.color }}>
                                      {activity.category}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-[#43493a] mt-1 flex-wrap">
                                  {(activity.startTime || activity.endTime) && (
                                    <span className="flex items-center gap-1 text-[#396200] font-bold w-12">
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
                                    <span className="flex items-center gap-1">
                                      <DollarSign className="w-3 h-3" /> ${Number(activity.estimatedCost).toFixed(2)}
                                    </span>
                                  )}
                                </div>
                                {activity.providerName && (
                                  <p className="text-xs text-[#43493a] mt-1">
                                    Provider: {activity.providerName}
                                    {activity.providerPhone && ` · ${activity.providerPhone}`}
                                  </p>
                                )}
                                {activity.bookingReference && (
                                  <p className="text-xs text-[#43493a]">Ref: {activity.bookingReference}</p>
                                )}
                                {activity.accessibilityNotes && (
                                  <p className="flex items-center gap-1 text-xs text-[#f59e0b] mt-1"><span className="material-symbols-outlined text-base leading-none">accessible</span> {activity.accessibilityNotes}</p>
                                )}
                                {activity.notes && (
                                  <p className="text-xs text-[#43493a] mt-1 italic">{activity.notes}</p>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      !day.accommodationEvents?.length && (
                        <p className="text-sm text-[#43493a] italic py-2">No activities scheduled</p>
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
        <div className="text-center py-12 text-[#43493a]">
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-40 text-[#396200]" />
          <p className="font-medium text-[#1b1c1a]">No schedule has been generated yet.</p>
          <p className="text-sm mt-1">Go to the Activities tab to generate the day-by-day schedule first.</p>
        </div>
      )}
    </div>
  )
}
