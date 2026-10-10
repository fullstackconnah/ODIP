using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>The one calculation of <see cref="TripInstance.CalculatedStaffRequired"/>, run by every write that can change it. It tracks the change; the caller saves.</summary>
public static class TripStaffing
{
    private static readonly Dictionary<SupportRatio, decimal> RatioToStaff = new()
    {
        { SupportRatio.OneToOne, 1m }, { SupportRatio.OneToTwo, 0.5m }, { SupportRatio.OneToThree, 1m / 3m },
        { SupportRatio.OneToFour, 0.25m }, { SupportRatio.OneToFive, 0.2m }, { SupportRatio.TwoToOne, 2m },
        { SupportRatio.SharedSupport, 0.25m }, { SupportRatio.Other, 1m }
    };

    public static async Task RecalculateAsync(OdipDbContext db, Guid tripId, CancellationToken ct)
    {
        var trip = await db.TripInstances
            .Include(t => t.Bookings)
            .ThenInclude(b => b.Participant)
            .FirstOrDefaultAsync(t => t.Id == tripId, ct);
        if (trip == null) return;

        var activeBookings = trip.Bookings.Where(b =>
            b.BookingStatus != BookingStatus.Cancelled && b.BookingStatus != BookingStatus.NoLongerAttending);

        var rawTotal = activeBookings.Sum(b =>
        {
            var ratio = b.SupportRatioOverride ?? b.Participant?.SupportRatio ?? SupportRatio.OneToOne;
            return RatioToStaff.TryGetValue(ratio, out var v) ? v : 1m;
        });

        trip.CalculatedStaffRequired = rawTotal;
        trip.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>After a participant's ratio changes: recalculates the trips they are actively booked on. Completed, cancelled and archived trips are history.</summary>
    public static async Task RecalculateForParticipantAsync(OdipDbContext db, Guid participantId, CancellationToken ct)
    {
        var tripIds = await db.ParticipantBookings
            .Where(b => b.ParticipantId == participantId
                && b.BookingStatus != BookingStatus.Cancelled && b.BookingStatus != BookingStatus.NoLongerAttending
                && b.TripInstance.Status != TripStatus.Completed && b.TripInstance.Status != TripStatus.Cancelled && b.TripInstance.Status != TripStatus.Archived)
            .Select(b => b.TripInstanceId).Distinct().ToListAsync(ct);
        foreach (var tripId in tripIds) await RecalculateAsync(db, tripId, ct);
    }
}
