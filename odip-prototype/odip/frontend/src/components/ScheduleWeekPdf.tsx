import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer'
import { generatedLine } from './ItineraryPdf'
import { formatServiceDate } from '@/lib/format'
import { formatDayAccessibleName, formatShiftTimeRange, formatWeekSpan, isUnfilledShift } from '@/pages/rostering/lib/roster'
import type { RosterBoardDto, ShiftStatus } from '@/api/types'

// A family prints this for the fridge: only what it needs (when, and who), so the renderer takes this narrow model and never a ShiftDto.
export type ScheduleShift = { startTime: string; endTime: string; endsNextDay: boolean; workerFirstName: string | null }
export type ScheduleWeek = { organisationName: string | null; participantName: string; weekStart: string; days: { date: string; shifts: ScheduleShift[] }[] }

// A Draft was never shown to anyone and a Cancelled one is not happening.
const KEPT = new Set<ShiftStatus>(['Published', 'InProgress', 'PendingReview', 'Completed'])

// Pure mapper and download kept beside the document: the lazy import in rostering.ts loads this one module.
// eslint-disable-next-line react-refresh/only-export-components
export function toScheduleWeek(board: RosterBoardDto, participantId: string, participantName: string, organisationName: string | null): ScheduleWeek {
  const row = board.groupBy === 'Participant' ? board.participantRows.find(r => r.participantId === participantId) : undefined
  const kept = (row?.shifts ?? []).filter(s => KEPT.has(s.status))
  return {
    organisationName,
    participantName,
    weekStart: board.weekStart,
    days: board.days.map(date => ({
      date,
      shifts: kept
        .filter(s => s.serviceDate === date)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map(s => ({
          startTime: s.startTime,
          endTime: s.endTime,
          endsNextDay: s.endsNextDay,
          // shortcut: first word of the full name, upgrade to a StaffFirstName on ShiftDto if a family reports a wrong name
          workerFirstName: isUnfilledShift(s) ? null : s.staffName?.trim().split(/\s+/)[0] || null,
        })),
    })),
  }
}

// Helvetica and the hex values of ItineraryPdf, so the two family-facing documents look alike.
const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 64, fontFamily: 'Helvetica', fontSize: 10, color: '#000000' },
  header: { borderBottom: '2 solid #3b82f6', paddingBottom: 15, marginBottom: 20 },
  org: { fontSize: 10, color: '#475569', marginBottom: 4 },
  title: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#3b82f6', marginBottom: 4 },
  name: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#0f172a', marginBottom: 2 },
  dates: { fontSize: 11, color: '#475569' },
  empty: { fontSize: 11, color: '#475569', marginTop: 8 },
  day: { border: '1 solid #e2e8f0', borderRadius: 6, marginBottom: 10 },
  band: { backgroundColor: '#eff6ff', padding: '7 10' },
  bandText: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#0f172a' },
  body: { padding: '6 10' },
  row: { flexDirection: 'row', paddingVertical: 4 },
  rowRule: { borderTop: '0.5 solid #f1f5f9' },
  time: { width: 150, fontFamily: 'Helvetica-Bold', color: '#0f172a' },
  worker: { flex: 1, color: '#0f172a' },
  tbc: { flex: 1, color: '#64748b' },
  noShifts: { fontSize: 9, color: '#94a3b8' },
  running: { position: 'absolute' as const, top: 20, left: 40, right: 40, fontSize: 7, color: '#94a3b8' },
  footer: { position: 'absolute' as const, bottom: 25, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between' as const, fontSize: 7, color: '#94a3b8', borderTop: '0.5 solid #e2e8f0', paddingTop: 5 },
})

export function ScheduleWeekDocument({ week }: { week: ScheduleWeek }) {
  const dates = week.days.map(d => d.date)
  const hasShifts = week.days.some(d => d.shifts.length > 0)
  return (
    <Document title={`Weekly schedule – ${week.participantName}`} language="en-AU">
      <Page size="A4" style={styles.page}>
        {/* Pages 2 and up: a family with two children prints both, and an unnamed page gets mixed up. Absolute, so page 1 loses no height. */}
        <Text fixed style={styles.running} render={({ pageNumber }) => (pageNumber > 1 ? `${week.participantName} · ${formatWeekSpan(dates)}` : null)} />

        <View style={styles.header}>
          {week.organisationName && <Text style={styles.org}>{week.organisationName}</Text>}
          <Text style={styles.title}>Weekly schedule</Text>
          <Text style={styles.name}>{week.participantName}</Text>
          <Text style={styles.dates}>{formatServiceDate(dates[0])} – {formatServiceDate(dates[dates.length - 1])}</Text>
        </View>

        {!hasShifts ? (
          <Text style={styles.empty}>No shifts this week.</Text>
        ) : week.days.map(day => (
          <View key={day.date} style={styles.day} wrap={false}>
            <View style={styles.band}><Text style={styles.bandText}>{formatDayAccessibleName(day.date)}</Text></View>
            <View style={styles.body}>
              {day.shifts.length === 0 ? <Text style={styles.noShifts}>No shifts</Text> : day.shifts.map((s, i) => (
                <View key={i} style={i > 0 ? [styles.row, styles.rowRule] : styles.row}>
                  <Text style={styles.time}>{formatShiftTimeRange(s.startTime, s.endTime)}{s.endsNextDay ? ' (next day)' : ''}</Text>
                  {s.workerFirstName ? <Text style={styles.worker}>{s.workerFirstName}</Text> : <Text style={styles.tbc}>To be confirmed</Text>}
                </View>
              ))}
            </View>
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>{generatedLine(week.organisationName)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

// The download is ItineraryPdf's: an <a download> click, revoked after 5 s so iOS has time to take the file.
// eslint-disable-next-line react-refresh/only-export-components
export async function generateScheduleWeekPdf(week: ScheduleWeek, fileName: string) {
  const blob = await pdf(<ScheduleWeekDocument week={week} />).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
