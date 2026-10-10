using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>
/// H8: TripClaim is deliberately not an ITenantEntity, so a claim reached by its id alone belonged to whoever held the id. Every claim read and write now goes through the
/// caller's own trips and participants (both tenant-filtered), and a claim of another organisation is "not found". The caller is a tenant-scoped Admin of organisation A and
/// every "another tenant" claim below belongs to organisation B.
/// </summary>
public class ClaimsTenantScopeTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();

    private static (OdipDbContext Db, ClaimsController Controller) Create(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        var db = new OdipDbContext(options, tenant.Object);
        var controller = new ClaimsController(db, new ClaimGenerationService(db), new ShiftClaimGenerationService(db), new BprCsvService(db), new InvoiceService(db),
            new BudgetLedgerService(db, TimeProvider.System), tenant.Object);
        return (db, controller);
    }

    private sealed record Owned(TripInstance Trip, ParticipantBooking Booking, TripClaim TripClaim, ClaimLineItem TripLine, TripClaim ShiftClaim, ClaimLineItem ShiftLine);

    /// <summary>One trip claim (a booking line) and one shift claim (a shift line), both owned by <paramref name="tenantId"/>.</summary>
    private static Owned Seed(OdipDbContext db, Guid tenantId)
    {
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Lee", NdisNumber = "43188882222", PlanType = PlanType.SelfManaged };
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Trip", StartDate = new DateOnly(2026, 2, 1), DurationDays = 1 };
        var booking = new ParticipantBooking
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed,
            BookingDate = new DateOnly(2026, 1, 1), ClaimStatus = ClaimStatus.InClaim,
        };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, ServiceDate = new DateOnly(2026, 9, 7), StartTime = new TimeOnly(9, 0),
            EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
        };
        var tripClaim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = trip.Id, Status = TripClaimStatus.Draft, ClaimReference = "TC-TRIP", TotalAmount = 480m };
        var shiftClaim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id, Status = TripClaimStatus.Draft, ClaimReference = "TC-SHIFT", TotalAmount = 320m };
        var tripLine = new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = tripClaim.Id, ParticipantBookingId = booking.Id, SupportItemCode = "01_002_0117_1_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 2, 1), SupportsDeliveredTo = new DateOnly(2026, 2, 1), Hours = 8m, UnitPrice = 60m, TotalAmount = 480m,
        };
        var shiftLine = new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = shiftClaim.Id, ShiftId = shift.Id, SupportItemCode = "04_WD", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 9, 7), SupportsDeliveredTo = new DateOnly(2026, 9, 7), Hours = 8m, UnitPrice = 40m, TotalAmount = 320m,
        };
        db.AddRange(participant, trip, booking, shift, tripClaim, shiftClaim, tripLine, shiftLine);
        db.SaveChanges();
        return new Owned(trip, booking, tripClaim, tripLine, shiftClaim, shiftLine);
    }

    [Fact]
    public async Task GetClaimsForTrip_TripOfAnotherTenant_ReturnsNotFound()
    {
        var (db, controller) = Create(TenantA);
        var b = Seed(db, TenantB);

        Assert.IsType<NotFoundObjectResult>((await controller.GetClaimsForTrip(b.Trip.Id, CancellationToken.None)).Result);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task GetClaim_ClaimOfAnotherTenant_ReturnsNotFound(bool shiftClaim)
    {
        var (db, controller) = Create(TenantA);
        var b = Seed(db, TenantB);

        var result = await controller.GetClaim((shiftClaim ? b.ShiftClaim : b.TripClaim).Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task UpdateClaim_ClaimOfAnotherTenant_ReturnsNotFound_AndChangesNothing(bool shiftClaim)
    {
        var (db, controller) = Create(TenantA);
        var b = Seed(db, TenantB);
        var claim = shiftClaim ? b.ShiftClaim : b.TripClaim;

        var result = await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted, Notes = "hijacked" }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var stored = await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id);
        Assert.Equal(TripClaimStatus.Draft, stored.Status);
        Assert.Null(stored.Notes);
    }

    [Fact]
    public async Task UpdateClaim_AuthorisedByStaffOfAnotherTenant_ReturnsBadRequest_AndStoresNothing()
    {
        var (db, controller) = Create(TenantA);
        var a = Seed(db, TenantA);
        var foreignStaff = Odip.Tests.Security.CrossTenant.User(db, TenantB);

        var result = await controller.UpdateClaim(a.TripClaim.Id, new UpdateClaimDto { AuthorisedByStaffId = foreignStaff.Id, Notes = "checked" }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        var stored = await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == a.TripClaim.Id);
        Assert.Null(stored.AuthorisedByUserId);
        Assert.Null(stored.Notes);
    }

    [Fact]
    public async Task UpdateClaim_AuthorisedByStaffOfTheSameOrganisation_IsStored()
    {
        var (db, controller) = Create(TenantA);
        var a = Seed(db, TenantA);
        var ownStaff = Odip.Tests.Security.CrossTenant.User(db, TenantA);

        var result = await controller.UpdateClaim(a.TripClaim.Id, new UpdateClaimDto { AuthorisedByStaffId = ownStaff.Id }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(ownStaff.Id, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == a.TripClaim.Id)).AuthorisedByUserId);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task UpdateLineItem_ClaimOfAnotherTenant_ReturnsNotFound_AndChangesNothing(bool shiftClaim)
    {
        var (db, controller) = Create(TenantA);
        var b = Seed(db, TenantB);
        var (claim, line) = shiftClaim ? (b.ShiftClaim, b.ShiftLine) : (b.TripClaim, b.TripLine);

        var result = await controller.UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Hours = 1m, UnitPrice = 1m }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var stored = await db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == line.Id);
        Assert.Equal((line.Hours, line.UnitPrice, line.TotalAmount), (stored.Hours, stored.UnitPrice, stored.TotalAmount));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DeleteClaim_ClaimOfAnotherTenant_ReturnsNotFound_AndDeletesNothing(bool shiftClaim)
    {
        var (db, controller) = Create(TenantA);
        var b = Seed(db, TenantB);
        var claim = shiftClaim ? b.ShiftClaim : b.TripClaim;

        var result = await controller.DeleteClaim(claim.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.True(await db.TripClaims.AnyAsync(c => c.Id == claim.Id));
        Assert.Equal(2, await db.ClaimLineItems.CountAsync());
        Assert.Equal(ClaimStatus.InClaim, (await db.ParticipantBookings.AsNoTracking().SingleAsync(x => x.Id == b.Booking.Id)).ClaimStatus);
    }

    /// <summary>The caller's own settings, so a file is built whenever the claim is found (the settings are tenant-filtered too).</summary>
    private static void AddProviderSettings(OdipDbContext db)
    {
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantA, RegistrationNumber = "PR1", ABN = "1", OrganisationName = "Org", Address = "1 St", State = "VIC" });
        db.SaveChanges();
    }

    // PreviewClaim and GenerateClaim have no guard of their own: the generator reads the trip through the filtered TripInstances. Pinned so that stays true.
    [Fact]
    public async Task PreviewAndGenerateClaim_TripOfAnotherTenant_Return400TripNotFound_AndCreateNothing()
    {
        var (db, controller) = Create(TenantA);
        var b = Seed(db, TenantB);
        db.TripClaims.Remove(db.TripClaims.Single(c => c.Id == b.TripClaim.Id));   // a trip with no claim yet, so only the trip lookup can refuse
        db.ClaimLineItems.Remove(db.ClaimLineItems.Single(l => l.Id == b.TripLine.Id));
        db.SaveChanges();

        var preview = await controller.PreviewClaim(b.Trip.Id, new ClaimPreviewRequestDto(), CancellationToken.None);
        var generate = await controller.GenerateClaim(b.Trip.Id, new GenerateClaimRequestDto(), CancellationToken.None);

        var previewBody = Assert.IsType<ApiResponse<ClaimPreviewResponseDto>>(Assert.IsType<BadRequestObjectResult>(preview.Result).Value);
        var generateBody = Assert.IsType<ApiResponse<TripClaimListDto>>(Assert.IsType<BadRequestObjectResult>(generate.Result).Value);
        Assert.Equal("Trip not found.", Assert.Single(previewBody.Errors!));
        Assert.Equal("Trip not found.", Assert.Single(generateBody.Errors!));
        Assert.Single(await db.TripClaims.ToListAsync());   // only the shift claim seeded alongside
    }

    [Fact]
    public async Task DownloadBprCsv_ClaimOfAnotherTenant_ReturnsNotFound()
    {
        var (db, controller) = Create(TenantA);
        AddProviderSettings(db);
        var b = Seed(db, TenantB);

        Assert.IsType<NotFoundObjectResult>(await controller.DownloadBprCsv(b.TripClaim.Id, CancellationToken.None));
    }

    [Fact]
    public async Task DownloadInvoice_ClaimOfAnotherTenant_ReturnsNotFound()
    {
        var (db, controller) = Create(TenantA);
        AddProviderSettings(db);
        var b = Seed(db, TenantB);

        Assert.IsType<NotFoundObjectResult>(await controller.DownloadInvoice(b.TripClaim.Id, b.Booking.Id, CancellationToken.None));
    }

    // The guard must not lock the owner out: the same calls on the caller's own claims still work.

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task UpdateClaim_OwnClaim_StillUpdates(bool shiftClaim)
    {
        var (db, controller) = Create(TenantA);
        var a = Seed(db, TenantA);
        var claim = shiftClaim ? a.ShiftClaim : a.TripClaim;

        var result = await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Notes = "checked" }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("checked", (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).Notes);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task UpdateLineItem_OwnClaim_StillUpdates(bool shiftClaim)
    {
        var (db, controller) = Create(TenantA);
        var a = Seed(db, TenantA);
        var (claim, line) = shiftClaim ? (a.ShiftClaim, a.ShiftLine) : (a.TripClaim, a.TripLine);

        var result = await controller.UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Hours = 2m }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(line.UnitPrice * 2m, (await db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == line.Id)).TotalAmount);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DeleteClaim_OwnClaim_StillDeletes(bool shiftClaim)
    {
        var (db, controller) = Create(TenantA);
        var a = Seed(db, TenantA);
        var claim = shiftClaim ? a.ShiftClaim : a.TripClaim;

        var result = await controller.DeleteClaim(claim.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.False(await db.TripClaims.AnyAsync(c => c.Id == claim.Id));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task GetClaim_OwnClaim_ReturnsIt(bool shiftClaim)
    {
        var (db, controller) = Create(TenantA);
        var a = Seed(db, TenantA);
        var claim = shiftClaim ? a.ShiftClaim : a.TripClaim;

        var result = await controller.GetClaim(claim.Id, CancellationToken.None);

        Assert.Equal(claim.Id, Assert.IsType<ApiResponse<TripClaimDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Id);
    }

    [Fact]
    public async Task GetClaimsForTrip_OwnTrip_ReturnsItsClaims()
    {
        var (db, controller) = Create(TenantA);
        var a = Seed(db, TenantA);

        var result = await controller.GetClaimsForTrip(a.Trip.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<TripClaimListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(a.TripClaim.Id, Assert.Single(body.Data!).Id);
    }
}
