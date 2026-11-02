using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Trips;

/// <summary>
/// The trips list's <c>unclaimed</c> filter is what the New claim chooser offers, so it must hold exactly the trips the claim guard
/// (<c>GenerateDraftClaimAsync</c>: refused while any claim on the trip is not Rejected) would let through.
/// </summary>
public class TripsUnclaimedFilterTests
{
    private static Guid SeedTrip(OdipDbContext db, string name, params TripClaimStatus[] claims)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = name, StartDate = new DateOnly(2026, 9, 1), DurationDays = 3, Status = TripStatus.Completed };
        db.TripInstances.Add(trip);
        foreach (var status in claims)
            db.TripClaims.Add(new TripClaim { Id = Guid.NewGuid(), TripInstanceId = trip.Id, Status = status, ClaimReference = "TC-" + Guid.NewGuid().ToString("N")[..8] });
        db.SaveChanges();
        return trip.Id;
    }

    private static async Task<List<string>> Names(OdipDbContext db, bool unclaimed)
    {
        var controller = new TripsController(db, Mock.Of<ILogger<TripsController>>());
        var result = await controller.GetAll(null, null, null, null, null, unclaimed: unclaimed, ct: CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        return Assert.IsType<ApiResponse<PagedResult<TripListDto>>>(ok.Value).Data!.Items.Select(t => t.TripName).OrderBy(n => n).ToList();
    }

    [Fact]
    public async Task Unclaimed_DropsATripWithADraftOrCancelledClaim_AndKeepsOneWhoseOnlyClaimIsRejected()
    {
        using var db = TestDb.Create();
        SeedTrip(db, "No claim");
        SeedTrip(db, "Draft claim", TripClaimStatus.Draft);
        SeedTrip(db, "Cancelled claim", TripClaimStatus.Cancelled);
        SeedTrip(db, "Paid claim", TripClaimStatus.Paid);
        SeedTrip(db, "Rejected only", TripClaimStatus.Rejected);
        SeedTrip(db, "Rejected then redone", TripClaimStatus.Rejected, TripClaimStatus.Submitted);

        Assert.Equal(new[] { "No claim", "Rejected only" }, await Names(db, unclaimed: true));
    }

    [Fact]
    public async Task WithoutTheFilter_EveryTripStillComesBack()
    {
        using var db = TestDb.Create();
        SeedTrip(db, "No claim");
        SeedTrip(db, "Draft claim", TripClaimStatus.Draft);

        Assert.Equal(new[] { "Draft claim", "No claim" }, await Names(db, unclaimed: false));
    }
}
