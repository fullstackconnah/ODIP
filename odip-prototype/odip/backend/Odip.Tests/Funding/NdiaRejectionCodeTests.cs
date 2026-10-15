using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// Marking a claim Rejected can carry the NDIA's code (budget phase 2b): V17, V18, V27 or V28 say the money ran out, anything else is kept as typed. The code and the moment the claim
/// was rejected are stored on the claim, travel with its audit row (TripClaim is audited by the generic interceptor, which is the REAL one here) and come back on the claim detail.
/// The clock is the funding tests' fixed one (4 Oct 2026, 03:00 UTC).
/// </summary>
public class NdiaRejectionCodeTests
{
    private static readonly Guid TenantA = FundingTestKit.TenantA;

    private sealed class Kit : IDisposable
    {
        public OdipDbContext Db { get; }
        public ClaimsController Controller { get; }
        public FakeClock Clock { get; }

        private Kit(OdipDbContext db, ClaimsController controller, FakeClock clock)
        {
            Db = db;
            Controller = controller;
            Clock = clock;
        }

        public static Kit Create()
        {
            var tenant = new Mock<ICurrentTenant>();
            tenant.Setup(t => t.TenantId).Returns(TenantA);
            tenant.Setup(t => t.IsSuperAdmin).Returns(false);
            var principal = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, FundingTestKit.UserId.ToString()), new Claim("fullName", "Ada Admin") }, "Test"));
            var accessor = new Mock<IHttpContextAccessor>();
            accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = principal });
            var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).AddInterceptors(new AuditInterceptor(accessor.Object)).Options;
            var db = new OdipDbContext(options, tenant.Object);
            var clock = new FakeClock(FundingTestKit.Now);
            var controller = new ClaimsController(db, new ClaimGenerationService(db), new ShiftClaimGenerationService(db), new BprCsvService(db), new InvoiceService(db), new BudgetLedgerService(db, clock), tenant.Object, clock);
            return new Kit(db, controller, clock);
        }

        public void Dispose() => Db.Dispose();

        public TripClaim SeedClaim(TripClaimStatus status = TripClaimStatus.Submitted)
        {
            // A claim belongs to its organisation through its participant, which is what the claim endpoints now check.
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Ada", LastName = "Claim" };
            var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id, Status = status, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = 400m };
            Db.Participants.Add(participant);
            Db.TripClaims.Add(claim);
            Db.SaveChanges();
            ClearAudit();
            return claim;
        }

        public void ClearAudit()
        {
            Db.AuditLogs.RemoveRange(Db.AuditLogs.ToList());
            Db.SaveChanges();
        }

        public async Task<ActionResult<ApiResponse<bool>>> PutAsync(Guid claimId, TripClaimStatus? status = null, string? code = null) =>
            await Controller.UpdateClaim(claimId, new UpdateClaimDto { Status = status, RejectionCode = code }, CancellationToken.None);

        public Task<TripClaim> ReloadAsync(Guid claimId)
        {
            Db.ChangeTracker.Clear();
            return Db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claimId);
        }
    }

    private static int StatusOf(ActionResult<ApiResponse<bool>> result) => Assert.IsAssignableFrom<ObjectResult>(result.Result).StatusCode ?? 200;

    // ── Storing the code ────────────────────────────────────────────────────

    [Fact]
    public async Task MarkRejected_WithAnNdiaCode_StoresTheCode_AndTheMomentItWasRejected()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();

        Assert.Equal(200, StatusOf(await kit.PutAsync(claim.Id, TripClaimStatus.Rejected, "V27")));

        var stored = await kit.ReloadAsync(claim.Id);
        Assert.Equal(TripClaimStatus.Rejected, stored.Status);
        Assert.Equal("V27", stored.RejectionCode);
        Assert.Equal(FundingTestKit.Now.UtcDateTime, stored.RejectedDate);
    }

    [Theory]
    [InlineData("v17", "V17")]
    [InlineData("V18", "V18")]
    [InlineData("  v28 ", "V28")]
    public async Task TheFourFundsCodes_AreKeptInCapitals_WhateverWayTheyWereTyped(string typed, string stored)
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();

        await kit.PutAsync(claim.Id, TripClaimStatus.Rejected, typed);

        Assert.Equal(stored, (await kit.ReloadAsync(claim.Id)).RejectionCode);
    }

    [Fact]
    public async Task AnyOtherCode_IsKeptAsTyped_TrimmedAndNotCapitalised()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();

        await kit.PutAsync(claim.Id, TripClaimStatus.Rejected, "  C16 dates ");

        Assert.Equal("C16 dates", (await kit.ReloadAsync(claim.Id)).RejectionCode);
    }

    [Fact]
    public async Task MarkRejected_WithNoCode_LeavesTheCodeNull_AndStillStampsTheMoment()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();

        await kit.PutAsync(claim.Id, TripClaimStatus.Rejected);

        var stored = await kit.ReloadAsync(claim.Id);
        Assert.Null(stored.RejectionCode);
        Assert.Equal(FundingTestKit.Now.UtcDateTime, stored.RejectedDate);
    }

    [Fact]
    public async Task ACodeCanBeAddedLaterToAClaimThatIsAlreadyRejected_WithoutMovingTheMoment()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();
        await kit.PutAsync(claim.Id, TripClaimStatus.Rejected);
        kit.Clock.Set(FundingTestKit.Now.AddDays(2));

        Assert.Equal(200, StatusOf(await kit.PutAsync(claim.Id, code: "V18")));

        var stored = await kit.ReloadAsync(claim.Id);
        Assert.Equal("V18", stored.RejectionCode);
        Assert.Equal(FundingTestKit.Now.UtcDateTime, stored.RejectedDate);
    }

    [Fact]
    public async Task AnEmptyCode_ClearsTheCode()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();
        await kit.PutAsync(claim.Id, TripClaimStatus.Rejected, "V17");

        await kit.PutAsync(claim.Id, code: "  ");

        Assert.Null((await kit.ReloadAsync(claim.Id)).RejectionCode);
    }

    [Fact]
    public async Task LeavingRejected_TakesTheCodeAndTheMomentWithIt()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();
        await kit.PutAsync(claim.Id, TripClaimStatus.Rejected, "V27");

        await kit.PutAsync(claim.Id, TripClaimStatus.Submitted);

        var stored = await kit.ReloadAsync(claim.Id);
        Assert.Equal(TripClaimStatus.Submitted, stored.Status);
        Assert.Null(stored.RejectionCode);
        Assert.Null(stored.RejectedDate);
    }

    // ── Refusals ────────────────────────────────────────────────────────────

    [Fact]
    public async Task ACodeLongerThanTenCharacters_IsRefused_AndNothingIsWritten()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();

        Assert.Equal(400, StatusOf(await kit.PutAsync(claim.Id, TripClaimStatus.Rejected, "ELEVEN CHAR")));

        var stored = await kit.ReloadAsync(claim.Id);
        Assert.Equal(TripClaimStatus.Submitted, stored.Status);
        Assert.Null(stored.RejectionCode);
    }

    [Fact]
    public async Task ACodeWithAControlCharacter_IsRefused()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();

        Assert.Equal(400, StatusOf(await kit.PutAsync(claim.Id, TripClaimStatus.Rejected, "V2\u00007")));
    }

    [Fact]
    public async Task ACodeOnAClaimThatIsNotRejected_IsRefused_InWords()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim(TripClaimStatus.Draft);

        var result = await kit.PutAsync(claim.Id, code: "V27");

        Assert.Equal(400, StatusOf(result));
        var body = Assert.IsType<ApiResponse<bool>>(Assert.IsAssignableFrom<ObjectResult>(result.Result).Value);
        Assert.Contains("rejected", string.Join(" ", body.Errors ?? new List<string>()), StringComparison.OrdinalIgnoreCase);
        Assert.Null((await kit.ReloadAsync(claim.Id)).RejectionCode);
    }

    [Fact]
    public async Task ACodeWithAStatusThatIsNotRejected_IsRefused()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();

        Assert.Equal(400, StatusOf(await kit.PutAsync(claim.Id, TripClaimStatus.Paid, "V27")));
        Assert.Equal(TripClaimStatus.Submitted, (await kit.ReloadAsync(claim.Id)).Status);
    }

    // ── The audit row ───────────────────────────────────────────────────────

    [Fact]
    public async Task TheAuditRowOfTheClaim_CarriesTheCode()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();

        await kit.PutAsync(claim.Id, TripClaimStatus.Rejected, "V28");

        var row = Assert.Single(await kit.Db.AuditLogs.Where(a => a.EntityType == nameof(TripClaim) && a.EntityId == claim.Id).ToListAsync());
        Assert.Equal(AuditAction.Updated, row.Action);
        var changes = JsonSerializer.Deserialize<List<JsonElement>>(row.Changes)!;
        var code = Assert.Single(changes, c => c.GetProperty("Field").GetString() == "RejectionCode");
        Assert.Equal("V28", code.GetProperty("New").GetString());
        Assert.Contains(changes, c => c.GetProperty("Field").GetString() == "Status" && c.GetProperty("New").GetString() == "Rejected");
    }

    // ── The other way a claim becomes rejected, and what the detail says ────

    [Fact]
    public async Task WhenEveryLineIsRejected_TheClaimIsRejectedAndTheMomentIsStamped()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();
        var shift = new Shift { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = Guid.NewGuid(), ServiceDate = new DateOnly(2026, 10, 1), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Status = ShiftStatus.Completed };
        kit.Db.Shifts.Add(shift);
        var line = new ClaimLineItem { Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shift.Id, SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday, SupportsDeliveredFrom = shift.ServiceDate, SupportsDeliveredTo = shift.ServiceDate, Hours = 8m, UnitPrice = 50m, TotalAmount = 400m };
        kit.Db.ClaimLineItems.Add(line);
        await kit.Db.SaveChangesAsync();

        await kit.Controller.UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Rejected, RejectionReason = "Not funded" }, CancellationToken.None);

        var stored = await kit.ReloadAsync(claim.Id);
        Assert.Equal(TripClaimStatus.Rejected, stored.Status);
        Assert.Null(stored.RejectionCode);
        Assert.Equal(FundingTestKit.Now.UtcDateTime, stored.RejectedDate);
    }

    [Fact]
    public async Task TheClaimDetail_SaysWhichCodeAndWhenTheNdiaRejectedIt()
    {
        using var kit = Kit.Create();
        var claim = kit.SeedClaim();
        await kit.PutAsync(claim.Id, TripClaimStatus.Rejected, "V17");

        var result = await kit.Controller.GetClaim(claim.Id, CancellationToken.None);

        var detail = Assert.IsType<TripClaimDetailDto>(Assert.IsType<ApiResponse<TripClaimDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data);
        Assert.Equal("V17", detail.RejectionCode);
        Assert.Equal(FundingTestKit.Now.UtcDateTime, detail.RejectedDate);
    }

    [Fact]
    public void UpdatingAClaim_StaysWithAdminCoordinatorAndSuperAdmin()
    {
        var method = typeof(ClaimsController).GetMethod(nameof(ClaimsController.UpdateClaim))!;
        var roles = method.GetCustomAttribute<AuthorizeAttribute>()!.Roles!.Split(',').Select(r => r.Trim()).ToHashSet();

        Assert.Equal(new[] { "Admin", "Coordinator", "SuperAdmin" }, roles.OrderBy(r => r, StringComparer.Ordinal));
    }

    // ── The codes themselves ────────────────────────────────────────────────

    [Theory]
    [InlineData("V17", true)]
    [InlineData("V18", true)]
    [InlineData("V27", true)]
    [InlineData("V28", true)]
    [InlineData("v27", true)]
    [InlineData("V16", false)]
    [InlineData("V270", false)]
    [InlineData("Other", false)]
    [InlineData(null, false)]
    public void OnlyTheFourFundsCodes_SayTheMoneyRanOut(string? code, bool expected) =>
        Assert.Equal(expected, NdiaRejectionCodes.MeansNotEnoughFunds(code));
}
