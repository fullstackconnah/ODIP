using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// RosteringController's shift-completion review surface (design spec §2/§3): completions
/// list/detail, Approve/Return, ReturnCount increments, IsActive flips across a
/// Return-then-resubmit cycle. Class-level [Authorize(Roles=...)] coverage already lives in
/// RosteringControllerTests.RosteringController_AuthorizeAttribute_RestrictsToCoordinatorAndAbove
/// — this file only confirms the new actions don't carry a stray per-action override.
/// </summary>
public class RosteringCompletionReviewTests
{
    private static readonly DateOnly ServiceDate = new(2026, 9, 8);
    private static readonly Guid ReviewerId = Guid.NewGuid();

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

    private static RosteringController MakeController(OdipDbContext db, IConfiguration? config = null)
    {
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, ReviewerId.ToString())], "Test");
        return new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), config)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
    }

    private static T Seed<T>(OdipDbContext db, T entity) where T : class
    {
        db.Set<T>().Add(entity);
        db.SaveChanges();
        return entity;
    }

    private static User SeedStaff(OdipDbContext db) => Seed(db, new User
    {
        Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
        Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
    });

    private static Participant SeedParticipant(OdipDbContext db) => Seed(db, new Participant
    {
        Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true,
    });

    private static Shift SeedShift(OdipDbContext db, Guid participantId, Guid staffId, ShiftStatus status) => Seed(db, new Shift
    {
        Id = Guid.NewGuid(), ParticipantId = participantId, UserId = staffId, ServiceDate = ServiceDate,
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
        NightType = SleepoverType.None, Status = status,
    });

    private static ShiftCompletion SeedCompletion(OdipDbContext db, Guid shiftId, Guid staffId, bool isActive = true) => Seed(db, new ShiftCompletion
    {
        Id = Guid.NewGuid(), ShiftId = shiftId, ActualStart = DateTime.UtcNow.AddHours(-8),
        ActualEnd = DateTime.UtcNow, TimeZoneId = "Australia/Sydney", SubmittedByUserId = staffId,
        StartedAt = DateTime.UtcNow.AddHours(-8), SubmittedAt = DateTime.UtcNow, IsActive = isActive,
    });

    // ── Completions list/detail ──────────────────────────────────────

    [Fact]
    public async Task GetCompletions_DefaultsToPendingReview_ReturnsQueueItemWithVariance()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        // Rostered 09:00-17:00 Australia/Sydney on 8 Sep 2026 = 23:00 7 Sep UTC .. 07:00 8 Sep UTC.
        var completion = Seed(db, new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id,
            ActualStart = new DateTime(2026, 9, 7, 23, 10, 0, DateTimeKind.Utc),
            ActualEnd = new DateTime(2026, 9, 8, 7, 0, 0, DateTimeKind.Utc),
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id,
            StartedAt = new DateTime(2026, 9, 7, 23, 10, 0, DateTimeKind.Utc),
            SubmittedAt = new DateTime(2026, 9, 8, 7, 0, 0, DateTimeKind.Utc),
            VarianceMinutesStart = 10, VarianceMinutesEnd = 0, IsActive = true,
        });
        var controller = MakeController(db);

        var result = await controller.GetCompletions(null, null, null, 1, 50, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(ok.Value);
        var item = Assert.Single(body.Data!.Items);
        Assert.Equal(shift.Id, item.ShiftId);
        Assert.Equal(completion.Id, item.CompletionId);
        Assert.Equal(10, item.VarianceMinutesStart);
        Assert.Equal(ShiftStatus.PendingReview, item.Status);
    }

    [Fact]
    public async Task GetCompletions_StatusFilter_ExcludesOtherStatuses()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var pending = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        SeedCompletion(db, pending.Id, staff.Id);
        var inProgress = SeedShift(db, participant.Id, staff.Id, ShiftStatus.InProgress);
        SeedCompletion(db, inProgress.Id, staff.Id);
        var controller = MakeController(db);

        var result = await controller.GetCompletions(ShiftStatus.InProgress, null, null, 1, 50, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(ok.Value);
        var item = Assert.Single(body.Data!.Items);
        Assert.Equal(inProgress.Id, item.ShiftId);
    }

    [Fact]
    public async Task GetCompletions_VarianceWithinThreshold_IsOutlierVarianceFalse()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        Seed(db, new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id,
            ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow,
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id,
            StartedAt = DateTime.UtcNow.AddHours(-8), SubmittedAt = DateTime.UtcNow,
            VarianceMinutesStart = 10, VarianceMinutesEnd = -5, IsActive = true, // both < 15
        });
        var controller = MakeController(db);

        var result = await controller.GetCompletions(null, null, null, 1, 50, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(ok.Value);
        var item = Assert.Single(body.Data!.Items);
        Assert.False(item.IsOutlierVariance);
        Assert.Equal(15, item.VarianceReviewMinutes);
        Assert.Equal("Australia/Sydney", item.TimeZoneId);
        Assert.Equal(0, item.ReturnCount);
    }

    [Fact]
    public async Task GetCompletions_VarianceOverThreshold_IsOutlierVarianceTrue()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        shift.ReturnCount = 2;
        db.SaveChanges();
        Seed(db, new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id,
            ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow,
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id,
            StartedAt = DateTime.UtcNow.AddHours(-8), SubmittedAt = DateTime.UtcNow,
            VarianceMinutesStart = 16, VarianceMinutesEnd = 0, IsActive = true, // > 15
        });
        var controller = MakeController(db);

        var result = await controller.GetCompletions(null, null, null, 1, 50, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(ok.Value);
        var item = Assert.Single(body.Data!.Items);
        Assert.True(item.IsOutlierVariance);
        Assert.Equal(2, item.ReturnCount);
    }

    [Fact]
    public async Task GetCompletions_SortsOutliersBeforeNonOutliers_ThenByServiceDate()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);

        var early = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview); // 2026-09-08, clean
        Seed(db, new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = early.Id, ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow,
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id, StartedAt = DateTime.UtcNow.AddHours(-8),
            SubmittedAt = DateTime.UtcNow, VarianceMinutesStart = 0, VarianceMinutesEnd = 0, IsActive = true,
        });

        var late = Seed(db, new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = ServiceDate.AddDays(3),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.PendingReview,
        });
        db.SaveChanges();
        Seed(db, new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = late.Id, ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow,
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id, StartedAt = DateTime.UtcNow.AddHours(-8),
            SubmittedAt = DateTime.UtcNow, VarianceMinutesStart = 30, VarianceMinutesEnd = 0, IsActive = true, // outlier, later date
        });
        var controller = MakeController(db);

        var result = await controller.GetCompletions(null, null, null, 1, 50, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(ok.Value);
        Assert.Equal(2, body.Data!.Items.Count);
        Assert.Equal(late.Id, body.Data.Items[0].ShiftId); // outlier first despite later date
        Assert.Equal(early.Id, body.Data.Items[1].ShiftId);
    }

    [Fact]
    public async Task GetCompletions_ThresholdFromConfig_OverridesDefault()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        Seed(db, new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id,
            ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow,
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id,
            StartedAt = DateTime.UtcNow.AddHours(-8), SubmittedAt = DateTime.UtcNow,
            VarianceMinutesStart = 20, VarianceMinutesEnd = 0, IsActive = true, // > default 15, < overridden 30
        });
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Rostering:VarianceReviewMinutes"] = "30" })
            .Build();
        var controller = MakeController(db, config);

        var result = await controller.GetCompletions(null, null, null, 1, 50, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(ok.Value);
        var item = Assert.Single(body.Data!.Items);
        Assert.False(item.IsOutlierVariance); // 20 <= 30, no longer an outlier once the threshold is overridden
        Assert.Equal(30, item.VarianceReviewMinutes);
    }

    [Fact]
    public async Task GetShiftCompletion_ActiveRowExists_ReturnsDto()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        var completion = SeedCompletion(db, shift.Id, staff.Id);
        var controller = MakeController(db);

        var result = await controller.GetShiftCompletion(shift.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(ok.Value);
        Assert.Equal(completion.Id, body.Data!.Id);
    }

    [Fact]
    public async Task GetShiftCompletion_NoActiveRow_Returns404()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.Published);
        var controller = MakeController(db);

        var result = await controller.GetShiftCompletion(shift.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    // ── Authorisation posture ────────────────────────────────────────

    [Theory]
    [InlineData(nameof(RosteringController.ApproveCompletion))]
    [InlineData(nameof(RosteringController.ReturnCompletion))]
    public void CompletionAction_CarriesNoPerActionAuthorizeOverride_ReliesOnClassLevelGate(string methodName)
    {
        var method = typeof(RosteringController).GetMethod(methodName)!;
        Assert.Null(method.GetCustomAttribute<AuthorizeAttribute>());
    }

    // ── Approve ───────────────────────────────────────────────────────

    [Fact]
    public async Task ApproveCompletion_PendingReview_FlipsCompleted_StampsReviewer()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        var completion = SeedCompletion(db, shift.Id, staff.Id);
        var controller = MakeController(db);

        var result = await controller.ApproveCompletion(shift.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(ok.Value);
        Assert.Equal(ReviewOutcome.Approved, body.Data!.ReviewOutcome);

        var savedShift = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal(ShiftStatus.Completed, savedShift.Status);
        var savedCompletion = await db.ShiftCompletions.SingleAsync(c => c.Id == completion.Id);
        Assert.Equal(ReviewOutcome.Approved, savedCompletion.ReviewOutcome);
        Assert.Equal(ReviewerId, savedCompletion.ReviewedByUserId);
        Assert.True(savedCompletion.IsActive); // Approve never touches IsActive.
    }

    [Fact]
    public async Task ApproveCompletion_ShiftNotPendingReview_Returns409()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.InProgress);
        SeedCompletion(db, shift.Id, staff.Id);
        var controller = MakeController(db);

        var result = await controller.ApproveCompletion(shift.Id, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(conflict.Value);
        Assert.Equal("SHIFT_NOT_PENDING_REVIEW", body.Code);
    }

    [Fact]
    public async Task ApproveCompletion_NoShift_Returns404()
    {
        using var db = CreateDb();
        var controller = MakeController(db);

        var result = await controller.ApproveCompletion(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task ApproveCompletion_NoActiveCompletion_Returns404()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        var controller = MakeController(db);

        var result = await controller.ApproveCompletion(shift.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    // ── Return ────────────────────────────────────────────────────────

    [Fact]
    public async Task ReturnCompletion_PendingReview_WithReason_FlipsPublished_IncrementsReturnCount_DeactivatesCompletion()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        var completion = SeedCompletion(db, shift.Id, staff.Id);
        var controller = MakeController(db);

        var result = await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = "Times look wrong, please recheck." }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(ok.Value);
        Assert.Equal(ReviewOutcome.Returned, body.Data!.ReviewOutcome);
        Assert.Equal("Times look wrong, please recheck.", body.Data.ReturnReason);

        var savedShift = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal(ShiftStatus.Published, savedShift.Status);
        Assert.Equal(1, savedShift.ReturnCount);
        var savedCompletion = await db.ShiftCompletions.SingleAsync(c => c.Id == completion.Id);
        Assert.False(savedCompletion.IsActive);
    }

    [Fact]
    public async Task ReturnCompletion_BlankReason_Returns400_DoesNotChangeShiftOrCompletion()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        SeedCompletion(db, shift.Id, staff.Id);
        var controller = MakeController(db);

        var result = await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = "   " }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        var savedShift = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal(ShiftStatus.PendingReview, savedShift.Status);
        Assert.Equal(0, savedShift.ReturnCount);
    }

    [Fact]
    public async Task ReturnCompletion_EmptyReason_Returns400WithCode()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        var completion = SeedCompletion(db, shift.Id, staff.Id);
        var controller = MakeController(db);

        var result = await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = "" }, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(badRequest.Value);
        Assert.Equal("A return reason is required.", body.Errors!.Single());
        Assert.Equal("SHIFT_RETURN_REASON_REQUIRED", body.Code);

        var savedCompletion = await db.ShiftCompletions.SingleAsync(c => c.Id == completion.Id);
        Assert.True(savedCompletion.IsActive);
    }

    [Fact]
    public async Task ReturnCompletion_ReasonOver500Chars_Returns400SHIFT_RETURN_REASON_TOO_LONG()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        SeedCompletion(db, shift.Id, staff.Id);
        var controller = MakeController(db);
        var tooLong = new string('a', 501);

        var result = await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = tooLong }, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(badRequest.Value);
        Assert.Equal("SHIFT_RETURN_REASON_TOO_LONG", body.Code);
    }

    [Fact]
    public async Task ReturnCompletion_ReasonExactly500Chars_Accepted()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        var completion = SeedCompletion(db, shift.Id, staff.Id);
        var controller = MakeController(db);
        var exactly500 = new string('a', 500);

        var result = await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = exactly500 }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(ok.Value);
        Assert.Equal(ReviewOutcome.Returned, body.Data!.ReviewOutcome);

        var saved = await db.ShiftCompletions.SingleAsync(c => c.Id == completion.Id);
        Assert.Equal(exactly500, saved.ReturnReason);
    }

    [Fact]
    public async Task ReturnCompletion_ReasonWithSurroundingWhitespace_IsTrimmedBeforeSaving()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        var completion = SeedCompletion(db, shift.Id, staff.Id);
        var controller = MakeController(db);

        await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = "  Recheck please.  " }, CancellationToken.None);

        var saved = await db.ShiftCompletions.SingleAsync(c => c.Id == completion.Id);
        Assert.Equal("Recheck please.", saved.ReturnReason);
    }

    [Fact]
    public async Task GetShiftCompletions_ReturnsActiveAndInactive_NewestFirst()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        var older = Seed(db, new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = DateTime.UtcNow.AddDays(-2),
            ActualEnd = DateTime.UtcNow.AddDays(-2).AddHours(8), TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = staff.Id, StartedAt = DateTime.UtcNow.AddDays(-2),
            SubmittedAt = DateTime.UtcNow.AddDays(-2).AddHours(8), IsActive = false,
            ReviewOutcome = ReviewOutcome.Returned, ReturnReason = "First attempt was off.",
        });
        var newer = SeedCompletion(db, shift.Id, staff.Id, isActive: true);
        var controller = MakeController(db);

        var result = await controller.GetShiftCompletions(shift.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<ShiftCompletionDto>>>(ok.Value);
        Assert.Equal(2, body.Data!.Count);
        Assert.Equal(newer.Id, body.Data[0].Id);
        Assert.Equal(older.Id, body.Data[1].Id);
    }

    [Fact]
    public async Task GetShiftCompletions_NoCompletions_Returns404()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.Published);
        var controller = MakeController(db);

        var result = await controller.GetShiftCompletions(shift.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task ReturnCompletion_ShiftNotPendingReview_Returns409()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.Published);
        var controller = MakeController(db);

        var result = await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = "reason" }, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(conflict.Value);
        Assert.Equal("SHIFT_NOT_PENDING_REVIEW", body.Code);
    }

    [Fact]
    public async Task ReturnThenResubmit_OldCompletionStaysInactive_NewActiveRowCreated()
    {
        using var db = CreateDb();
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
        var firstCompletion = SeedCompletion(db, shift.Id, staff.Id);
        var rosteringController = MakeController(db);

        await rosteringController.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = "Recheck please." }, CancellationToken.None);

        // Worker resubmits via Start — reuse PortalController directly against the same db.
        var portalTenant = new Mock<ICurrentTenant>();
        portalTenant.Setup(t => t.TenantId).Returns((Guid?)null);
        portalTenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var portalIdentity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, staff.Id.ToString())], "Test");
        var portalController = new PortalController(db, portalTenant.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(portalIdentity) }
            }
        };
        await portalController.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

        var allCompletions = await db.ShiftCompletions.Where(c => c.ShiftId == shift.Id).ToListAsync();
        Assert.Equal(2, allCompletions.Count);
        var old = allCompletions.Single(c => c.Id == firstCompletion.Id);
        Assert.False(old.IsActive);
        var fresh = allCompletions.Single(c => c.Id != firstCompletion.Id);
        Assert.True(fresh.IsActive);
    }

    // ── Cross-tenant isolation (F9) ──────────────────────────────────

    [Fact]
    public async Task ApproveCompletion_OtherTenant_Returns404()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        // Seed under tenant B — a real (non-super-admin) tenant context so SaveChangesAsync
        // auto-stamps TenantId on every ITenantEntity row (see OdipDbContext.SaveChangesAsync).
        var tenantBContext = new Mock<ICurrentTenant>();
        tenantBContext.Setup(t => t.TenantId).Returns(tenantB);
        tenantBContext.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        Guid shiftId, completionId;
        using (var seedDb = new OdipDbContext(options, tenantBContext.Object))
        {
            var staff = SeedStaff(seedDb);
            var participant = SeedParticipant(seedDb);
            var shift = SeedShift(seedDb, participant.Id, staff.Id, ShiftStatus.PendingReview);
            var completion = SeedCompletion(seedDb, shift.Id, staff.Id);
            shiftId = shift.Id;
            completionId = completion.Id;
        }

        // Query as tenant A — same pattern as CurrentTenantTests, but scoped (non-super-admin).
        var tenantAContext = new Mock<ICurrentTenant>();
        tenantAContext.Setup(t => t.TenantId).Returns(tenantA);
        tenantAContext.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(options, tenantAContext.Object);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, ReviewerId.ToString())], "Test");
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };

        var result = await controller.ApproveCompletion(shiftId, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);

        // Verify tenant B's data is untouched — read back with a super-admin context so the
        // tenant filter doesn't hide it.
        var superAdminContext = new Mock<ICurrentTenant>();
        superAdminContext.Setup(t => t.TenantId).Returns((Guid?)null);
        superAdminContext.Setup(t => t.IsSuperAdmin).Returns(true);
        using var verifyDb = new OdipDbContext(options, superAdminContext.Object);
        var completionAfter = await verifyDb.ShiftCompletions.SingleAsync(c => c.Id == completionId);
        Assert.Null(completionAfter.ReviewedByUserId);
        Assert.Null(completionAfter.ReviewOutcome);
        var shiftAfter = await verifyDb.Shifts.SingleAsync(s => s.Id == shiftId);
        Assert.Equal(ShiftStatus.PendingReview, shiftAfter.Status);
    }

    [Fact]
    public async Task GetShiftCompletions_OtherTenant_Returns404()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        // Seed under tenant B — a real (non-super-admin) tenant context so SaveChangesAsync
        // auto-stamps TenantId on every ITenantEntity row (see OdipDbContext.SaveChangesAsync).
        var tenantBContext = new Mock<ICurrentTenant>();
        tenantBContext.Setup(t => t.TenantId).Returns(tenantB);
        tenantBContext.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        Guid shiftId;
        using (var seedDb = new OdipDbContext(options, tenantBContext.Object))
        {
            var staff = SeedStaff(seedDb);
            var participant = SeedParticipant(seedDb);
            var shift = SeedShift(seedDb, participant.Id, staff.Id, ShiftStatus.PendingReview);
            SeedCompletion(seedDb, shift.Id, staff.Id);
            shiftId = shift.Id;
        }

        // Query as tenant A — same pattern as ApproveCompletion_OtherTenant_Returns404, but scoped (non-super-admin).
        var tenantAContext = new Mock<ICurrentTenant>();
        tenantAContext.Setup(t => t.TenantId).Returns(tenantA);
        tenantAContext.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(options, tenantAContext.Object);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, ReviewerId.ToString())], "Test");
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };

        var result = await controller.GetShiftCompletions(shiftId, CancellationToken.None);

        // Same 404-not-403 envelope shape as GetShiftCompletions_NoCompletions_Returns404 — the
        // tenant filter hides tenant B's completions entirely, so this is indistinguishable from
        // "no completions for this shift" rather than a distinct "forbidden" response.
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }
}
