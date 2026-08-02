import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer'
import type { ItineraryDto, ItineraryAccommodationDto, ItineraryVehicleDto, ItineraryStaffDto, ItineraryParticipantDto, ItineraryDayDto, ItineraryActivityDto, ItineraryDayAccommodationEventDto } from '@/api/types'

type ExportVersion = 'staff' | 'participant'

const colors = {
  primary: '#3b82f6',
  dark: '#0f172a',
  card: '#1e293b',
  border: '#334155',
  muted: '#94a3b8',
  text: '#f8fafc',
  white: '#ffffff',
  black: '#000000',
  success: '#22c55e',
  warning: '#f59e0b',
}

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10, color: colors.black },
  header: { marginBottom: 20, borderBottom: '2 solid #3b82f6', paddingBottom: 15 },
  title: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: colors.primary, marginBottom: 4 },
  subtitle: { fontSize: 12, color: '#475569', marginBottom: 2 },
  meta: { fontSize: 9, color: '#64748b' },
  statsRow: { flexDirection: 'row', gap: 15, marginTop: 10 },
  statBox: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 6, padding: 8, alignItems: 'center' as const },
  statValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: colors.primary },
  statLabel: { fontSize: 7, color: '#64748b', marginTop: 2 },
  sectionTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: colors.primary, marginTop: 16, marginBottom: 8, borderBottom: '1 solid #e2e8f0', paddingBottom: 4 },
  dayCard: { marginBottom: 12, border: '1 solid #e2e8f0', borderRadius: 6, overflow: 'hidden' as const },
  dayHeader: { backgroundColor: '#eff6ff', padding: 10, flexDirection: 'row', alignItems: 'center' as const, gap: 8 },
  dayBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const },
  dayBadgeText: { color: colors.white, fontFamily: 'Helvetica-Bold', fontSize: 11 },
  dayTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  dayDate: { fontSize: 9, color: '#64748b' },
  dayBody: { padding: 10 },
  activityRow: { flexDirection: 'row', gap: 8, marginBottom: 6, paddingBottom: 6, borderBottom: '0.5 solid #f1f5f9' },
  activityTime: { width: 65, fontSize: 9, color: '#64748b', paddingTop: 1 },
  activityContent: { flex: 1 },
  activityTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  activityMeta: { fontSize: 8, color: '#64748b', marginTop: 1 },
  accommEvent: { flexDirection: 'row', alignItems: 'center' as const, gap: 6, backgroundColor: '#eff6ff', padding: 6, borderRadius: 4, marginBottom: 6 },
  accommEventType: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: colors.primary },
  accommEventName: { fontSize: 9 },
  staffOnDuty: { fontSize: 8, color: '#64748b', marginBottom: 6 },
  infoCard: { border: '1 solid #e2e8f0', borderRadius: 6, padding: 8, marginBottom: 6 },
  infoName: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  infoDetail: { fontSize: 8, color: '#64748b', marginBottom: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  gridHalf: { width: '48%' },
  participantChip: { flexDirection: 'row', alignItems: 'center' as const, gap: 4, backgroundColor: '#f1f5f9', borderRadius: 4, padding: '4 8', marginBottom: 3, marginRight: 3 },
  participantName: { fontSize: 9 },
  participantFlag: { fontSize: 7, color: '#64748b' },
  badge: { fontSize: 7, backgroundColor: '#e2e8f0', borderRadius: 3, padding: '2 5', color: '#475569' },
  footer: { position: 'absolute' as const, bottom: 25, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between' as const, fontSize: 7, color: '#94a3b8', borderTop: '0.5 solid #e2e8f0', paddingTop: 5 },
  versionBadge: { fontSize: 7, color: colors.white, backgroundColor: colors.primary, borderRadius: 3, padding: '2 6' },
  noActivities: { fontSize: 9, color: '#94a3b8', fontStyle: 'italic', padding: 4 },
})

