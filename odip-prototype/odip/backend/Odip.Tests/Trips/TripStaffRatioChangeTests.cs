using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Trips;

/// <summary>
/// Changing a participant's support ratio moves the staff a trip needs, so the trips they are booked on are recalculated when
/// the ratio is saved, not at the next booking write. Both write paths that can change it are covered: the full update, and
/// the patch (which the caregiver accept flow also applies through <see cref="ParticipantPatchApplier"/>).
/// </summary>
public class TripStaffRatioChangeTests
{
    private static ParticipantsController Controller(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

    private static Participant Seed(OdipDbContext db, TripStatus tripStatus, SupportRatio? bookingOverride, out TripInstance trip)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true, SupportRatio = SupportRatio.OneToOne };
        trip = new TripInstance
        {
            Id = Guid.NewGuid(), TripName = "Gold Coast Beach Break", StartDate = new DateOnly(2026, 9, 10), DurationDays = 3,
            Status = tripStatus, CalculatedStaffRequired = bookingOverride is null ? 1m : 0.5m,
        };
        db.Participants.Add(participant);
        db.TripInstances.Add(trip);
        db.ParticipantBookings.Add(new ParticipantBooking
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id,
            BookingStatus = BookingStatus.Confirmed, SupportRatioOverride = bookingOverride,
        });
        db.SaveChanges();
        return participant;
    }

    private static Task Patch(OdipDbContext db, Guid id, SupportRatio ratio) =>
        Controller(db).Patch(id, new PatchParticipantDto
        {
            SupportNeedsMobility = new PatchSupportNeedsMobilityDto
            {
                SupportRatio = ratio, OvernightSupport = OvernightSupportType.None, OvernightRatio = SupportRatio.OneToOne,
            },
        }, CancellationToken.None);

    private static async Task<decimal> Calculated(OdipDbContext db, Guid tripId) =>
        (await db.TripInstances.AsNoTracking().SingleAsync(t => t.Id == tripId)).CalculatedStaffRequired;

    [Fact]
    public async Task Patch_ARatioChange_RecalculatesAnUpcomingTrip()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = Seed(db, TripStatus.Confirmed, null, out var trip);

        await Patch(db, p.Id, SupportRatio.TwoToOne);

        Assert.Equal(2m, await Calculated(db, trip.Id));
    }

    [Fact]
    public async Task Update_ARatioChange_RecalculatesAnUpcomingTrip()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = Seed(db, TripStatus.Confirmed, null, out var trip);

        var result = await Controller(db).Update(p.Id, new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = PlanType.SelfManaged, IsActive = true,
            OvernightSupport = OvernightSupportType.None, OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.TwoToOne,
        }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(2m, await Calculated(db, trip.Id));
    }

    [Theory]
    [InlineData(TripStatus.Completed)]
    [InlineData(TripStatus.Cancelled)]
    public async Task Patch_ARatioChange_LeavesACompletedOrCancelledTripAlone(TripStatus status)
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = Seed(db, status, null, out var trip);

        await Patch(db, p.Id, SupportRatio.TwoToOne);

        Assert.Equal(1m, await Calculated(db, trip.Id));
    }

    [Fact]
    public async Task Patch_ARatioChange_DoesNotAffectABookingWithAnOverride()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = Seed(db, TripStatus.Confirmed, SupportRatio.OneToTwo, out var trip);

        await Patch(db, p.Id, SupportRatio.TwoToOne);

        Assert.Equal(0.5m, await Calculated(db, trip.Id));
    }
}
