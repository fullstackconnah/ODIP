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

    private static ClaimsController CreateController(OdipDbContext db)
    {
        // A SuperAdmin context with no organisation chosen: the claim detail then carries no budget block (the budget tests are in the Funding folder).
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new(db, new ClaimGenerationService(db), new ShiftClaimGenerationService(db), new BprCsvService(db), new InvoiceService(db), new BudgetLedgerService(db, TimeProvider.System), tenant.Object);
    }

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

    // ── Defect fix: trip-kind claims never set TripClaim.ParticipantId — they relate to a
    // participant only through ClaimLineItem.ParticipantBooking.ParticipantId. The endpoint
    // must also match on that path, so the participant Claims tab (which renders both kinds)
    // sees trip claims too. ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetClaimsForParticipant_TripClaimLinkedViaLineItemBooking_IsReturned_WithNoKindFilter()
    {
        using var db = CreateDb();
        var tenantId = Guid.NewGuid();

        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Cara", LastName = "Voss",
            NdisNumber = "43177776666", PlanType = PlanType.AgencyManaged,
        };
        db.Participants.Add(participant);

        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Trip A", StartDate = new DateOnly(2026, 2, 1), DurationDays = 1 };
        db.TripInstances.Add(trip);
        var booking = new ParticipantBooking
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, Participant = participant,
            BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1),
        };
        db.ParticipantBookings.Add(booking);

        var tripClaim = new TripClaim
        {
            Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = trip.Id,
            Status = TripClaimStatus.Draft, ClaimReference = "TC-TRIP-LINKED",
        };
        db.TripClaims.Add(tripClaim);
        db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = tripClaim.Id, ParticipantBookingId = booking.Id,
            SupportItemCode = "01_002_0117_1_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 2, 1), SupportsDeliveredTo = new DateOnly(2026, 2, 1),
            Hours = 8m, UnitPrice = 60m, TotalAmount = 480m,
        });
        db.SaveChanges();

        var controller = CreateController(db);

        var noKindResult = await controller.GetClaimsForParticipant(participant.Id, null, CancellationToken.None);
        var noKindBody = Assert.IsType<ApiResponse<List<TripClaimListDto>>>(Assert.IsType<OkObjectResult>(noKindResult.Result).Value);
        var found = Assert.Single(noKindBody.Data!);
        Assert.Equal(tripClaim.Id, found.Id);
        Assert.Equal(ClaimKind.Trip, found.Kind);

        var tripKindResult = await controller.GetClaimsForParticipant(participant.Id, ClaimKind.Trip, CancellationToken.None);
        var tripKindBody = Assert.IsType<ApiResponse<List<TripClaimListDto>>>(Assert.IsType<OkObjectResult>(tripKindResult.Result).Value);
        Assert.Equal(tripClaim.Id, Assert.Single(tripKindBody.Data!).Id);
    }

    [Fact]
    public async Task GetClaimsForParticipant_TripClaimLinkedViaLineItemBooking_ExcludedByKindShiftFilter()
    {
        using var db = CreateDb();
        var tenantId = Guid.NewGuid();
        var (shiftParticipant, _, shiftClaim, _) = SeedShiftClaim(db, tenantId);

        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Trip B", StartDate = new DateOnly(2026, 2, 1), DurationDays = 1 };
        db.TripInstances.Add(trip);
        var booking = new ParticipantBooking
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = shiftParticipant.Id,
            BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1),
        };
        db.ParticipantBookings.Add(booking);
        var tripClaim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = trip.Id, Status = TripClaimStatus.Draft, ClaimReference = "TC-TRIP-2" };
        db.TripClaims.Add(tripClaim);
        db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = tripClaim.Id, ParticipantBookingId = booking.Id,
            SupportItemCode = "01_002_0117_1_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 2, 1), SupportsDeliveredTo = new DateOnly(2026, 2, 1),
            Hours = 8m, UnitPrice = 60m, TotalAmount = 480m,
        });
        db.SaveChanges();

        var controller = CreateController(db);

        var shiftKindResult = await controller.GetClaimsForParticipant(shiftParticipant.Id, ClaimKind.Shift, CancellationToken.None);
        var shiftKindBody = Assert.IsType<ApiResponse<List<TripClaimListDto>>>(Assert.IsType<OkObjectResult>(shiftKindResult.Result).Value);
        Assert.Equal(shiftClaim.Id, Assert.Single(shiftKindBody.Data!).Id);
    }

    [Fact]
    public async Task GetClaimsForParticipant_TripClaimLinkedToAnotherParticipantsBooking_IsNotReturned()
    {
        using var db = CreateDb();
        var tenantId = Guid.NewGuid();

        var participantA = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "A", LastName = "One", NdisNumber = "43100000001", PlanType = PlanType.AgencyManaged };
        var participantB = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "B", LastName = "Two", NdisNumber = "43100000002", PlanType = PlanType.AgencyManaged };
        db.Participants.AddRange(participantA, participantB);

        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Trip C", StartDate = new DateOnly(2026, 2, 1), DurationDays = 1 };
        db.TripInstances.Add(trip);
        var bookingForB = new ParticipantBooking
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participantB.Id,
            BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1),
        };
        db.ParticipantBookings.Add(bookingForB);
        var tripClaim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = trip.Id, Status = TripClaimStatus.Draft, ClaimReference = "TC-TRIP-3" };
        db.TripClaims.Add(tripClaim);
        db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = tripClaim.Id, ParticipantBookingId = bookingForB.Id,
            SupportItemCode = "01_002_0117_1_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 2, 1), SupportsDeliveredTo = new DateOnly(2026, 2, 1),
            Hours = 8m, UnitPrice = 60m, TotalAmount = 480m,
        });
        db.SaveChanges();

        var controller = CreateController(db);

        // Requesting participant A's claims must not surface the trip claim, which is only
        // linked to participant B's booking.
        var result = await controller.GetClaimsForParticipant(participantA.Id, null, CancellationToken.None);
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
        // The shift engine prices from the community access group, so the item lives in a real one (an item always has a group; the FK is not enforced by InMemory).
        var group = new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "GRP_COMMUNITY_ACCESS", DisplayName = "Community Access", SupportCategory = 4 };
        db.SupportActivityGroups.Add(group);
        db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = group.Id, ItemNumber = "04_WD", Description = "Weekday",
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

        var body = Assert.IsType<ApiResponse<ShiftClaimGeneratedDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(ClaimKind.Shift, body.Data!.Kind);
        Assert.Equal(participant.Id, body.Data.ParticipantId);
        Assert.Equal(320m, body.Data.TotalAmount);
        Assert.Single(await db.TripClaims.ToListAsync());
    }

    [Fact]
    public async Task GenerateShiftClaim_ListsTheShiftsItLeftOutAndWhy_AndTheClaimCarriesOnlyWhatItPriced()
    {
        using var db = CreateDb();
        var participant = SeedParticipantWithCompletedShift(db, Guid.NewGuid(), out var shift);
        var sleepover = new Shift
        {
            Id = Guid.NewGuid(), TenantId = shift.TenantId, ParticipantId = participant.Id, ServiceDate = new DateOnly(2026, 9, 8), StartTime = new TimeOnly(22, 0), EndTime = new TimeOnly(6, 0),
            EndsNextDay = true, Ratio = SupportRatio.OneToOne, NightType = SleepoverType.Sleepover, Status = ShiftStatus.Completed,
        };
        db.Shifts.Add(sleepover);
        db.SaveChanges();
        var controller = CreateController(db);

        var result = await controller.GenerateShiftClaim(participant.Id,
            new GenerateShiftClaimRequestDto { From = shift.ServiceDate, To = sleepover.ServiceDate }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ShiftClaimGeneratedDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(320m, body.Data!.TotalAmount);                                   // the plain shift only: the sleepover is not billed as eight hours of community access
        var left = Assert.Single(body.Data.LeftOut);
        Assert.Equal(sleepover.Id, left.ShiftId);
        Assert.Equal("It is a sleepover, which shift claims do not price yet.", left.Reason);
        Assert.Equal(1, await db.ClaimLineItems.CountAsync());
    }

    [Fact]
    public async Task GenerateShiftClaim_EchoesTheShiftsItPricedWithACaveat()
    {
        using var db = CreateDb();
        var participant = SeedParticipantWithCompletedShift(db, Guid.NewGuid(), out var shift);
        var overnight = new Shift
        {
            Id = Guid.NewGuid(), TenantId = shift.TenantId, ParticipantId = participant.Id, ServiceDate = new DateOnly(2026, 9, 8), StartTime = new TimeOnly(18, 0), EndTime = new TimeOnly(2, 0),
            EndsNextDay = true, Ratio = SupportRatio.OneToOne, NightType = SleepoverType.ActiveNight, Status = ShiftStatus.Completed,
        };
        db.Shifts.Add(overnight);
        db.SaveChanges();
        var controller = CreateController(db);

        var result = await controller.GenerateShiftClaim(participant.Id,
            new GenerateShiftClaimRequestDto { From = shift.ServiceDate, To = overnight.ServiceDate }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ShiftClaimGeneratedDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(640m, body.Data!.TotalAmount);                                   // both shifts are in the claim, 8 h each at $40
        var flagged = Assert.Single(body.Data.Flagged);
        Assert.Equal((overnight.Id, "Evening and night rates are not applied yet."), (flagged.ShiftId, flagged.Caveat));
        Assert.Empty(body.Data.LeftOut);
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
