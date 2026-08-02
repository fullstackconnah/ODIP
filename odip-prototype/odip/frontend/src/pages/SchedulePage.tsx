import React, { useState } from 'react'
import {
  CalendarRange, Users, Truck, ChevronDown, ChevronRight,
  Car, Shield, Pill, HandMetal, Moon,
  Filter, Download, CheckCircle, AlertTriangle
} from 'lucide-react'
import {
  useScheduleOverview, useCreateStaffAssignment, useCreateVehicleAssignment, useDeleteStaffAssignment,
} from '../api/hooks'
import { useQueryClient } from '@tanstack/react-query'
import { usePermissions } from '@/lib/permissions'
import {
  StatusBadge, QualBadge, TripStatusBadge, AvailabilityEditor,
  StaffAssignModal, VehicleAssignModal,
  formatDate, tripAccentText,
} from './schedule'
import type {
  ScheduleTripDto, ScheduleStaffDto, ScheduleVehicleDto,
  ScheduleStaffTripStatusDto, ScheduleVehicleTripStatusDto,
  TripPreferenceDto,
  CreateStaffAssignmentDto, CreateVehicleAssignmentDto,
} from '@/api/types'

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

  const handleStaffAssign = (assignData: CreateStaffAssignmentDto) => {
    staffAssign.mutate(assignData, {
      onSuccess: () => {
        setAssignModal(null)
        queryClient.invalidateQueries({ queryKey: ['schedule-overview'] })
      },
    })
  }

  const handleVehicleAssign = (assignData: CreateVehicleAssignmentDto) => {
    vehicleAssign.mutate(assignData, {
      onSuccess: () => {
        setAssignModal(null)
        queryClient.invalidateQueries({ queryKey: ['schedule-overview'] })
      },
    })
  }

  const toggleStaff = (id: string) => {
    setExpandedStaff(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
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
      <div className="bg-white rounded-[2rem] p-8 text-center">
        <p className="text-[var(--color-muted-foreground)]">Failed to load schedule overview.</p>
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
    <div className="space-y-4">
      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 md:gap-4">
        <div>
          <h1 className="font-display font-extrabold text-2xl md:text-3xl text-[var(--color-primary)] tracking-tight leading-none mb-1">
            Schedule Overview
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)] font-medium">
            Staff and vehicle assignment across active trips · Click{' '}
            <span className="font-semibold text-[var(--color-primary)]">Available</span> to assign
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-[var(--color-surface-container)] p-1 rounded-full">
            <button className="px-5 py-2 bg-white rounded-full text-sm font-bold shadow-sm text-[var(--color-foreground)]">
              Grid View
            </button>
            <button className="px-5 py-2 text-[var(--color-muted-foreground)] text-sm font-medium hover:text-[var(--color-foreground)] transition-colors">
              Timeline
            </button>
          </div>
          <button className="p-2.5 bg-[var(--color-surface-container-low)] rounded-full hover:bg-[var(--color-surface-container)] transition-colors text-[var(--color-muted-foreground)]">
            <Filter className="w-4 h-4" />
          </button>
          <button className="p-2.5 bg-[var(--color-surface-container-low)] rounded-full hover:bg-[var(--color-surface-container)] transition-colors text-[var(--color-muted-foreground)]">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-12 gap-3 md:gap-4">
        {/* Active Trips count */}
        <div className="col-span-12 md:col-span-4 bg-[var(--color-primary-container)] p-4 md:p-5 rounded-2xl md:rounded-[1.5rem] text-white flex flex-col justify-between relative overflow-hidden group">
          <div className="relative z-10">
            <h3 className="text-xs font-bold uppercase tracking-widest opacity-75 mb-2">Active Trips</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-display font-extrabold leading-none">{tripCount}</span>
              <span className="text-base opacity-70">Trips</span>
            </div>
          </div>
          <div className="mt-3 flex gap-2 flex-wrap relative z-10">
            <span className="bg-white/20 px-3 py-1 rounded-full text-xs font-bold">{staff?.length || 0} Staff</span>
            <span className="bg-white/20 px-3 py-1 rounded-full text-xs font-bold">{vehicles?.length || 0} Vehicles</span>
          </div>
          <div className="absolute -right-8 -bottom-8 w-40 h-40 bg-white/10 rounded-full blur-2xl group-hover:bg-white/15 transition-colors" />
        </div>

        {/* Resource Health */}
        <div className="col-span-12 md:col-span-8 bg-[var(--color-surface-container-low)] p-4 md:p-5 rounded-2xl md:rounded-[1.5rem] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <h3 className="text-base font-display font-bold text-[var(--color-secondary)]">Resource Health</h3>
            <span className="text-[var(--color-primary)] font-bold text-sm">{utilization}% Utilization</span>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="bg-white p-3 rounded-[0.75rem]">
              <p className="text-xs text-[var(--color-muted-foreground)] font-bold uppercase mb-1 tracking-wide">Staff</p>
              <div className="flex justify-between items-center">
                <span className="text-xl font-bold text-[var(--color-foreground)]">{staffAssigned}/{staff?.length || 0}</span>
                <CheckCircle className="w-4 h-4 text-[var(--color-primary)]" />
              </div>
            </div>
            <div className="bg-white p-3 rounded-[0.75rem]">
              <p className="text-xs text-[var(--color-muted-foreground)] font-bold uppercase mb-1 tracking-wide">Vehicles</p>
              <div className="flex justify-between items-center">
                <span className="text-xl font-bold text-[var(--color-foreground)]">{vehiclesAssigned}/{vehicles?.length || 0}</span>
                <CheckCircle className="w-4 h-4 text-[var(--color-primary)]" />
              </div>
            </div>
            <div className="bg-white p-3 rounded-[0.75rem]">
              <p className="text-xs text-[var(--color-muted-foreground)] font-bold uppercase mb-1 tracking-wide">Conflicts</p>
              <div className="flex justify-between items-center">
                <span className={`text-xl font-bold ${conflictsCount > 0 ? 'text-[#ba1a1a]' : 'text-[var(--color-foreground)]'}`}>
                  {String(conflictsCount).padStart(2, '0')}
                </span>
                {conflictsCount > 0
                  ? <AlertTriangle className="w-4 h-4 text-[#ba1a1a]" />
                  : <CheckCircle className="w-4 h-4 text-[var(--color-primary)]" />
                }
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Empty State ── */}
      {tripCount === 0 ? (
        <div className="bg-white rounded-[2rem] p-12 text-center">
          <CalendarRange className="w-12 h-12 text-[var(--color-muted-foreground)] mx-auto mb-4 opacity-40" />
          <p className="text-lg font-display font-bold">No trips scheduled</p>
          <p className="text-[var(--color-muted-foreground)] mt-1">Create a trip first to see the schedule overview.</p>
        </div>
      ) : (
        /* ── Schedule Grid Table ── */
        <div className="bg-white rounded-2xl md:rounded-[2rem] overflow-hidden">
          <p className="md:hidden text-xs text-[var(--color-muted-foreground)] px-4 pt-3 pb-1">Swipe to see all trips →</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: `${220 + tripCount * 160}px` }}>
              {/* Trip column headers */}
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-surface-container)' }}>
                  <th className="sticky left-0 z-20 bg-white text-left px-4 py-3 min-w-[200px]">
                    <span className="text-[10px] font-bold text-[var(--color-muted-foreground)] uppercase tracking-widest">Resources</span>
                  </th>
                  {trips.map((trip: ScheduleTripDto, idx: number) => (
                    <th key={trip.id} className="px-4 py-3 text-left min-w-[150px]">
                      <div className="space-y-1">
                        <div className={`text-sm font-display font-bold ${tripAccentText[idx % tripAccentText.length]}`}>
                          {trip.tripName}
                        </div>
                        <div className="text-xs font-medium text-[var(--color-muted-foreground)]">
                          {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
                        </div>
                        <TripStatusBadge status={trip.status} />
                        <div className="text-[10px] text-[var(--color-muted-foreground)]">
                          {trip.staffAssignedCount}/{trip.staffRequired ?? '?'} staff · {trip.currentParticipantCount}/{trip.maxParticipants ?? '?'} pax
                        </div>
                        {trip.preferenceMatchCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: '#fef3c7', color: '#b45309' }}>
                            ★ {trip.preferenceMatchCount} preferred
                          </span>
                        )}
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
                    className="px-6 py-3 cursor-pointer select-none"
                    onClick={() => setSectionStaff(!sectionStaff)}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[var(--color-primary-fixed)]/30 flex items-center justify-center">
                        {sectionStaff
                          ? <ChevronDown className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                          : <ChevronRight className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                        }
                      </div>
                      <Users className="w-4 h-4 text-[var(--color-primary)]" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted-foreground)]">
                        Staff — {staff?.length || 0}
                      </span>
                    </div>
                  </td>
                </tr>

                {sectionStaff && staff?.map((s: ScheduleStaffDto) => (
                  <React.Fragment key={s.id}>
                    <tr
                      className="hover:bg-[var(--color-surface-container-low)]/60 transition-colors"
                      style={{ borderBottom: '1px solid var(--color-surface-container)' }}
                    >
                      <td className="sticky left-0 z-10 bg-white px-4 py-2.5 min-w-[200px]">
                        <div
                          className="flex items-center gap-2 cursor-pointer"
                          onClick={() => toggleStaff(s.id)}
                        >
                          <div className="w-7 h-7 rounded-full bg-[var(--color-secondary-container)]/60 flex items-center justify-center flex-shrink-0">
                            <Users className="w-3.5 h-3.5 text-[var(--color-secondary)]" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              {expandedStaff.has(s.id)
                                ? <ChevronDown className="w-3 h-3 text-[var(--color-muted-foreground)] flex-shrink-0" />
                                : <ChevronRight className="w-3 h-3 text-[var(--color-muted-foreground)] flex-shrink-0" />
                              }
                              <span className="text-xs font-bold truncate">{s.fullName}</span>
                            </div>
                            <div className="text-[10px] text-[var(--color-muted-foreground)] pl-4">
                              {s.role?.replace(/([A-Z])/g, ' $1').trim()}{s.region ? ` · ${s.region}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 mt-1 pl-9">
                          <QualBadge active={s.isDriverEligible} icon={Car} title="Driver Eligible" />
                          <QualBadge active={s.isFirstAidQualified} icon={Shield} title="First Aid" />
                          <QualBadge active={s.isMedicationCompetent} icon={Pill} title="Medication" />
                          <QualBadge active={s.isManualHandlingCompetent} icon={HandMetal} title="Manual Handling" />
                          <QualBadge active={s.isOvernightEligible} icon={Moon} title="Overnight" />
                        </div>
                      </td>
                      {s.tripStatuses?.map((ts: ScheduleStaffTripStatusDto, idx: number) => {
                        const trip = trips[idx]
                        const isAvailable = ts.status === 'Available'
                        const prefEntry = s.preferredForTrips?.find((p: TripPreferenceDto) => p.tripId === ts.tripId)
                        return (
                          <td key={ts.tripId} className="px-3 py-2.5">
                            <div className="relative inline-block">
                              <StatusBadge
                                status={ts.status}
                                role={ts.assignmentRole ?? undefined}
                                clickable={isAvailable && canWrite}
                                onClick={isAvailable && canWrite ? () => setAssignModal({ type: 'staff', resource: s, trip }) : undefined}
                                onUnassign={canWrite && ts.status === 'Assigned' && ts.assignmentId ? () => staffUnassign.mutate(ts.assignmentId!, {
                                  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule-overview'] })
                                }) : undefined}
                              />
                              {prefEntry && (
                                <span
                                  className="absolute -top-1.5 -right-1.5 text-[9px] font-bold leading-none px-1 py-0.5 rounded-full"
                                  style={{ background: '#f59e0b', color: '#000' }}
                                  title={`${prefEntry.participantCount} participant${prefEntry.participantCount > 1 ? 's' : ''} prefer this staff member`}
                                >
                                  ★{prefEntry.participantCount > 1 ? ` ${prefEntry.participantCount}` : ''}
                                </span>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                    {expandedStaff.has(s.id) && (
                      <tr
                        key={`${s.id}-detail`}
                        style={{ borderBottom: '1px solid var(--color-surface-container)' }}
                        className="bg-[var(--color-surface-container-low)]/40"
                      >
                        <td colSpan={tripCount + 1}>
                          <AvailabilityEditor staffId={s.id} availability={s.availability} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}

                {/* ── Vehicle Section Header ── */}
                <tr className="bg-[var(--color-surface-container-low)]">
                  <td
                    colSpan={tripCount + 1}
                    className="px-6 py-3 cursor-pointer select-none"
                    onClick={() => setSectionVehicles(!sectionVehicles)}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[var(--color-secondary-container)]/60 flex items-center justify-center">
                        {sectionVehicles
                          ? <ChevronDown className="w-3.5 h-3.5 text-[var(--color-secondary)]" />
                          : <ChevronRight className="w-3.5 h-3.5 text-[var(--color-secondary)]" />
                        }
                      </div>
                      <Truck className="w-4 h-4 text-[var(--color-secondary)]" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted-foreground)]">
                        Vehicles — {vehicles?.length || 0}
                      </span>
                    </div>
                  </td>
                </tr>

                {sectionVehicles && vehicles?.map((v: ScheduleVehicleDto) => (
                  <tr
                    key={v.id}
                    className="hover:bg-[var(--color-surface-container-low)]/60 transition-colors last:border-b-0"
                    style={{ borderBottom: '1px solid var(--color-surface-container)' }}
                  >
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[var(--color-secondary-container)]/40 flex items-center justify-center flex-shrink-0">
                          <Truck className="w-3.5 h-3.5 text-[var(--color-secondary)]" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold truncate">{v.vehicleName}</div>
                          <div className="text-[10px] text-[var(--color-muted-foreground)]">
                            {v.registration || '—'} · {v.vehicleType?.replace(/([A-Z])/g, ' $1').trim()} · {v.totalSeats} seats
                            {v.wheelchairPositions > 0 && <> · {v.wheelchairPositions} <span className="material-symbols-outlined text-[10px] leading-none align-middle">accessible</span></>}
                          </div>
                        </div>
                      </div>
                    </td>
                    {v.tripStatuses?.map((ts: ScheduleVehicleTripStatusDto, idx: number) => {
                      const trip = trips[idx]
                      const isAvailable = ts.status === 'Available'
                      return (
                        <td key={ts.tripId} className="px-3 py-2.5">
                          <StatusBadge
                            status={ts.status}
                            clickable={isAvailable && canWrite}
                            onClick={isAvailable && canWrite ? () => setAssignModal({ type: 'vehicle', resource: v, trip }) : undefined}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
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
    </div>
  )
}
