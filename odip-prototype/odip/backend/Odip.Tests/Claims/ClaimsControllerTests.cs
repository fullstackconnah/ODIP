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
/// Controller-level coverage for ClaimsController: GetClaim's participant-id link (the frontend
/// links a claim line item to the participant record, so the id must round-trip alongside the
/// display name), the shift-completion design spec §2 participant-claims/claim-from-shifts
/// endpoints (delivery PR 3), and the nullability audit for shift-kind claims flowing through
/// GetClaim/DeleteClaim.
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

    /// <summary>A genuine non-SuperAdmin tenant-scoped db, for cross-tenant negative tests (same
    /// pattern as LeaveControllerTests.ApproveLeave_RequestBelongsToAnotherTenant_ReturnsNotFound).</summary>
    private static OdipDbContext CreateTenantScopedDb(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static ClaimsController CreateController(OdipDbContext db) =>
        new(db, new ClaimGenerationService(db), new ShiftClaimGenerationService(db), new BprCsvService(db), new InvoiceService(db));

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

    // ── Shared shift-claim fixture (used by GetClaimsForParticipant and the nullability audit) ──

    private static (Participant Participant, Shift Shift, TripClaim Claim, ClaimLineItem Line) SeedShiftClaim(OdipDbContext db, Guid tenantId)
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Amy", LastName = "Ng",
            NdisNumber = "43199991111", PlanType = PlanType.SelfManaged,
        };
        db.Participants.Add(participant);

        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id,
            ServiceDate = new DateOnly(2026, 9, 7), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
        };
        db.Shifts.Add(shift);

        var claim = new TripClaim
        {
            Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id,
            PeriodFrom = shift.ServiceDate, PeriodTo = shift.ServiceDate,
            Status = TripClaimStatus.Draft, ClaimReference = "TC-43199991111-20260907",
        };
        db.TripClaims.Add(claim);

        var line = new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shift.Id, ParticipantBookingId = null,
            SupportItemCode = "04_SHIFT", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = shift.ServiceDate, SupportsDeliveredTo = shift.ServiceDate,
            Hours = 8m, UnitPrice = 40m, TotalAmount = 320m,
        };
        db.ClaimLineItems.Add(line);
        claim.TotalAmount = 320m;
        db.SaveChanges();

        return (participant, shift, claim, line);
    }

    // ── Nullability audit: GetClaim/DeleteClaim against a Kind == Shift claim ─────────

    [Fact]
    public async Task GetClaim_ShiftKindClaim_DoesNotThrow_AndPopulatesLineFromShift()
    {
        using var db = CreateDb();
        var (participant, shift, claim, _) = SeedShiftClaim(db, Guid.NewGuid());
        var controller = CreateController(db);

        var result = await controller.GetClaim(claim.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<TripClaimDetailDto>>(ok.Value);
        Assert.Equal(ClaimKind.Shift, body.Data!.Kind);
        Assert.Equal(participant.Id, body.Data.ParticipantId);
        Assert.Null(body.Data.TripInstanceId);
        var lineItem = Assert.Single(body.Data.LineItems);
        Assert.Null(lineItem.ParticipantBookingId);
        Assert.Equal(shift.Id, lineItem.ShiftId);
        Assert.Equal(participant.Id, lineItem.ParticipantId);
        Assert.Equal(participant.FullName, lineItem.ParticipantName);
        Assert.Equal(participant.NdisNumber, lineItem.NdisNumber);
    }

    [Fact]
    public async Task DeleteClaim_ShiftKindClaim_DoesNotThrow_AndRemovesClaimAndLine()
    {
        using var db = CreateDb();
        var (_, _, claim, line) = SeedShiftClaim(db, Guid.NewGuid());
        var controller = CreateController(db);

        var result = await controller.DeleteClaim(claim.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.False(await db.TripClaims.AnyAsync(c => c.Id == claim.Id));
        Assert.False(await db.ClaimLineItems.AnyAsync(l => l.Id == line.Id));
    }

    // ── GetClaimsForParticipant ────────────────────────────────────────

    [Fact]
    public async Task GetClaimsForParticipant_FiltersByKind()
    {
        using var db = CreateDb();
        var tenantId = Guid.NewGuid();
        var (participant, _, shiftClaim, _) = SeedShiftClaim(db, tenantId);

        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "T1", StartDate = new DateOnly(2026, 1, 1), DurationDays = 1 };
        db.TripInstances.Add(trip);
        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1) };
        db.ParticipantBookings.Add(booking);
        var tripClaim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = trip.Id, Status = TripClaimStatus.Draft, ClaimReference = "TC-TRIP-20260101" };
        db.TripClaims.Add(tripClaim);
        db.SaveChanges();

        var controller = CreateController(db);

        var allResult = await controller.GetClaimsForParticipant(participant.Id, null, CancellationToken.None);
        var allBody = Assert.IsType<ApiResponse<List<TripClaimListDto>>>(Assert.IsType<OkObjectResult>(allResult.Result).Value);
        Assert.Single(allBody.Data!); // only the shift claim has this ParticipantId; the trip claim doesn't

        var shiftResult = await controller.GetClaimsForParticipant(participant.Id, ClaimKind.Shift, CancellationToken.None);
        var shiftBody = Assert.IsType<ApiResponse<List<TripClaimListDto>>>(Assert.IsType<OkObjectResult>(shiftResult.Result).Value);
        var only = Assert.Single(shiftBody.Data!);
        Assert.Equal(shiftClaim.Id, only.Id);
        Assert.Equal(ClaimKind.Shift, only.Kind);

        var tripResult = await controller.GetClaimsForParticipant(participant.Id, ClaimKind.Trip, CancellationToken.None);
        var tripBody = Assert.IsType<ApiResponse<List<TripClaimListDto>>>(Assert.IsType<OkObjectResult>(tripResult.Result).Value);
        Assert.Empty(tripBody.Data!);
    }

    [Fact]
    public async Task GetClaimsForParticipant_ParticipantBelongsToAnotherTenant_ReturnsEmptyList()
    {
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();
        using var db = CreateTenantScopedDb(tenantAId);
        var (participantB, _, _, _) = SeedShiftClaim(db, tenantBId);

        var controller = CreateController(db);
        var result = await controller.GetClaimsForParticipant(participantB.Id, null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<TripClaimListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Empty(body.Data!);
    }

    // ── PreviewShiftClaim / GenerateShiftClaim ─────────────────────────

    private static Participant SeedParticipantWithCompletedShift(OdipDbContext db, Guid tenantId, out Shift shift)
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Lee",
            NdisNumber = "43188882222", PlanType = PlanType.SelfManaged,
        };
        db.Participants.Add(participant);

        shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id,
            ServiceDate = new DateOnly(2026, 9, 7), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
        };
        db.Shifts.Add(shift);

        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = tenantId, RegistrationNumber = "PR1", ABN = "1", OrganisationName = "Org",
            Address = "1 St", State = "VIC",
        });
        db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = Guid.NewGuid(), ItemNumber = "04_WD", Description = "Weekday",
            DayType = ClaimDayType.Weekday, IsIntensive = false, PriceLimit_VIC = 40m, CatalogueVersion = "24-25",
            EffectiveFrom = new DateOnly(2024, 7, 1), IsActive = true,
        });
        db.SaveChanges();
        return participant;
    }

    [Fact]
    public async Task PreviewShiftClaim_HappyPath_ReturnsPreviewWithoutPersisting()
    {
        using var db = CreateDb();
        var participant = SeedParticipantWithCompletedShift(db, Guid.NewGuid(), out var shift);
        var controller = CreateController(db);

        var result = await controller.PreviewShiftClaim(participant.Id,
            new GenerateShiftClaimRequestDto { From = shift.ServiceDate, To = shift.ServiceDate }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ShiftClaimPreviewResponseDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(320m, body.Data!.TotalAmount);
        Assert.Empty(await db.TripClaims.ToListAsync());
    }

    [Fact]
    public async Task GenerateShiftClaim_HappyPath_PersistsShiftKindClaim()
    {
        using var db = CreateDb();
        var participant = SeedParticipantWithCompletedShift(db, Guid.NewGuid(), out var shift);
        var controller = CreateController(db);

        var result = await controller.GenerateShiftClaim(participant.Id,
            new GenerateShiftClaimRequestDto { From = shift.ServiceDate, To = shift.ServiceDate }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<TripClaimListDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(ClaimKind.Shift, body.Data!.Kind);
        Assert.Equal(participant.Id, body.Data.ParticipantId);
        Assert.Equal(320m, body.Data.TotalAmount);
        Assert.Single(await db.TripClaims.ToListAsync());
    }

    [Fact]
    public async Task GenerateShiftClaim_NoCompletedUnclaimedShiftsInRange_ReturnsBadRequest()
    {
        using var db = CreateDb();
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), FirstName = "No", LastName = "Shifts" };
        db.Participants.Add(participant);
        db.SaveChanges();
        var controller = CreateController(db);

        var result = await controller.GenerateShiftClaim(participant.Id,
            new GenerateShiftClaimRequestDto { From = new DateOnly(2026, 9, 7), To = new DateOnly(2026, 9, 8) }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task GenerateShiftClaim_ParticipantBelongsToAnotherTenant_ReturnsBadRequest_NotOtherTenantsData()
    {
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();
        using var db = CreateTenantScopedDb(tenantAId);
        var participantB = SeedParticipantWithCompletedShift(db, tenantBId, out var shift);

        var controller = CreateController(db);
        var result = await controller.GenerateShiftClaim(participantB.Id,
            new GenerateShiftClaimRequestDto { From = shift.ServiceDate, To = shift.ServiceDate }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        // No claim should have been generated against tenant B's shift on behalf of tenant A's caller.
        Assert.Empty(await db.TripClaims.IgnoreQueryFilters().ToListAsync());
    }
}
