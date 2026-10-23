using System.ComponentModel.DataAnnotations;
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
/// A claim that has gone to the NDIA keeps its figures; its status only moves along the allowed paths, whichever way it is changed; a line's amounts have limits. The caller is an Admin of organisation A.
/// </summary>
public class ClaimEditGuardsTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static (OdipDbContext Db, ClaimsController Controller) Create(Guid? tenantId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId ?? TenantA);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        return (db, new ClaimsController(db, new ClaimGenerationService(db), new ShiftClaimGenerationService(db), new BprCsvService(db), new InvoiceService(db), new BudgetLedgerService(db, TimeProvider.System), tenant.Object));
    }

    /// <summary>A shift claim of organisation A with two lines: 2 h at $50 ($100) and 1 h at $30 ($30), total $130.</summary>
    private static (TripClaim Claim, ClaimLineItem First, ClaimLineItem Second) Seed(OdipDbContext db, TripClaimStatus status, Guid? tenantId = null)
    {
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId ?? TenantA, FirstName = "Ada", LastName = "Claim" };
        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id, Status = status, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = 130m };
        ClaimLineItem Line(decimal hours, decimal price) => new()
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = Guid.NewGuid(), SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 10, 1), SupportsDeliveredTo = new DateOnly(2026, 10, 1), Hours = hours, UnitPrice = price, TotalAmount = hours * price,
        };
        var first = Line(2m, 50m);
        var second = Line(1m, 30m);
        // Its organisation has invoice details, so a move to Submitted can issue the (self-managed) participant's invoice (Xero PR1).
        var settings = new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId ?? TenantA, RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Test Provider", Address = "1 Test St", State = "NSW" };
        db.AddRange(participant, claim, first, second, settings);
        db.SaveChanges();
        return (claim, first, second);
    }

    private static int StatusOf(ActionResult<ApiResponse<bool>> result) => Assert.IsAssignableFrom<ObjectResult>(result.Result).StatusCode ?? 200;

    private static string RefusalOf(ActionResult<ApiResponse<bool>> result) => Assert.Single(Assert.IsType<ApiResponse<bool>>(Assert.IsAssignableFrom<ObjectResult>(result.Result).Value).Errors!);

    // ── A claim that has gone to the NDIA keeps its figures ────────────────

    public static TheoryData<TripClaimStatus, string> LockedEdits()
    {
        var data = new TheoryData<TripClaimStatus, string>();
        foreach (var status in new[] { TripClaimStatus.Submitted, TripClaimStatus.Approved, TripClaimStatus.Paid, TripClaimStatus.PartiallyPaid, TripClaimStatus.Rejected })
            foreach (var edit in new[] { "hours", "price", "code", "type" })
                data.Add(status, edit);
        return data;
    }

    [Theory]
    [MemberData(nameof(LockedEdits))]
    public async Task ASubmittedClaimsLines_CannotBeChangedInTheirFigures_AndNothingIsWritten(TripClaimStatus status, string edit)
    {
        var (db, controller) = Create();
        var (claim, line, _) = Seed(db, status);
        var dto = edit switch
        {
            "hours" => new UpdateClaimLineItemDto { Hours = 5m },
            "price" => new UpdateClaimLineItemDto { UnitPrice = 99m },
            "code" => new UpdateClaimLineItemDto { SupportItemCode = "01_011_0107_1_1" },
            _ => new UpdateClaimLineItemDto { ClaimType = ClaimType.Cancellation, CancellationReason = "No show" },
        };

        var result = await controller.UpdateLineItem(claim.Id, line.Id, dto, Ct);

        Assert.Equal(409, StatusOf(result));
        Assert.Equal("This claim has been submitted, so its lines can't be changed.", RefusalOf(result));
        db.ChangeTracker.Clear();
        var stored = await db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == line.Id);
        Assert.Equal((2m, 50m, "04_104_0125_6_1", ClaimType.Standard), (stored.Hours, stored.UnitPrice, stored.SupportItemCode, stored.ClaimType));
        Assert.Equal(130m, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).TotalAmount);
    }

    [Fact]
    public async Task ASubmittedClaimsLine_StillTakesItsStatusAndPaidAmount()
    {
        var (db, controller) = Create();
        var (claim, line, _) = Seed(db, TripClaimStatus.Submitted);

        var result = await controller.UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Paid, PaidAmount = 90m }, Ct);

        Assert.Equal(200, StatusOf(result));
        db.ChangeTracker.Clear();
        var stored = await db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == line.Id);
        Assert.Equal((ClaimLineItemStatus.Paid, 90m), (stored.Status, stored.PaidAmount));
    }

    [Theory]
    [InlineData(TripClaimStatus.Draft)]
    [InlineData(TripClaimStatus.Ready)]
    public async Task ADraftClaimsLine_CanBeEdited_AndTheClaimTotalIsTheSumOfAllItsStoredLines(TripClaimStatus status)
    {
        var (db, controller) = Create();
        var (claim, line, other) = Seed(db, status);

        var result = await controller.UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Hours = 3m }, Ct);

        Assert.Equal(200, StatusOf(result));
        db.ChangeTracker.Clear();
        var lines = await db.ClaimLineItems.AsNoTracking().Where(l => l.TripClaimId == claim.Id).ToListAsync();
        Assert.Equal(180m, lines.Sum(l => l.TotalAmount));
        Assert.Equal(lines.Sum(l => l.TotalAmount), (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).TotalAmount);
    }

    // ── Limits on a line's amounts ─────────────────────────────────────────

    [Theory]
    [InlineData(0.0, null, null)]
    [InlineData(-5.0, null, null)]
    [InlineData(1001.0, null, null)]
    [InlineData(null, -1.0, null)]
    [InlineData(null, null, -1.0)]
    public void ALinesAmounts_HaveLimits(double? hours, double? price, double? paid)
    {
        var dto = new UpdateClaimLineItemDto { Hours = (decimal?)hours, UnitPrice = (decimal?)price, PaidAmount = (decimal?)paid };

        Assert.False(Validator.TryValidateObject(dto, new ValidationContext(dto), new List<ValidationResult>(), validateAllProperties: true));
    }

    [Fact]
    public void ASensibleLine_Validates()
    {
        var dto = new UpdateClaimLineItemDto { Hours = 7.5m, UnitPrice = 0m, PaidAmount = 0m };

        Assert.True(Validator.TryValidateObject(dto, new ValidationContext(dto), new List<ValidationResult>(), validateAllProperties: true));
    }

    // ── Status moves ───────────────────────────────────────────────────────

    [Theory]
    [InlineData(TripClaimStatus.Paid, TripClaimStatus.Draft)]
    [InlineData(TripClaimStatus.Draft, TripClaimStatus.Paid)]
    [InlineData(TripClaimStatus.Paid, TripClaimStatus.Submitted)]
    [InlineData(TripClaimStatus.Submitted, TripClaimStatus.Draft)]
    [InlineData(TripClaimStatus.Rejected, TripClaimStatus.Paid)]
    [InlineData(TripClaimStatus.Draft, TripClaimStatus.Rejected)]
    public async Task AClaimCannotMoveAlongAPathThatIsNotAllowed(TripClaimStatus from, TripClaimStatus to)
    {
        var (db, controller) = Create();
        var (claim, _, _) = Seed(db, from);

        var result = await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = to }, Ct);

        Assert.Equal(409, StatusOf(result));
        Assert.Contains("can't be marked as", RefusalOf(result));
        db.ChangeTracker.Clear();
        Assert.Equal(from, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).Status);
    }

    [Fact]
    public async Task SubmittingADraft_StampsTheSubmittedDate_AndMarkingItPaid_StampsThePaidDateOnce()
    {
        var (db, controller) = Create();
        var (claim, _, _) = Seed(db, TripClaimStatus.Draft);

        Assert.Equal(200, StatusOf(await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct)));
        Assert.Equal(200, StatusOf(await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Paid }, Ct)));
        db.ChangeTracker.Clear();
        var paid = await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id);
        Assert.NotNull(paid.SubmittedDate);
        Assert.NotNull(paid.PaidDate);

        // Saying "Paid" again is not a move: the date stays.
        Assert.Equal(200, StatusOf(await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Paid }, Ct)));
        db.ChangeTracker.Clear();
        Assert.Equal(paid.PaidDate, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).PaidDate);
    }

    [Fact]
    public async Task WhenEveryLineIsPaid_TheClaimBecomesPaid_AndThePaidDateIsStamped()
    {
        var (db, controller) = Create();
        var (claim, first, second) = Seed(db, TripClaimStatus.Submitted);

        await controller.UpdateLineItem(claim.Id, first.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Paid }, Ct);
        await controller.UpdateLineItem(claim.Id, second.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Paid }, Ct);

        db.ChangeTracker.Clear();
        var stored = await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id);
        Assert.Equal(TripClaimStatus.Paid, stored.Status);
        Assert.NotNull(stored.PaidDate);
    }

    [Fact]
    public async Task PayingEveryLineOfADraftClaim_DoesNotMakeTheClaimPaid()
    {
        var (db, controller) = Create();
        var (claim, first, second) = Seed(db, TripClaimStatus.Draft);

        await controller.UpdateLineItem(claim.Id, first.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Paid }, Ct);
        await controller.UpdateLineItem(claim.Id, second.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Paid }, Ct);

        db.ChangeTracker.Clear();
        Assert.Equal(TripClaimStatus.Draft, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).Status);
    }

    // ── Acceptance: boundaries, the whole status matrix, and the total across a sequence ─────

    [Theory]
    [InlineData(0.01, 0.0, 0.0)]
    [InlineData(1000.0, 10000.0, 1000000.0)]
    public void ALinesAmounts_AtTheirLimits_AreAccepted(double hours, double price, double paid)
    {
        var dto = new UpdateClaimLineItemDto { Hours = (decimal)hours, UnitPrice = (decimal)price, PaidAmount = (decimal)paid };

        Assert.True(Validator.TryValidateObject(dto, new ValidationContext(dto), new List<ValidationResult>(), validateAllProperties: true));
    }

    [Theory]
    [InlineData(0.009, null, null)]
    [InlineData(1000.01, null, null)]
    [InlineData(null, 10000.01, null)]
    [InlineData(null, null, 1000000.01)]
    public void ALinesAmounts_JustOutsideTheirLimits_AreRefused(double? hours, double? price, double? paid)
    {
        var dto = new UpdateClaimLineItemDto { Hours = (decimal?)hours, UnitPrice = (decimal?)price, PaidAmount = (decimal?)paid };

        Assert.False(Validator.TryValidateObject(dto, new ValidationContext(dto), new List<ValidationResult>(), validateAllProperties: true));
    }

    // Written out by hand, not derived from the controller: the moves that are allowed. Everything else between two different statuses is refused.
    private static readonly HashSet<(TripClaimStatus, TripClaimStatus)> Legal = new()
    {
        (TripClaimStatus.Draft, TripClaimStatus.Submitted), (TripClaimStatus.Ready, TripClaimStatus.Submitted),
        (TripClaimStatus.Submitted, TripClaimStatus.Paid), (TripClaimStatus.Submitted, TripClaimStatus.PartiallyPaid), (TripClaimStatus.Submitted, TripClaimStatus.Rejected),
        (TripClaimStatus.Approved, TripClaimStatus.Paid), (TripClaimStatus.Approved, TripClaimStatus.PartiallyPaid), (TripClaimStatus.Approved, TripClaimStatus.Rejected),
        (TripClaimStatus.PartiallyPaid, TripClaimStatus.Paid), (TripClaimStatus.Rejected, TripClaimStatus.Submitted),
    };

    public static TheoryData<TripClaimStatus, TripClaimStatus> EveryStatusPair()
    {
        var data = new TheoryData<TripClaimStatus, TripClaimStatus>();
        foreach (var from in Enum.GetValues<TripClaimStatus>())
            foreach (var to in Enum.GetValues<TripClaimStatus>())
                data.Add(from, to);
        return data;
    }

    [Theory]
    [MemberData(nameof(EveryStatusPair))]
    public async Task EveryStatusMove_IsAllowedOrRefused_AsTheMatrixSays(TripClaimStatus from, TripClaimStatus to)
    {
        var (db, controller) = Create();
        var (claim, _, _) = Seed(db, from);

        var result = await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = to }, Ct);

        var allowed = from == to || Legal.Contains((from, to));
        Assert.Equal(allowed ? 200 : 409, StatusOf(result));
        db.ChangeTracker.Clear();
        Assert.Equal(allowed ? to : from, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).Status);
    }

    [Fact]
    public async Task TheClaimTotal_EqualsTheSumOfItsLines_AfterEveryStepOfASequence()
    {
        var (db, controller) = Create();
        var (claim, first, second) = Seed(db, TripClaimStatus.Draft);

        async Task AssertWhole()
        {
            db.ChangeTracker.Clear();
            var stored = await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id);
            Assert.Equal((await db.ClaimLineItems.AsNoTracking().Where(l => l.TripClaimId == claim.Id).ToListAsync()).Sum(l => l.TotalAmount), stored.TotalAmount);
        }

        foreach (var dto in new[]
        {
            new UpdateClaimLineItemDto { Hours = 3m }, new UpdateClaimLineItemDto { UnitPrice = 12.34m }, new UpdateClaimLineItemDto { Hours = 0.01m }, new UpdateClaimLineItemDto { UnitPrice = 0m },
        })
        {
            Assert.Equal(200, StatusOf(await controller.UpdateLineItem(claim.Id, first.Id, dto, Ct)));
            await AssertWhole();
            Assert.Equal(200, StatusOf(await controller.UpdateLineItem(claim.Id, second.Id, dto, Ct)));
            await AssertWhole();
        }

        // Once submitted the figures are locked, and the total stays the sum.
        Assert.Equal(200, StatusOf(await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct)));
        Assert.Equal(409, StatusOf(await controller.UpdateLineItem(claim.Id, first.Id, new UpdateClaimLineItemDto { Hours = 9m }, Ct)));
        await AssertWhole();
    }

    [Theory]
    [InlineData(TripClaimStatus.Submitted)]
    [InlineData(TripClaimStatus.Paid)]
    [InlineData(TripClaimStatus.Approved)]
    [InlineData(TripClaimStatus.PartiallyPaid)]
    public async Task ASubmittedOrPaidClaim_CannotBeDeleted_SoItsLinesCannotBeRemoved(TripClaimStatus status)
    {
        var (db, controller) = Create();
        var (claim, _, _) = Seed(db, status);

        var result = await controller.DeleteClaim(claim.Id, Ct);

        Assert.Equal(400, StatusOf(result));
        db.ChangeTracker.Clear();
        Assert.Equal(2, await db.ClaimLineItems.CountAsync(l => l.TripClaimId == claim.Id));
    }

    // Rejected stays deletable: delete and regenerate is the only way to correct an NDIA rejection (its lines are locked and it cannot go back to Draft).
    [Theory]
    [InlineData(TripClaimStatus.Draft)]
    [InlineData(TripClaimStatus.Ready)]
    [InlineData(TripClaimStatus.Rejected)]
    [InlineData(TripClaimStatus.Cancelled)]
    public async Task ADraftReadyRejectedOrCancelledClaim_CanBeDeleted(TripClaimStatus status)
    {
        var (db, controller) = Create();
        var (claim, _, _) = Seed(db, status);

        Assert.Equal(200, StatusOf(await controller.DeleteClaim(claim.Id, Ct)));
        db.ChangeTracker.Clear();
        Assert.False(await db.TripClaims.AnyAsync(c => c.Id == claim.Id));
    }

    [Fact]
    public async Task TheRefusalToMoveAStatus_NamesTheClaim_AndSaysPartiallyPaidInPlainEnglish()
    {
        var (db, controller) = Create();
        var (claim, _, _) = Seed(db, TripClaimStatus.Paid);

        var result = await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.PartiallyPaid }, Ct);

        Assert.Equal(409, StatusOf(result));
        Assert.Equal($"{claim.ClaimReference} is paid, so it can't be marked as partially paid.", RefusalOf(result));
    }

    [Theory]
    [InlineData(0.015, null)]
    [InlineData(null, 10.005)]
    public async Task AnAmountWithMoreThanTwoDecimals_IsRefused_AndNothingIsWritten(double? hours, double? price)
    {
        var (db, controller) = Create();
        var (claim, line, _) = Seed(db, TripClaimStatus.Draft);

        var result = await controller.UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Hours = (decimal?)hours, UnitPrice = (decimal?)price }, Ct);

        Assert.Equal(400, StatusOf(result));
        db.ChangeTracker.Clear();
        var stored = await db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == line.Id);
        Assert.Equal((2m, 50m, 100m), (stored.Hours, stored.UnitPrice, stored.TotalAmount));
    }
}
