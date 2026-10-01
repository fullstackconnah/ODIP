import React, { useState } from 'react'
import {
  CalendarRange, Users, Truck, ChevronDown, ChevronRight,
  Car, Shield, Pill, HandMetal, Moon,
  Filter, Download,
} from 'lucide-react'
import {
  useScheduleOverview, useCreateStaffAssignment, useCreateVehicleAssignment, useDeleteStaffAssignment,
} from '../api/hooks'
import { useQueryClient } from '@tanstack/react-query'
import { usePermissions } from '@/lib/permissions'
import { formatRatio, plural } from '@/lib/format'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import {
  ScheduleAssignmentCell, QualBadgeList, ScheduleSummary, TripStatusBadge, AvailabilityList,
  StaffAssignModal, VehicleAssignModal,
  formatDate, tripAccentText,
} from './schedule'
import type {
  ScheduleTripDto, ScheduleStaffDto, ScheduleVehicleDto,
  ScheduleStaffTripStatusDto, ScheduleVehicleTripStatusDto,
  TripPreferenceDto,
  CreateStaffAssignmentDto, CreateVehicleAssignmentDto,
} from '@/api/types'

// ── Matrix geometry ──
//
// Every body row is one line at var(--row-h) (34px fine pointer, 48px coarse): the resource cell
// carries name, role and qualification chips side by side, and each trip cell holds a chip that is
// row-h minus 6px (28px). Nothing here re-declares a pixel height the density tokens already own.
//
// Row separators are per-cell borders (border-separate, not collapse) so they travel with the sticky
// first column instead of being left behind by it when the matrix scrolls sideways.
const ROW_LINE = 'border-b border-b-[color:var(--color-surface-container)]'
const STICKY_COL = 'sticky left-0 z-10 border-r border-r-[color:var(--color-border)] bg-[var(--color-card)] group-hover:bg-[var(--color-surface-container-low)]'
const TRIP_CELL = `px-2 py-0.5 align-middle group-hover:bg-[var(--color-surface-container-low)] ${ROW_LINE}`
// Phones stack the resource line (name/role above chips) so the sticky column stays narrow, so rows
// only lock to --row-h from md up.
const ROW = 'group md:h-[var(--row-h)]'

// ── Main Page ──

