using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/schedule")]
public class ScheduleController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly IStaffUnavailabilityQuery _unavailabilityQuery;
    private readonly IStaffAvailabilityItemsQuery _availabilityItemsQuery;
    // The request's clock: a test fixes it. Every calendar rule uses the PROVIDER's date from it (ProviderTimeZoneResolver.TodayAsync), never the UTC date.
    private readonly TimeProvider _clock;

    public ScheduleController(
        OdipDbContext db, IStaffUnavailabilityQuery unavailabilityQuery, IStaffAvailabilityItemsQuery availabilityItemsQuery, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
        _unavailabilityQuery = unavailabilityQuery;
        _availabilityItemsQuery = availabilityItemsQuery;
    }

    /// <summary>
    /// Returns a scheduling overview: all trips with staff/vehicle availability matrix.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<ScheduleOverviewDto>>> GetScheduleOverview(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        // Default window: 3 months back to 12 months forward
        var windowStart = from ?? DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(-3));
        var windowEnd = to ?? DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(12));

        // ── 1. Load trips in window ──
        var trips = await _db.TripInstances
            .Include(t => t.LeadCoordinator)
            .Include(t => t.Bookings)
            .Include(t => t.StaffAssignments)
            .Include(t => t.VehicleAssignments)
            .Where(t => t.Status != TripStatus.Cancelled && t.Status != TripStatus.Archived && t.Status != TripStatus.Completed)
            .Where(t => t.StartDate <= windowEnd && t.StartDate.AddDays(t.DurationDays - 1) >= windowStart)
            .OrderBy(t => t.StartDate)
            .ToListAsync(ct);

        if (trips.Count == 0)
        {
            return Ok(ApiResponse<ScheduleOverviewDto>.Ok(new ScheduleOverviewDto
            {
                Trips = trips.Select(t => new ScheduleTripDto
                {
                    Id = t.Id,
                    TripName = t.TripName,
                    TripCode = t.TripCode,
                    Destination = t.Destination,
                    Region = t.Region,
                    StartDate = t.StartDate,
                    EndDate = t.StartDate.AddDays(t.DurationDays - 1),
                    DurationDays = t.DurationDays,
                    Status = t.Status,
                    MaxParticipants = t.MaxParticipants,
                    CurrentParticipantCount = t.Bookings.Count(b =>
                        b.BookingStatus != BookingStatus.Cancelled && b.BookingStatus != BookingStatus.NoLongerAttending),
                    MinStaffRequired = t.MinStaffRequired,
                    StaffRequired = t.CalculatedStaffRequired > 0
                        ? (int)Math.Ceiling(t.CalculatedStaffRequired)
                        : t.MinStaffRequired,
                    StaffAssignedCount = t.StaffAssignments.Count(a => a.Status != AssignmentStatus.Cancelled),
                    VehicleAssignedCount = t.VehicleAssignments.Count(a =>
                        a.Status != VehicleAssignmentStatus.Cancelled && a.Status != VehicleAssignmentStatus.Unavailable),
                    LeadCoordinatorName = t.LeadCoordinator != null
                        ? t.LeadCoordinator.FirstName + " " + t.LeadCoordinator.LastName : null,
                }).ToList(),
                Staff = new(), Vehicles = new()
            }));
        }

        // ── 1b. Compute staff preference counts ──
        var tripIds = trips.Select(t => t.Id).ToList();
        var preferenceRows = await (
            from b in _db.ParticipantBookings
            join p in _db.Participants on b.ParticipantId equals p.Id
            where tripIds.Contains(b.TripInstanceId)
               && (b.BookingStatus == BookingStatus.Confirmed
                   || b.BookingStatus == BookingStatus.Held)
               && p.PreferredUserId != null
            select new { b.TripInstanceId, StaffId = p.PreferredUserId!.Value }
        ).ToListAsync(ct);

        // prefsByStaff[staffId][tripId] = count
        var prefsByStaff = preferenceRows
            .GroupBy(p => p.StaffId)
            .ToDictionary(
                g => g.Key,
                g => g.GroupBy(x => x.TripInstanceId)
                      .ToDictionary(t => t.Key, t => t.Count())
            );

        // prefsByTrip[tripId] = total preference matches
        var prefsByTrip = preferenceRows
            .GroupBy(p => p.TripInstanceId)
            .ToDictionary(g => g.Key, g => g.Count());

        var tripDtos = trips.Select(t => new ScheduleTripDto
        {
            Id = t.Id,
            TripName = t.TripName,
            TripCode = t.TripCode,
            Destination = t.Destination,
            Region = t.Region,
            StartDate = t.StartDate,
            EndDate = t.StartDate.AddDays(t.DurationDays - 1),
            DurationDays = t.DurationDays,
            Status = t.Status,
            MaxParticipants = t.MaxParticipants,
            CurrentParticipantCount = t.Bookings.Count(b =>
                b.BookingStatus != BookingStatus.Cancelled && b.BookingStatus != BookingStatus.NoLongerAttending),
            MinStaffRequired = t.MinStaffRequired,
            StaffRequired = t.CalculatedStaffRequired > 0
                ? (int)Math.Ceiling(t.CalculatedStaffRequired)
                : t.MinStaffRequired,
            StaffAssignedCount = t.StaffAssignments.Count(a => a.Status != AssignmentStatus.Cancelled),
            VehicleAssignedCount = t.VehicleAssignments.Count(a =>
                a.Status != VehicleAssignmentStatus.Cancelled && a.Status != VehicleAssignmentStatus.Unavailable),
            LeadCoordinatorName = t.LeadCoordinator != null
                ? t.LeadCoordinator.FirstName + " " + t.LeadCoordinator.LastName : null,
            PreferenceMatchCount = prefsByTrip.GetValueOrDefault(t.Id, 0),
        }).ToList();

        // ── 2. Load all active staff with assignments & availability ──
        // Design spec §4.2: every active tenant user, of any role — no role filter (matches the
        // same removal in RosteringController.GetBoard).
        var allStaff = await _db.Users
            .Where(s => s.IsActive)
            .OrderBy(s => s.LastName).ThenBy(s => s.FirstName)
            .ToListAsync(ct);

        var staffIds = allStaff.Select(s => s.Id).ToList();

        var staffAssignments = await _db.StaffAssignments
            .Where(a => staffIds.Contains(a.UserId) && a.Status != AssignmentStatus.Cancelled)
            .ToListAsync(ct);

        // Unavailability windows (approved leave, approved recurring rules, legacy StaffAvailability
        // Unavailable/Training rows) via the shared IStaffUnavailabilityQuery — see
        // docs/specs/2026-09-07-staff-leave-unavailability-design.md §3/§4. These drive the
        // per-trip status cells below; ScheduleStaffDto.Availability is built separately, from the
        // raw LeaveRequest/RecurringUnavailability/StaffAvailability records (not these expanded
        // windows) — see IStaffAvailabilityItemsQuery below.
        var overallStartDate = trips.Min(t => t.StartDate);
        var overallEndDate = trips.Max(t => t.StartDate.AddDays(t.DurationDays - 1));
        var unavailabilityWindows = await _unavailabilityQuery.GetWindowsAsync(staffIds, overallStartDate, overallEndDate, ct);

        // Raw records backing ScheduleStaffDto.Availability, filtered to the same overall window
        // and to Pending/Approved status (Declined/Cancelled rows are never shown) — shared with
        // the staff hub's overview endpoint (item 12) via IStaffAvailabilityItemsQuery.
        var availabilityItemsByStaff = await _availabilityItemsQuery.GetAsync(staffIds, overallStartDate, overallEndDate, ct);

        // Grouped once up front instead of a linear Where(...) scan per staff row inside the
        // allStaff.Select below — an ILookup returns an empty sequence for a missing key, so no
        // null check is needed at either call site.
        var assignmentsByStaff = staffAssignments.ToLookup(a => a.UserId);
        var windowsByStaff = unavailabilityWindows.ToLookup(w => w.UserId);

        var staffDtos = allStaff.Select(s =>
        {
            var myAssignments = assignmentsByStaff[s.Id].ToList();
            var myWindows = windowsByStaff[s.Id].ToList();

            var tripStatuses = trips.Select(t =>
            {
                var tripStart = t.StartDate;
                var tripEnd = t.StartDate.AddDays(t.DurationDays - 1);

                // Check if assigned to THIS trip
                var assignedToThis = myAssignments.FirstOrDefault(a => a.TripInstanceId == t.Id);
                if (assignedToThis != null)
                {
                    return new ScheduleStaffTripStatusDto
                    {
                        TripId = t.Id,
                        Status = "Assigned",
                        AssignmentRole = assignedToThis.AssignmentRole,
                        AssignmentStatus = assignedToThis.Status,
                        AssignmentId = assignedToThis.Id,
                    };
                }

                // Check if assigned to ANOTHER overlapping trip
                var conflicting = myAssignments.Any(a =>
                    a.TripInstanceId != t.Id
                    && a.AssignmentStart <= tripEnd && a.AssignmentEnd >= tripStart);
                if (conflicting)
                {
                    return new ScheduleStaffTripStatusDto
                    {
                        TripId = t.Id, Status = "Conflict"
                    };
                }

                // Unavailability windows (approved leave, approved recurring rules, legacy
                // StaffAvailability Unavailable/Training rows) via the shared
                // IStaffUnavailabilityQuery — see docs/specs/2026-09-07-staff-leave-unavailability-design.md §4.
                var tripStartDt = tripStart.ToDateTime(TimeOnly.MinValue);
                var tripEndDt = tripEnd.ToDateTime(TimeOnly.MaxValue);
                var unavailable = myWindows.Any(w =>
                    (w.Kind == UnavailabilityKind.ApprovedLeave || w.Kind == UnavailabilityKind.RecurringRule || w.Kind == UnavailabilityKind.Legacy)
                    && w.Start < tripEndDt && tripStartDt < w.End);
                if (unavailable)
                {
                    return new ScheduleStaffTripStatusDto
                    {
                        TripId = t.Id, Status = "Unavailable"
                    };
                }

                // Pending leave (and, per the 2026-09-09 audit ruling, a pending recurring rule)
                // is a softer signal than an approved one — the coordinator can still assign, but
                // the cell shows Tentative rather than Available so the risk is visible up front.
                // StaffUnavailabilityQuery now expands Pending RecurringUnavailability rules too,
                // tagged PendingRecurringRule rather than RecurringRule specifically so they land
                // here instead of the "Unavailable" branch above.
                var pendingLeave = myWindows.Any(w =>
                    (w.Kind == UnavailabilityKind.PendingLeave || w.Kind == UnavailabilityKind.PendingRecurringRule)
                    && w.Start < tripEndDt && tripStartDt < w.End);
                if (pendingLeave)
                {
                    return new ScheduleStaffTripStatusDto
                    {
                        TripId = t.Id, Status = "Tentative"
                    };
                }

                return new ScheduleStaffTripStatusDto
                {
                    TripId = t.Id, Status = "Available"
                };
            }).ToList();

            return new ScheduleStaffDto
            {
                Id = s.Id,
                FirstName = s.FirstName,
                LastName = s.LastName,
                FullName = s.FirstName + " " + s.LastName,
                Role = s.Position ?? Position.SupportWorker,
                Region = s.Region,
                IsDriverEligible = s.IsDriverEligible,
                IsFirstAidQualified = s.IsFirstAidQualified,
                IsMedicationCompetent = s.IsMedicationCompetent,
                IsManualHandlingCompetent = s.IsManualHandlingCompetent,
                IsOvernightEligible = s.IsOvernightEligible,
                TripStatuses = tripStatuses,
                Availability = availabilityItemsByStaff[s.Id].ToList(),
                PreferredForTrips = prefsByStaff.TryGetValue(s.Id, out var staffPrefs)
                    ? staffPrefs.Select(kv => new TripPreferenceDto(kv.Key, kv.Value)).ToList()
                    : new List<TripPreferenceDto>(),
            };
        }).ToList();

        // ── 3. Load all active vehicles with assignments ──
        var allVehicles = await _db.Vehicles
            .Where(v => v.IsActive)
            .OrderBy(v => v.VehicleName)
            .ToListAsync(ct);

        var vehicleIds = allVehicles.Select(v => v.Id).ToList();

        var vehicleAssignments = await _db.VehicleAssignments
            .Include(a => a.TripInstance)
            .Where(a => vehicleIds.Contains(a.VehicleId)
                && a.Status != VehicleAssignmentStatus.Cancelled
                && a.Status != VehicleAssignmentStatus.Unavailable)
            .ToListAsync(ct);

        var vehicleDtos = allVehicles.Select(v =>
        {
            var myAssignments = vehicleAssignments.Where(a => a.VehicleId == v.Id).ToList();

            var tripStatuses = trips.Select(t =>
            {
                var tripStart = t.StartDate;
                var tripEnd = t.StartDate.AddDays(t.DurationDays - 1);

                var assignedToThis = myAssignments.FirstOrDefault(a => a.TripInstanceId == t.Id);
                if (assignedToThis != null)
                {
                    return new ScheduleVehicleTripStatusDto
                    {
                        TripId = t.Id, Status = "Assigned",
                        AssignmentStatus = assignedToThis.Status
                    };
                }

                var conflicting = myAssignments.Any(a =>
                    a.TripInstanceId != t.Id
                    && a.TripInstance.StartDate <= tripEnd
                    && a.TripInstance.StartDate.AddDays(a.TripInstance.DurationDays - 1) >= tripStart);
                if (conflicting)
                {
                    return new ScheduleVehicleTripStatusDto
                    {
                        TripId = t.Id, Status = "Conflict"
                    };
                }

                return new ScheduleVehicleTripStatusDto
                {
                    TripId = t.Id, Status = "Available"
                };
            }).ToList();

            return new ScheduleVehicleDto
            {
                Id = v.Id,
                VehicleName = v.VehicleName,
                Registration = v.Registration,
                VehicleType = v.VehicleType,
                TotalSeats = v.TotalSeats,
                WheelchairPositions = v.WheelchairPositions,
                IsInternal = v.IsInternal,
                TripStatuses = tripStatuses
            };
        }).ToList();

        var result = new ScheduleOverviewDto
        {
            Trips = tripDtos,
            Staff = staffDtos,
            Vehicles = vehicleDtos
        };

        return Ok(ApiResponse<ScheduleOverviewDto>.Ok(result));
    }
}