function formatTime(time: string | null | undefined) {
  if (!time) return ''
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

function formatDateAu(date: string | null | undefined) {
  if (!date) return '—'
  return parseLocalDate(date).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateLong(date: string) {
  return parseLocalDate(date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function formatDayName(date: string) {
  return parseLocalDate(date).toLocaleDateString('en-AU', { weekday: 'long' })
}

function ItineraryDocument({ data, version }: { data: ItineraryDto; version: ExportVersion }) {
  const isStaff = version === 'staff'

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={styles.title}>{data.tripName}</Text>
              <Text style={styles.subtitle}>{data.destination || 'Destination TBD'}{data.region ? ` · ${data.region}` : ''}</Text>
              <Text style={styles.meta}>{formatDateLong(data.startDate)} — {formatDateLong(data.endDate)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.versionBadge}>{isStaff ? 'STAFF VERSION' : 'PARTICIPANT VERSION'}</Text>
              {data.tripCode && <Text style={[styles.meta, { marginTop: 4 }]}>{data.tripCode}</Text>}
            </View>
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{data.durationDays}</Text>
              <Text style={styles.statLabel}>DAYS</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{data.participantCount}</Text>
              <Text style={styles.statLabel}>PARTICIPANTS</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{data.staffCount}</Text>
              <Text style={styles.statLabel}>STAFF</Text>
            </View>
            {isStaff && (
              <View style={styles.statBox}>
                <Text style={styles.statValue}>${Number(data.totalEstimatedCost).toFixed(0)}</Text>
                <Text style={styles.statLabel}>EST. COST</Text>
              </View>
            )}
          </View>
        </View>

        {/* Accommodation */}
        {data.accommodation.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Accommodation</Text>
            <View style={styles.grid}>
              {data.accommodation.map((a: ItineraryAccommodationDto, i: number) => (
                <View key={i} style={[styles.infoCard, styles.gridHalf]}>
                  <Text style={styles.infoName}>{a.propertyName}</Text>
                  {(a.address || a.suburb) && <Text style={styles.infoDetail}>{[a.address, a.suburb, a.state].filter(Boolean).join(', ')}</Text>}
                  <Text style={styles.infoDetail}>{formatDateAu(a.checkInDate)} — {formatDateAu(a.checkOutDate)}</Text>
                  {a.confirmationReference && isStaff && <Text style={styles.infoDetail}>Ref: {a.confirmationReference}</Text>}
                  {a.phone && isStaff && <Text style={styles.infoDetail}>Ph: {a.phone}</Text>}
                  {a.cost != null && isStaff && <Text style={styles.infoDetail}>Cost: ${Number(a.cost).toFixed(2)}</Text>}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Vehicles */}
        {data.vehicles.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Vehicles</Text>
            <View style={styles.grid}>
              {data.vehicles.map((v: ItineraryVehicleDto, i: number) => (
                <View key={i} style={[styles.infoCard, styles.gridHalf]}>
                  <Text style={styles.infoName}>{v.vehicleName}</Text>
                  <Text style={styles.infoDetail}>{v.vehicleType} · {v.totalSeats} seats{v.wheelchairPositions > 0 ? ` · ${v.wheelchairPositions} wheelchair pos.` : ''}</Text>
                  {v.registration && isStaff && <Text style={styles.infoDetail}>Rego: {v.registration}</Text>}
                  {v.driverName && <Text style={styles.infoDetail}>Driver: {v.driverName}</Text>}
                  {v.pickupTravelNotes && <Text style={styles.infoDetail}>{v.pickupTravelNotes}</Text>}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Staff — staff version only */}
        {isStaff && data.staff.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Staff Roster</Text>
            {data.staff.map((s: ItineraryStaffDto, i: number) => (
              <View key={i} style={[styles.infoCard, { flexDirection: 'row', justifyContent: 'space-between' }]}>
                <View>
                  <Text style={styles.infoName}>{s.name}</Text>
                  <Text style={styles.infoDetail}>{s.role}{s.isDriver ? ' · Driver' : ''}{s.sleepoverType && s.sleepoverType !== 'None' ? ` · ${s.sleepoverType}` : ''}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.infoDetail}>{formatDateAu(s.assignmentStart)} — {formatDateAu(s.assignmentEnd)}</Text>
                  {s.mobile && <Text style={styles.infoDetail}>{s.mobile}</Text>}
                  {s.email && <Text style={styles.infoDetail}>{s.email}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Participants */}
        {data.participants.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Participants ({data.participants.length})</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {data.participants.map((p: ItineraryParticipantDto) => (
                <View key={p.id} style={styles.participantChip}>
                  <Text style={styles.participantName}>{p.name}</Text>
                  {(p.wheelchairRequired || p.highSupportRequired || p.nightSupportRequired) && (
                    <Text style={styles.participantFlag}>
                      {p.wheelchairRequired ? 'WC ' : ''}{p.highSupportRequired ? 'HS ' : ''}{p.nightSupportRequired ? 'NS' : ''}
                    </Text>
                  )}
                </View>
              ))}
            </View>
            {isStaff && data.participants.some((p: ItineraryParticipantDto) => p.mobilityNotes || p.medicalSummary) && (
              <View style={{ marginTop: 8 }}>
                <Text style={[styles.infoDetail, { fontFamily: 'Helvetica-Bold', marginBottom: 4 }]}>Support Notes</Text>
                {data.participants.filter((p: ItineraryParticipantDto) => p.mobilityNotes || p.medicalSummary).map((p: ItineraryParticipantDto) => (
                  <View key={p.id} style={{ marginBottom: 4 }}>
                    <Text style={[styles.infoDetail, { fontFamily: 'Helvetica-Bold' }]}>{p.name}</Text>
                    {p.mobilityNotes && <Text style={styles.infoDetail}>Mobility: {p.mobilityNotes}</Text>}
                    {p.medicalSummary && <Text style={styles.infoDetail}>Medical: {p.medicalSummary}</Text>}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={styles.footer}>
          <Text>Generated {new Date().toLocaleDateString('en-AU')} · Odip</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      {/* Schedule pages */}
      {data.days.length > 0 && (
        <Page size="A4" style={styles.page} wrap>
          <Text style={[styles.sectionTitle, { marginTop: 0 }]}>Day-by-Day Schedule</Text>

          {data.days.map((day: ItineraryDayDto) => (
            <View key={day.dayNumber} style={styles.dayCard} wrap={false}>
              <View style={styles.dayHeader}>
                <View style={styles.dayBadge}>
                  <Text style={styles.dayBadgeText}>{day.dayNumber}</Text>
                </View>
                <View>
                  <Text style={styles.dayTitle}>{day.dayTitle || `Day ${day.dayNumber}`}</Text>
                  <Text style={styles.dayDate}>{formatDayName(day.date)} · {formatDateAu(day.date)}</Text>
                </View>
              </View>
              <View style={styles.dayBody}>
                {day.dayNotes && <Text style={[styles.infoDetail, { marginBottom: 6 }]}>{day.dayNotes}</Text>}

                {day.accommodationEvents?.map((ae: ItineraryDayAccommodationEventDto, i: number) => (
                  <View key={`ae-${i}`} style={styles.accommEvent}>
                    <Text style={styles.accommEventType}>{ae.eventType}</Text>
                    <Text style={styles.accommEventName}>{ae.propertyName}{ae.address ? ` · ${ae.address}` : ''}</Text>
                  </View>
                ))}

                {isStaff && day.staffOnDuty?.length > 0 && (
                  <Text style={styles.staffOnDuty}>Staff: {day.staffOnDuty.join(', ')}</Text>
                )}

                {day.activities?.length > 0 ? day.activities.map((a: ItineraryActivityDto, i: number) => (
                  <View key={i} style={styles.activityRow}>
                    <Text style={styles.activityTime}>
                      {formatTime(a.startTime)}{a.endTime ? `–${formatTime(a.endTime)}` : ''}
                    </Text>
                    <View style={styles.activityContent}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={styles.activityTitle}>{a.title}</Text>
                        {a.category && <Text style={styles.badge}>{a.category}</Text>}
                      </View>
                      {a.location && <Text style={styles.activityMeta}>{a.location}</Text>}
                      {isStaff && a.providerName && <Text style={styles.activityMeta}>Provider: {a.providerName}{a.providerPhone ? ` · ${a.providerPhone}` : ''}</Text>}
                      {isStaff && a.bookingReference && <Text style={styles.activityMeta}>Ref: {a.bookingReference}</Text>}
                      {isStaff && a.estimatedCost != null && <Text style={styles.activityMeta}>Cost: ${Number(a.estimatedCost).toFixed(2)}</Text>}
                      {a.accessibilityNotes && <Text style={[styles.activityMeta, { color: '#d97706' }]}>Accessibility: {a.accessibilityNotes}</Text>}
                      {a.notes && <Text style={styles.activityMeta}>{a.notes}</Text>}
                    </View>
                  </View>
                )) : (
                  !day.accommodationEvents?.length && <Text style={styles.noActivities}>No activities scheduled</Text>
                )}
              </View>
            </View>
          ))}

          <View style={styles.footer} fixed>
            <Text>Generated {new Date().toLocaleDateString('en-AU')} · Odip</Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      )}
    </Document>
  )
}

export async function generateItineraryPdf(data: ItineraryDto, version: ExportVersion) {
  const blob = await pdf(<ItineraryDocument data={data} version={version} />).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safeName = data.tripName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')
  a.href = url
  a.download = `${safeName}-itinerary-${version}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