export default function SchedulePage() {
  const { canWrite } = usePermissions()
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useScheduleOverview()
  const [expandedStaff, setExpandedStaff] = useState<Set<string>>(new Set())
  const [sectionStaff, setSectionStaff] = useState(true)
  const [sectionVehicles, setSectionVehicles] = useState(true)

  const [assignModal, setAssignModal] = useState<{
    type: 'staff' | 'vehicle'
    resource: ScheduleStaffDto | ScheduleVehicleDto
    trip: ScheduleTripDto
  } | null>(null)

  const staffAssign = useCreateStaffAssignment()
  const vehicleAssign = useCreateVehicleAssignment()
  const staffUnassign = useDeleteStaffAssignment()

  const [unassigning, setUnassigning] = useState<{
    assignmentId: string
    staffName: string
    tripName: string
    tripStart?: string
    tripEnd?: string
  } | null>(null)

  const handleStaffAssign = async (assignData: CreateStaffAssignmentDto) => {
    await staffAssign.mutateAsync(assignData)
    setAssignModal(null)
    queryClient.invalidateQueries({ queryKey: ['schedule-overview'] })
  }

  const handleVehicleAssign = async (assignData: CreateVehicleAssignmentDto) => {
    await vehicleAssign.mutateAsync(assignData)
    setAssignModal(null)
    queryClient.invalidateQueries({ queryKey: ['schedule-overview'] })
  }

  const toggleStaff = (id: string) => {
    setExpandedStaff(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-[var(--section-gap)]">
        <PageHeader title="Schedule Overview" />
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-[var(--card-pad)] py-10 text-center">
          <p className="text-[var(--color-muted-foreground)]">Failed to load schedule overview.</p>
        </div>
      </div>
    )
  }

  const { trips, staff, vehicles } = data
  const tripCount = trips?.length || 0

  // Resource health stats
  const staffAssigned = staff?.filter((s: ScheduleStaffDto) => s.tripStatuses?.some((ts: ScheduleStaffTripStatusDto) => ts.status === 'Assigned')).length || 0
  const vehiclesAssigned = vehicles?.filter((v: ScheduleVehicleDto) => v.tripStatuses?.some((ts: ScheduleVehicleTripStatusDto) => ts.status === 'Assigned')).length || 0
  const conflictsCount = [
    ...(staff?.flatMap((s: ScheduleStaffDto) => s.tripStatuses || []) || []),
    ...(vehicles?.flatMap((v: ScheduleVehicleDto) => v.tripStatuses || []) || []),
  ].filter((ts: ScheduleStaffTripStatusDto | ScheduleVehicleTripStatusDto) => ts.status === 'Conflict').length

  const totalResources = (staff?.length || 0) + (vehicles?.length || 0)
  const utilization = totalResources > 0
    ? Math.round(((staffAssigned + vehiclesAssigned) / totalResources) * 100)
    : 0

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        title="Schedule Overview"
        subtitle="Staff and vehicle assignment across active trips · Click Available to assign"
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-[var(--radius-sm)] bg-[var(--color-surface-container)] p-0.5">
              <button className="h-[calc(var(--control-h)_-_4px)] rounded-[var(--radius-sm)] bg-[var(--color-card)] px-3 text-sm font-bold text-[var(--color-foreground)] shadow-sm">
                Grid View
              </button>
              <button disabled title="Coming soon" className="h-[calc(var(--control-h)_-_4px)] px-3 text-sm font-medium text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50">
                Timeline
              </button>
            </div>
            <button disabled title="Coming soon" className="flex h-[var(--control-h)] w-[var(--control-h)] items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-surface-container)] disabled:cursor-not-allowed disabled:opacity-50">
              <Filter className="h-4 w-4" />
            </button>
            <button disabled title="Coming soon" className="flex h-[var(--control-h)] w-[var(--control-h)] items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-surface-container)] disabled:cursor-not-allowed disabled:opacity-50">
              <Download className="h-4 w-4" />
            </button>
          </div>
        }
      />

      {/* ── Summary strip (one line: trips + resource health) ── */}
      <ScheduleSummary
        tripCount={tripCount}
        staffAssigned={staffAssigned}
        staffTotal={staff?.length || 0}
        vehiclesAssigned={vehiclesAssigned}
        vehiclesTotal={vehicles?.length || 0}
        conflicts={conflictsCount}
        utilization={utilization}
      />

      {/* ── Empty State ── */}
      {tripCount === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)]">
          <EmptyState
            icon={CalendarRange}
            title="No trips scheduled"
            description="Create a trip first to see the schedule overview."
          />
        </div>
      ) : (
        /* ── Schedule Grid Table ── */
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)]">
          <p className="px-[var(--cell-px)] pt-2 text-[13px] text-[var(--color-muted-foreground)] md:hidden">Swipe to see all trips →</p>
          {/*
            The scroll frame. From md up it is height-capped so the matrix scrolls INSIDE it and the sticky
            header row genuinely stays pinned (a sticky header only sticks to its nearest scroller, which
            used to be this wrapper with no height limit, so it never engaged). The sticky first column
            pins horizontally in the same frame. scroll-pt/pl keep a keyboard-focused cell from landing
            underneath the pinned header row or resource column.
          */}
          <div className="overflow-auto scroll-pt-20 scroll-pl-44 md:scroll-pl-80 xl:scroll-pl-[23rem] md:max-h-[max(20rem,calc(100dvh_-_12.5rem))]">
            {/* text-sm on the table: without it every cell inherits the browser's 16px (Tailwind sets no size
                on table cells), which is what made this matrix's cell text 16px. DataTable sets it the same way. */}
            <table
              className="w-full table-fixed border-separate border-spacing-0 text-sm tabular-nums min-w-[calc(11rem_+_var(--trips)_*_10rem)] md:min-w-[calc(20rem_+_var(--trips)_*_10rem)] xl:min-w-[calc(23rem_+_var(--trips)_*_10rem)]"
              style={{ '--trips': tripCount } as React.CSSProperties}
            >
              <colgroup>
                {/* Resources column: 176px on a phone (name/role stack above the chips), 320px (20rem) from md up, 368px
                    (23rem) from xl. The 320 is arithmetic, not taste: 2 x 12px cell padding + 20px chevron and gap + a name +
                    6px gap + 8px gap + the 94px qualification strip (3 icons + "+N") leaves 168px for the name, so "Marcus
                    Papadopoulos" (147px at 14px/600, the longest staff name in the fixtures) fits whole. Any narrower and
                    that staff name truncates. The vehicle rows need less (indent 20 + "Hire WAV (Coastline Rentals)" 193).
                    The extra 3rem from xl is for the ROLE: the line shows the role alone (the region is in the title), and
                    "Senior Support Worker" is 135px at 13px, the longest role in the fixtures, so beside "Mei Zhang" (70px)
                    it needs 135px of the 147px that 368px leaves; 22rem (352px) leaves 131px, four short. Roles beside the
                    fixtures' longer names ("Marcus Papadopoulos") still truncate, with their title. Only from xl, so
                    narrower windows keep the trip columns their room; at exactly 1280px four trips are still 10rem each,
                    and wider windows give the trip columns everything the first column does not take. */}
                <col className="w-44 md:w-80 xl:w-[23rem]" />
                {trips.map((trip: ScheduleTripDto) => <col key={trip.id} />)}
              </colgroup>

              {/* Trip column headers */}
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 top-0 z-20 border-b border-r border-[var(--color-border)] bg-[var(--color-card)] px-[var(--cell-px)] py-1.5 text-left align-middle text-[13px] font-semibold text-[var(--color-muted-foreground)]"
                  >
                    Resources
                  </th>
                  {trips.map((trip: ScheduleTripDto, idx: number) => (
                    <th
                      key={trip.id}
                      scope="col"
                      className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-card)] px-[var(--cell-px)] py-1.5 text-left align-top font-normal"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className={`truncate font-display text-sm font-bold ${tripAccentText[idx % tripAccentText.length]}`} title={trip.tripName}>
                          {trip.tripName}
                        </div>
                        {/* Dates, status, staffing and preference chip share one wrapping line: one row on a wide trip column, stacked on a narrow one. */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-[var(--color-muted-foreground)]">
                          <span className="whitespace-nowrap font-medium">
                            {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
                          </span>
                          <TripStatusBadge status={trip.status} />
                          <span className="whitespace-nowrap">
                            {formatRatio(trip.staffAssignedCount, trip.staffRequired ?? '?')} staff · {formatRatio(trip.currentParticipantCount, trip.maxParticipants ?? '?')} pax
                          </span>
                          {trip.preferenceMatchCount > 0 && (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--color-warning-container)] px-2 py-0.5 text-xs font-semibold text-[var(--color-on-warning-container)]">
                              ★ {trip.preferenceMatchCount} preferred
                            </span>
                          )}
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {/* ── Staff Section Header ── */}
                <tr className="bg-[var(--color-surface-container-low)]">
                  <td
                    colSpan={tripCount + 1}
                    className={`h-[var(--row-h)] cursor-pointer select-none p-0 ${ROW_LINE}`}
                    onClick={() => setSectionStaff(!sectionStaff)}
                  >
                    {/* sticky: the label stays put while the matrix scrolls sideways */}
                    <div className="sticky left-0 flex w-fit items-center gap-2 px-[var(--cell-px)]">
                      {sectionStaff
                        ? <ChevronDown className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                        : <ChevronRight className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                      }
                      <Users className="h-4 w-4 text-[var(--color-primary)]" />
                      <span className="text-[13px] font-semibold text-[var(--color-muted-foreground)]">
                        Staff — {staff?.length || 0}
                      </span>
                    </div>
                  </td>
                </tr>

                {sectionStaff && staff?.map((s: ScheduleStaffDto) => {
                  const expanded = expandedStaff.has(s.id)
                  // The line shows the role alone; the region is secondary, so it lives in the titles (`roleText`) and the
                  // role gets the room the location used to take ("Team Le…" -> "Team Leader").
                  const roleLabel = s.role?.replace(/([A-Z])/g, ' $1').trim() ?? ''
                  const roleText = `${roleLabel}${s.region ? ` · ${s.region}` : ''}`
                  return (
                    <React.Fragment key={s.id}>
                      <tr className={ROW}>
                        <td className={`${STICKY_COL} px-[var(--cell-px)] py-1 align-middle md:py-0 ${ROW_LINE}`}>
                          <div className="flex min-w-0 flex-col gap-0.5 md:flex-row md:items-center md:gap-2">
                            <button
                              type="button"
                              className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left md:flex-1"
                              onClick={() => toggleStaff(s.id)}
                              aria-expanded={expanded}
                              title={roleText ? `${s.fullName} — ${roleText}` : s.fullName}
                            >
                              {expanded
                                ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-muted-foreground)]" />
                                : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-muted-foreground)]" />
                              }
                              {/* Name beats role: the role is flex-1 (flex-basis 0), so it only ever gets what the
                                  name leaves over. With an auto basis it competed for space by shrink ratio and took
                                  18px off "Callum Radford" (84px of 102). The name only truncates, with this title,
                                  once the whole cell is narrower than the name itself. */}
                              <span className="min-w-0 truncate text-sm font-semibold" title={s.fullName}>{s.fullName}</span>
                              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-muted-foreground)]" title={roleText || undefined}>{roleLabel}</span>
                            </button>
                            <QualBadgeList
                              className="max-md:pl-5"
                              items={[
                                { active: s.isDriverEligible, icon: Car, title: 'Driver Eligible' },
                                { active: s.isFirstAidQualified, icon: Shield, title: 'First Aid' },
                                { active: s.isMedicationCompetent, icon: Pill, title: 'Medication' },
                                { active: s.isManualHandlingCompetent, icon: HandMetal, title: 'Manual Handling' },
                                { active: s.isOvernightEligible, icon: Moon, title: 'Overnight' },
                              ]}
                            />
                          </div>
                        </td>
                        {s.tripStatuses?.map((ts: ScheduleStaffTripStatusDto, idx: number) => {
                          const trip = trips[idx]
                          const isAvailable = ts.status === 'Available'
                          const prefEntry = s.preferredForTrips?.find((p: TripPreferenceDto) => p.tripId === ts.tripId)
                          return (
                            <td key={ts.tripId} className={TRIP_CELL}>
                              <div className="flex w-full items-center gap-1">
                                <ScheduleAssignmentCell
                                  status={ts.status}
                                  role={ts.assignmentRole ?? undefined}
                                  clickable={isAvailable && canWrite}
                                  onClick={isAvailable && canWrite ? () => setAssignModal({ type: 'staff', resource: s, trip }) : undefined}
                                  assignLabel={`Assign ${s.fullName} to ${trip.tripName}`}
                                  unassignLabel={`Unassign ${s.fullName} from ${trip.tripName}`}
                                  onUnassign={canWrite && ts.status === 'Assigned' && ts.assignmentId ? () => setUnassigning({
                                    assignmentId: ts.assignmentId!,
                                    staffName: s.fullName,
                                    tripName: trip.tripName,
                                    tripStart: trip.startDate,
                                    tripEnd: trip.endDate,
                                  }) : undefined}
                                />
                                {prefEntry && (
                                  <span
                                    className="inline-flex h-5 shrink-0 items-center rounded-full bg-[var(--color-warning)] px-1.5 text-xs font-bold leading-none text-[var(--color-foreground)]"
                                    title={`${plural(prefEntry.participantCount, 'participant')} prefer this staff member`}
                                  >
                                    ★{prefEntry.participantCount > 1 ? ` ${prefEntry.participantCount}` : ''}
                                  </span>
                                )}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                      {expanded && (
                        <tr key={`${s.id}-detail`} className="bg-[var(--color-surface-container-low)]/40">
                          <td colSpan={tripCount + 1} className={ROW_LINE}>
                            <AvailabilityList staffId={s.id} availability={s.availability} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}

                {/* ── Vehicle Section Header ── */}
                <tr className="bg-[var(--color-surface-container-low)]">
                  <td
                    colSpan={tripCount + 1}
                    className={`h-[var(--row-h)] cursor-pointer select-none p-0 ${ROW_LINE}`}
                    onClick={() => setSectionVehicles(!sectionVehicles)}
                  >
                    <div className="sticky left-0 flex w-fit items-center gap-2 px-[var(--cell-px)]">
                      {sectionVehicles
                        ? <ChevronDown className="h-3.5 w-3.5 text-[var(--color-secondary)]" />
                        : <ChevronRight className="h-3.5 w-3.5 text-[var(--color-secondary)]" />
                      }
                      <Truck className="h-4 w-4 text-[var(--color-secondary)]" />
                      <span className="text-[13px] font-semibold text-[var(--color-muted-foreground)]">
                        Vehicles — {vehicles?.length || 0}
                      </span>
                    </div>
                  </td>
                </tr>

                {sectionVehicles && vehicles?.map((v: ScheduleVehicleDto) => {
                  const vehicleType = v.vehicleType?.replace(/([A-Z])/g, ' $1').trim() ?? ''
                  // Plain-text twin of the meta line below, for its title: the wheelchair count is an icon there.
                  const metaText = `${v.registration || '—'} · ${vehicleType} · ${v.totalSeats} seats${v.wheelchairPositions > 0 ? ` · ${v.wheelchairPositions} wheelchair` : ''}`
                  return (
                    <tr key={v.id} className={ROW}>
                      <td className={`${STICKY_COL} px-[var(--cell-px)] py-1 align-middle md:py-0 ${ROW_LINE}`}>
                        {/* pl-5 lines the name up with staff names, which sit after a 14px chevron + gap. Same priority as a
                            staff row: the meta line is flex-1 (basis 0) from md up, so it yields to the name, not the reverse. */}
                        <div className="flex min-w-0 flex-col pl-5 md:flex-row md:items-center md:gap-2">
                          <span className="min-w-0 truncate text-sm font-semibold" title={v.vehicleName}>{v.vehicleName}</span>
                          <span className="min-w-0 truncate text-[13px] text-[var(--color-muted-foreground)] md:flex-1" title={metaText}>
                            {v.registration || '—'} · {vehicleType} · {v.totalSeats} seats
                            {v.wheelchairPositions > 0 && <> · {v.wheelchairPositions} <span className="material-symbols-outlined align-middle text-[14px] leading-none">accessible</span></>}
                          </span>
                        </div>
                      </td>
                      {v.tripStatuses?.map((ts: ScheduleVehicleTripStatusDto, idx: number) => {
                        const trip = trips[idx]
                        const isAvailable = ts.status === 'Available'
                        return (
                          <td key={ts.tripId} className={TRIP_CELL}>
                            <div className="flex w-full items-center gap-1">
                              <ScheduleAssignmentCell
                                status={ts.status}
                                clickable={isAvailable && canWrite}
                                onClick={isAvailable && canWrite ? () => setAssignModal({ type: 'vehicle', resource: v, trip }) : undefined}
                                assignLabel={`Assign ${v.vehicleName} to ${trip.tripName}`}
                              />
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Assignment Modals ── */}
      {assignModal?.type === 'staff' && (
        <StaffAssignModal
          staff={assignModal.resource as ScheduleStaffDto}
          trip={assignModal.trip}
          onClose={() => setAssignModal(null)}
          onAssign={handleStaffAssign}
          isLoading={staffAssign.isPending}
        />
      )}
      {assignModal?.type === 'vehicle' && (
        <VehicleAssignModal
          vehicle={assignModal.resource as ScheduleVehicleDto}
          trip={assignModal.trip}
          staff={staff || []}
          onClose={() => setAssignModal(null)}
          onAssign={handleVehicleAssign}
          isLoading={vehicleAssign.isPending}
        />
      )}

      <ConfirmDialog
        open={unassigning !== null}
        onCancel={() => setUnassigning(null)}
        onConfirm={() => {
          if (!unassigning) return
          staffUnassign.mutate(unassigning.assignmentId, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: ['schedule-overview'] })
              setUnassigning(null)
            },
          })
        }}
        title="Unassign Staff"
        message={
          unassigning
            ? `Unassign ${unassigning.staffName} from ${unassigning.tripName} (${formatDate(unassigning.tripStart ?? '')} — ${formatDate(unassigning.tripEnd ?? '')})? This cannot be undone.`
            : ''
        }
        confirmLabel="Unassign"
        variant="danger"
        loading={staffUnassign.isPending}
      />
    </div>
  )
}
