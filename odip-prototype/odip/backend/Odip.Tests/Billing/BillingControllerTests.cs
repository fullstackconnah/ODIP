using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// Controller-level coverage for the Billing API slice (BillingController), on top of the
/// domain-level BillingValidator/ProdaBulkFileWriter coverage in BillingPrototypeTests. Uses the
/// same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as AdminUsersControllerTests.
/// </summary>
public class BillingControllerTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static Participant SeedParticipant(OdipDbContext db, string ndisNumber = "NDIS0001")
    {
        var p = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Test", LastName = "Participant",
            NdisNumber = ndisNumber, PlanType = PlanType.AgencyManaged, IsActive = true
        };
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static FundingSource SeedFundingSource(OdipDbContext db, Guid participantId, FundingRouteType routeType = FundingRouteType.AgencyManaged)
    {
        var fs = new FundingSource { Id = Guid.NewGuid(), ParticipantId = participantId, RouteType = routeType, IsActive = true };
        db.FundingSources.Add(fs);
        db.SaveChanges();
        return fs;
    }

    private static ServiceBooking SeedBooking(
        OdipDbContext db, Guid fundingSourceId, string supportItem, decimal allocated, decimal claimed = 0m,
        DateOnly? endDate = null, int claimWindowDays = 60)
    {
        var booking = new ServiceBooking
        {
            Id = Guid.NewGuid(), FundingSourceId = fundingSourceId, ProdaBookingReference = "BOOK-1",
            StartDate = new DateOnly(2020, 1, 1), EndDate = endDate ?? DateOnly.FromDateTime(DateTime.UtcNow).AddYears(1),
            ClaimWindowDays = claimWindowDays
        };
        booking.Lines.Add(new ServiceBookingLine
        {
            Id = Guid.NewGuid(), ServiceBookingId = booking.Id, SupportItemNumber = supportItem,
            AllocatedAmount = allocated, ClaimedAmount = claimed
        });
        db.ServiceBookings.Add(booking);
        db.SaveChanges();
        return booking;
    }

    private static BillableEvent SeedEvent(
        OdipDbContext db, Guid participantId, Guid fundingSourceId, Guid? serviceBookingId,
        string supportItem, decimal totalAmount, decimal unitPrice, decimal quantity, string claimReference)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var ev = new BillableEvent
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, FundingSourceId = fundingSourceId,
            ServiceBookingId = serviceBookingId, Stream = IncomeStream.Other, SupportItemNumber = supportItem,
            SupportsDeliveredFrom = today, SupportsDeliveredTo = today, DayType = ClaimDayType.Weekday,
            Quantity = quantity, UnitPrice = unitPrice, TotalAmount = totalAmount, GstCode = GSTCode.P2,
            ClaimType = ClaimType.Standard, ParticipantApproved = true, ClaimReference = claimReference,
            Status = BillableEventStatus.Draft
        };
        db.BillableEvents.Add(ev);
        db.SaveChanges();
        return ev;
    }

    private static ProviderSettings SeedProviderSettings(OdipDbContext db)
    {
        var settings = new ProviderSettings
        {
            Id = Guid.NewGuid(), RegistrationNumber = "REG123", ABN = "12345678901",
            OrganisationName = "Test Org", Address = "1 Test St"
        };
        db.ProviderSettings.Add(settings);
        db.SaveChanges();
        return settings;
    }

    // ── Claim batch creation vs. booking balance ────────────────────────

    [Fact]
    public async Task CreateClaimBatch_EventExceedsBookingBalance_ReturnsBadRequestAndLeavesBalanceUnchanged()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var fs = SeedFundingSource(db, participant.Id);
        var booking = SeedBooking(db, fs.Id, "01_002_0107_1_1", allocated: 100m, claimed: 0m);
        var ev = SeedEvent(db, participant.Id, fs.Id, booking.Id, "01_002_0107_1_1",
            totalAmount: 150m, unitPrice: 150m, quantity: 1m, claimReference: "REF-OVER-BALANCE");

        var controller = new BillingController(db);

        var result = await controller.CreateClaimBatch(new CreateClaimBatchDto { EventIds = new List<Guid> { ev.Id } }, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ClaimBatchDetailDto>>(badRequest.Value);
        Assert.False(body.Success);
        Assert.Contains(body.Errors!, e => e.Contains("BOOKING_BALANCE"));

        // Balance must be untouched — Apply() must never have run.
        var line = await db.ServiceBookingLines.SingleAsync(l => l.ServiceBookingId == booking.Id);
        Assert.Equal(0m, line.ClaimedAmount);

        // No batch was created and the event was not re-tagged as claimed.
        Assert.Empty(await db.ClaimBatches.ToListAsync());
        var reloadedEvent = await db.BillableEvents.SingleAsync(e => e.Id == ev.Id);
        Assert.Equal(BillableEventStatus.Draft, reloadedEvent.Status);
    }

    [Fact]
    public async Task ValidateClaimBatch_OverBalanceEvent_ReturnsErrorFindingButLeavesBalanceUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var fs = SeedFundingSource(db, participant.Id);
        var booking = SeedBooking(db, fs.Id, "01_002_0107_1_1", allocated: 100m, claimed: 0m);
        var ev = SeedEvent(db, participant.Id, fs.Id, booking.Id, "01_002_0107_1_1",
            totalAmount: 150m, unitPrice: 150m, quantity: 1m, claimReference: "REF-VALIDATE-OVER");

        var controller = new BillingController(db);

        var result = await controller.ValidateClaimBatch(new ValidateBillingDto { EventIds = new List<Guid> { ev.Id } }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<BillingValidationResultDto>>>(ok.Value);
        Assert.True(body.Success);
        Assert.Contains(body.Data!, r => r.Code == "BOOKING_BALANCE" && r.Severity == BillingSeverity.Error);

        // validate must NEVER mutate — booking balance and event status stay exactly as seeded.
        var line = await db.ServiceBookingLines.SingleAsync(l => l.ServiceBookingId == booking.Id);
        Assert.Equal(0m, line.ClaimedAmount);
        var reloadedEvent = await db.BillableEvents.SingleAsync(e => e.Id == ev.Id);
        Assert.Equal(BillableEventStatus.Draft, reloadedEvent.Status);
    }

    [Fact]
    public async Task ValidateClaimBatch_ValidEvent_LeavesBalanceUntouched()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var fs = SeedFundingSource(db, participant.Id);
        var booking = SeedBooking(db, fs.Id, "01_002_0107_1_1", allocated: 100m, claimed: 0m);
        var ev = SeedEvent(db, participant.Id, fs.Id, booking.Id, "01_002_0107_1_1",
            totalAmount: 10m, unitPrice: 10m, quantity: 1m, claimReference: "REF-VALIDATE-OK");

        var controller = new BillingController(db);

        var result = await controller.ValidateClaimBatch(new ValidateBillingDto { EventIds = new List<Guid> { ev.Id } }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<BillingValidationResultDto>>>(ok.Value);
        Assert.True(body.Success);
        Assert.DoesNotContain(body.Data!, r => r.Severity == BillingSeverity.Error);

        var line = await db.ServiceBookingLines.SingleAsync(l => l.ServiceBookingId == booking.Id);
        Assert.Equal(0m, line.ClaimedAmount);
    }

    [Fact]
    public async Task CreateClaimBatch_ValidEvent_ConsumesBalanceExactlyOnce()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var fs = SeedFundingSource(db, participant.Id);
        var booking = SeedBooking(db, fs.Id, "01_002_0107_1_1", allocated: 100m, claimed: 0m);
        var ev = SeedEvent(db, participant.Id, fs.Id, booking.Id, "01_002_0107_1_1",
            totalAmount: 10m, unitPrice: 10m, quantity: 1m, claimReference: "REF-APPLY-ONCE");

        var controller = new BillingController(db);

        var result = await controller.CreateClaimBatch(new CreateClaimBatchDto { EventIds = new List<Guid> { ev.Id } }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ClaimBatchDetailDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Single(body.Data!.Events);
        // Committed to a batch — Claimed, not just Validated (see the controller's comment on
        // why this must advance past Validated for cross-batch duplicate detection to work).
        Assert.Equal(BillableEventStatus.Claimed, body.Data.Events[0].Status);

        // Balance consumed exactly once — not twice, not left at zero.
        var line = await db.ServiceBookingLines.SingleAsync(l => l.ServiceBookingId == booking.Id);
        Assert.Equal(10m, line.ClaimedAmount);

        var batches = await db.ClaimBatches.Include(b => b.Events).ToListAsync();
        Assert.Single(batches);
        Assert.Single(batches[0].Events);
        Assert.Equal(ev.Id, batches[0].Events.First().Id);

        // A second attempt to batch the SAME event again must now fail duplicate-reference
        // validation rather than double-consuming the balance.
        var secondEvent = SeedEvent(db, participant.Id, fs.Id, booking.Id, "01_002_0107_1_1",
            totalAmount: 200m, unitPrice: 200m, quantity: 1m, claimReference: "REF-APPLY-ONCE"); // same ClaimReference on purpose
        var secondResult = await controller.CreateClaimBatch(new CreateClaimBatchDto { EventIds = new List<Guid> { secondEvent.Id } }, CancellationToken.None);
        var secondBadRequest = Assert.IsType<BadRequestObjectResult>(secondResult.Result);
        var secondBody = Assert.IsType<ApiResponse<ClaimBatchDetailDto>>(secondBadRequest.Value);
        Assert.Contains(secondBody.Errors!, e => e.Contains("DUPLICATE_REF"));

        // Still exactly one claimed amount recorded — the rejected second attempt changed nothing.
        var lineAfter = await db.ServiceBookingLines.SingleAsync(l => l.ServiceBookingId == booking.Id);
        Assert.Equal(10m, lineAfter.ClaimedAmount);
    }

    [Fact]
    public async Task CreateClaimBatch_NonAgencyManagedEvent_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var fs = SeedFundingSource(db, participant.Id, FundingRouteType.PlanManaged);
        var ev = SeedEvent(db, participant.Id, fs.Id, null, "01_002_0107_1_1",
            totalAmount: 10m, unitPrice: 10m, quantity: 1m, claimReference: "REF-NONAGENCY");

        var controller = new BillingController(db);

        var result = await controller.CreateClaimBatch(new CreateClaimBatchDto { EventIds = new List<Guid> { ev.Id } }, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ClaimBatchDetailDto>>(badRequest.Value);
        Assert.False(body.Success);
        Assert.Empty(await db.ClaimBatches.ToListAsync());
    }

    // ── PRODA file download ─────────────────────────────────────────────

    [Fact]
    public async Task DownloadProdaFile_ClaimedBatch_EmitsExpectedFileNameFormat()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        var fs = SeedFundingSource(db, participant.Id);
        var booking = SeedBooking(db, fs.Id, "01_002_0107_1_1", allocated: 100m, claimed: 0m);
        var ev = SeedEvent(db, participant.Id, fs.Id, booking.Id, "01_002_0107_1_1",
            totalAmount: 10m, unitPrice: 10m, quantity: 1m, claimReference: "REF-PRODAFILE");

        var controller = new BillingController(db);
        var createResult = await controller.CreateClaimBatch(new CreateClaimBatchDto { EventIds = new List<Guid> { ev.Id } }, CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(createResult.Result);
        var body = Assert.IsType<ApiResponse<ClaimBatchDetailDto>>(ok.Value);
        var batchId = body.Data!.Id;

        var fileResult = await controller.DownloadProdaFile(batchId, CancellationToken.None);

        var file = Assert.IsType<FileContentResult>(fileResult);
        Assert.Equal("text/csv", file.ContentType);

        var expectedFileName = ProdaBulkFileWriter.FileName(DateOnly.FromDateTime(DateTime.UtcNow));
        Assert.Equal(expectedFileName, file.FileDownloadName);
        Assert.Matches(@"^NDISUPLOAD\d{6}\.csv$", file.FileDownloadName);

        var csv = System.Text.Encoding.UTF8.GetString(file.FileContents);
        Assert.Contains("REF-PRODAFILE", csv);
        Assert.Contains("REG123", csv);
    }

    // ── Billable event update gate ──────────────────────────────────────

    [Fact]
    public async Task UpdateBillableEvent_AlreadyClaimed_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var fs = SeedFundingSource(db, participant.Id);
        var ev = SeedEvent(db, participant.Id, fs.Id, null, "01_002_0107_1_1",
            totalAmount: 10m, unitPrice: 10m, quantity: 1m, claimReference: "REF-CLAIMED");
        ev.Status = BillableEventStatus.Claimed;
        await db.SaveChangesAsync();

        var controller = new BillingController(db);
        var dto = new UpdateBillableEventDto
        {
            ParticipantId = participant.Id, FundingSourceId = fs.Id, SupportItemNumber = "01_002_0107_1_1",
            SupportsDeliveredFrom = DateOnly.FromDateTime(DateTime.UtcNow), SupportsDeliveredTo = DateOnly.FromDateTime(DateTime.UtcNow),
            Quantity = 2m, UnitPrice = 10m, TotalAmount = 20m, ClaimReference = "REF-CLAIMED"
        };

        var result = await controller.UpdateBillableEvent(ev.Id, dto, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        var reloaded = await db.BillableEvents.SingleAsync(e => e.Id == ev.Id);
        Assert.Equal(10m, reloaded.TotalAmount); // unchanged
    }

    // ── INTAKE-08: draft participants are excluded from claims/billing surfaces ────────

    [Fact]
    public async Task CreateFundingSource_DraftParticipant_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.Add(draft);
        db.SaveChanges();
        var controller = new BillingController(db);

        var result = await controller.CreateFundingSource(
            new CreateFundingSourceDto { ParticipantId = draft.Id, RouteType = FundingRouteType.AgencyManaged },
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(await db.FundingSources.ToListAsync());
    }

    [Fact]
    public async Task CreateBillableEvent_DraftParticipant_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.Add(draft);
        var fs = new FundingSource { Id = Guid.NewGuid(), ParticipantId = draft.Id, RouteType = FundingRouteType.AgencyManaged };
        db.FundingSources.Add(fs);
        db.SaveChanges();
        var controller = new BillingController(db);

        var result = await controller.CreateBillableEvent(
            new CreateBillableEventDto { ParticipantId = draft.Id, FundingSourceId = fs.Id },
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(await db.BillableEvents.ToListAsync());
    }
}
