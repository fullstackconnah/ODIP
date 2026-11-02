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
        var claim = new TripClaim { TenantId = participant.TenantId, Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id, Status = status, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = 130m };
        ClaimLineItem Line(decimal hours, decimal price) => new()
        {
            TenantId = claim.TenantId, Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = Guid.NewGuid(), SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday,
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

    // ── A line's amount is rounded to the cent, half away from zero, and the claim total is the sum of the rounded lines (owner, 2026-10-29) ──

    [Theory]
    [InlineData(0.25, 10.10, 2.53)]
    [InlineData(1.25, 10.10, 12.63)]
    public async Task AnEditedLine_IsRoundedToTheCent_HalfAwayFromZero(double hours, double price, double expected)
    {
        var (db, controller) = Create();
        var (claim, line, _) = Seed(db, TripClaimStatus.Draft);

        await controller.UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Hours = (decimal)hours, UnitPrice = (decimal)price }, Ct);

        db.ChangeTracker.Clear();
        Assert.Equal((decimal)expected, (await db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == line.Id)).TotalAmount);
    }

    [Fact]
    public async Task TheClaimTotalAfterEdits_IsTheSumOfItsRoundedLines_NotTheRoundedSum()
    {
        var (db, controller) = Create();
        var (claim, first, second) = Seed(db, TripClaimStatus.Draft);
        var dto = new UpdateClaimLineItemDto { Hours = 0.25m, UnitPrice = 10.10m };

        await controller.UpdateLineItem(claim.Id, first.Id, dto, Ct);
        await controller.UpdateLineItem(claim.Id, second.Id, dto, Ct);

        db.ChangeTracker.Clear();
        var lines = await db.ClaimLineItems.AsNoTracking().Where(l => l.TripClaimId == claim.Id).ToListAsync();
        Assert.All(lines, l => Assert.Equal(2.53m, l.TotalAmount));
        Assert.Equal(5.06m, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).TotalAmount);
    }

    // ── A claim with a participant funded another way is not submitted to the NDIS ────────────────

    /// <summary>A trip-kind Draft of organisation A with one line per participant (each on their own booking).</summary>
    private static TripClaim SeedTripDraft(OdipDbContext db, params Participant[] participants)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = TenantA };
        var claim = new TripClaim { TenantId = trip.TenantId, Id = Guid.NewGuid(), TripInstanceId = trip.Id, Status = TripClaimStatus.Draft, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = 100m * participants.Length };
        db.AddRange(trip, claim, new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantA, RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Test Provider", Address = "1 Test St", State = "NSW" });
        foreach (var p in participants)
        {
            var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = p.Id, BookingStatus = BookingStatus.Confirmed };
            db.AddRange(p, booking, new ClaimLineItem
            {
                TenantId = claim.TenantId,
                Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = booking.Id, SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday,
                SupportsDeliveredFrom = new DateOnly(2026, 10, 1), SupportsDeliveredTo = new DateOnly(2026, 10, 1), Hours = 2m, UnitPrice = 50m, TotalAmount = 100m,
            });
        }
        db.SaveChanges();
        return claim;
    }

    private static Participant Person(string first, string last, ParticipantFundingSource funding, PlanType plan = PlanType.SelfManaged) =>
        new() { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = first, LastName = last, NdisNumber = "430000007", FundingSource = funding, PlanType = plan };

    [Fact]
    public async Task ADraftTripClaimWithAnOtherFundedParticipant_CannotBeSubmitted_AndNothingIsChanged()
    {
        var (db, controller) = Create();
        var claim = SeedTripDraft(db, Person("Ada", "Ng", ParticipantFundingSource.Ndis), Person("Lee", "Left", ParticipantFundingSource.Other));

        var result = await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct);

        Assert.Equal(409, StatusOf(result));
        Assert.Equal("Lee Left is funded another way, so this claim can't be submitted to the NDIS. Remove their lines or reject the claim.", RefusalOf(result));
        db.ChangeTracker.Clear();
        Assert.Equal(TripClaimStatus.Draft, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).Status);
        Assert.Empty(db.Invoices);
    }

    [Fact]
    public async Task TheRefusalNamesEveryOtherFundedParticipantOnce()
    {
        var (db, controller) = Create();
        var claim = SeedTripDraft(db, Person("Lee", "Left", ParticipantFundingSource.Other), Person("Sam", "Side", ParticipantFundingSource.Other, PlanType.AgencyManaged));

        var result = await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct);

        Assert.Equal(409, StatusOf(result));
        Assert.Equal("Lee Left, Sam Side are funded another way, so this claim can't be submitted to the NDIS. Remove their lines or reject the claim.", RefusalOf(result));
    }

    [Fact]
    public async Task ADraftShiftClaimForAnOtherFundedParticipant_CannotBeSubmitted_AndNothingIsChanged()
    {
        var (db, controller) = Create();
        var (claim, _, _) = Seed(db, TripClaimStatus.Draft);
        (await db.Participants.SingleAsync(p => p.Id == claim.ParticipantId)).FundingSource = ParticipantFundingSource.Other;
        await db.SaveChangesAsync();

        var result = await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct);

        Assert.Equal(409, StatusOf(result));
        Assert.Contains("Ada Claim is funded another way", RefusalOf(result));
        db.ChangeTracker.Clear();
        Assert.Equal(TripClaimStatus.Draft, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).Status);
        Assert.Empty(db.Invoices);
    }

    [Fact]
    public async Task ADraftTripClaimOfNdisFundedParticipants_StillSubmits()
    {
        var (db, controller) = Create();
        var claim = SeedTripDraft(db, Person("Ada", "Ng", ParticipantFundingSource.Ndis), Person("Sam", "Side", ParticipantFundingSource.Ndis));

        Assert.Equal(200, StatusOf(await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct)));
        db.ChangeTracker.Clear();
        Assert.Equal(TripClaimStatus.Submitted, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).Status);
    }

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

    // ── A shift on another claim that counts is never billed twice ────────────────

    /// <summary>A second Draft claim for the same participant holding a counting line for the same shift as <paramref name="line"/> (what Generate claims makes once the first line stops counting).</summary>
    private static TripClaim ReclaimOn(OdipDbContext db, TripClaim from, ClaimLineItem line)
    {
        var other = new TripClaim { TenantId = from.TenantId, Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = from.ParticipantId, Status = TripClaimStatus.Draft, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = line.TotalAmount };
        db.AddRange(other, new ClaimLineItem
        {
            TenantId = other.TenantId,
            Id = Guid.NewGuid(), TripClaimId = other.Id, ShiftId = line.ShiftId, SupportItemCode = line.SupportItemCode, DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = line.SupportsDeliveredFrom, SupportsDeliveredTo = line.SupportsDeliveredTo, Hours = line.Hours, UnitPrice = line.UnitPrice, TotalAmount = line.TotalAmount,
        });
        db.SaveChanges();
        return other;
    }

    [Fact]
    public async Task ARejectedPartOfAShift_CannotBeTakenBack_WhenAnotherClaimHoldsTheShift()   // S1, ruled: a shift over two bands is two parts of one shift
    {
        var (db, controller) = Create();
        var (claim, part0, part1) = Seed(db, TripClaimStatus.Rejected);
        part1.ShiftId = part0.ShiftId;
        (part0.ShiftPart, part1.ShiftPart) = (0, 1);
        part0.Status = part1.Status = ClaimLineItemStatus.Rejected;
        db.SaveChanges();
        var other = ReclaimOn(db, claim, part0);   // claim B, made after both parts were rejected

        var result = await controller.UpdateLineItem(claim.Id, part1.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Draft }, Ct);

        Assert.Equal(409, StatusOf(result));
        Assert.Equal($"This line's shift is already on claim {other.ClaimReference}, so the line can't be taken back.", RefusalOf(result));
        db.ChangeTracker.Clear();
        Assert.Equal(ClaimLineItemStatus.Rejected, (await db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == part1.Id)).Status);
    }

    [Theory]
    [InlineData(TripClaimStatus.Rejected, ClaimLineItemStatus.Draft)]
    [InlineData(TripClaimStatus.Draft, ClaimLineItemStatus.Rejected)]
    public async Task ASubmitWhoseShiftIsOnAnotherCountingClaim_IsRefused_AndNothingIsIssued(TripClaimStatus claimStatus, ClaimLineItemStatus lineStatus)
    {
        var (db, controller) = Create();
        var (claim, first, _) = Seed(db, claimStatus);
        first.Status = lineStatus;
        db.SaveChanges();
        var other = ReclaimOn(db, claim, first);

        var result = await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct);

        Assert.Equal(409, StatusOf(result));
        Assert.Equal($"This claim includes a shift that is already on claim {other.ClaimReference}. Remove it from this claim before submitting.", RefusalOf(result));
        db.ChangeTracker.Clear();
        Assert.Equal(claimStatus, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).Status);
        Assert.Empty(db.Invoices);
    }

    [Fact]
    public async Task ASubmitWhoseShiftsAreOnNoOtherCountingClaim_StillIssues()
    {
        var (db, controller) = Create();
        var (claim, first, _) = Seed(db, TripClaimStatus.Rejected);
        var gone = ReclaimOn(db, claim, first);
        gone.Status = TripClaimStatus.Cancelled;
        db.SaveChanges();

        Assert.Equal(200, StatusOf(await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct)));
        db.ChangeTracker.Clear();
        Assert.Equal(TripClaimStatus.Submitted, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).Status);
        Assert.NotEmpty(db.Invoices);
    }

    [Fact]
    public async Task ARejectedLineCannotLeaveRejected_WhileItsShiftIsOnAnotherCountingClaim()
    {
        var (db, controller) = Create();
        var (claim, first, _) = Seed(db, TripClaimStatus.Submitted);
        first.Status = ClaimLineItemStatus.Rejected;
        db.SaveChanges();
        ReclaimOn(db, claim, first);

        var result = await controller.UpdateLineItem(claim.Id, first.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Paid }, Ct);

        Assert.Equal(409, StatusOf(result));
        db.ChangeTracker.Clear();
        Assert.Equal(ClaimLineItemStatus.Rejected, (await db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == first.Id)).Status);
    }

    // ── A line can't be rejected until its claim has gone to the NDIA ──────────────────────────────

    [Theory]
    [InlineData(TripClaimStatus.Draft)]
    [InlineData(TripClaimStatus.Ready)]
    public async Task ALineCannotBeRejected_WhileItsClaimIsNotYetSubmitted_AndNothingIsWritten(TripClaimStatus status)
    {
        var (db, controller) = Create();
        var (claim, line, _) = Seed(db, status);
        var lineStatus = line.Status;

        var result = await controller.UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Rejected, RejectionReason = "Not funded" }, Ct);

        Assert.Equal(409, StatusOf(result));
        Assert.Equal($"{claim.ClaimReference} hasn't been submitted to the NDIA yet, so its lines can't be marked as rejected.", RefusalOf(result));
        db.ChangeTracker.Clear();
        var stored = await db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == line.Id);
        Assert.Equal((lineStatus, (string?)null), (stored.Status, stored.RejectionReason));
        Assert.Equal(status, (await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).Status);
    }

    [Fact]
    public async Task TheOnlyLineOfADraftClaim_CannotBeRejected()
    {
        var (db, controller) = Create();
        var (claim, only, other) = Seed(db, TripClaimStatus.Draft);
        var lineStatus = only.Status;
        db.ClaimLineItems.Remove(other);
        await db.SaveChangesAsync();

        var result = await controller.UpdateLineItem(claim.Id, only.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Rejected }, Ct);

        Assert.Equal(409, StatusOf(result));
        db.ChangeTracker.Clear();
        Assert.Equal((TripClaimStatus.Draft, lineStatus), ((await db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).Status, (await db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == only.Id)).Status));
    }
}
