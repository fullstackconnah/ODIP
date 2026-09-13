using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>
/// Controller-level coverage for ClaimsController.GetClaim, covering the participant-id link
/// added to <see cref="ClaimLineItemDto"/> (the frontend links a claim line item to the
/// participant record, so the id must round-trip alongside the display name).
/// </summary>
public class ClaimsControllerTests
{
    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static ClaimsController CreateController(OdipDbContext db) =>
        new(db, new ClaimGenerationService(db), new BprCsvService(db), new InvoiceService(db));

    [Fact]
    public async Task GetClaim_LineItem_IncludesParticipantId_EqualToSourceBookingsParticipant()
    {
        using var db = CreateDb();
        var tenantId = Guid.NewGuid();

        var participant = new Participant
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            FirstName = "Jane",
            LastName = "Doe",
            NdisNumber = "43100001234",
            PlanType = PlanType.AgencyManaged,
        };
        db.Participants.Add(participant);

        var trip = new TripInstance
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            TripName = "Test Trip",
            StartDate = new DateOnly(2026, 1, 5),
            DurationDays = 1,
        };
        db.TripInstances.Add(trip);

        var booking = new ParticipantBooking
        {
            Id = Guid.NewGuid(),
            TripInstanceId = trip.Id,
            ParticipantId = participant.Id,
            Participant = participant,
            BookingStatus = BookingStatus.Confirmed,
            BookingDate = new DateOnly(2026, 1, 1),
        };
        db.ParticipantBookings.Add(booking);

        var claim = new TripClaim
        {
            Id = Guid.NewGuid(),
            TripInstanceId = trip.Id,
            Status = TripClaimStatus.Draft,
            ClaimReference = "CLM-001",
        };
        db.TripClaims.Add(claim);

        db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(),
            TripClaimId = claim.Id,
            ParticipantBookingId = booking.Id,
            SupportItemCode = "01_002_0117_1_1",
            DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 1, 5),
            SupportsDeliveredTo = new DateOnly(2026, 1, 5),
            Hours = 8m,
            UnitPrice = 60m,
            TotalAmount = 480m,
        });
        db.SaveChanges();

        var controller = CreateController(db);

        var result = await controller.GetClaim(claim.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<TripClaimDetailDto>>(ok.Value);
        var lineItem = Assert.Single(body.Data!.LineItems);
        Assert.Equal(participant.Id, lineItem.ParticipantId);
        Assert.Equal(booking.ParticipantId, lineItem.ParticipantId);
    }
}
