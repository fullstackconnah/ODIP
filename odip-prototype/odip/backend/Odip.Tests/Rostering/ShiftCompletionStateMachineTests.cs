using System.Security.Claims;
using Microsoft.AspNetCore.Http;
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
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// PortalController Start/Finish state-machine coverage (design spec §3) — every transition a
/// worker can trigger, the double-start/finish-before-start/finish-with-no-notes 409s, and the
/// assigned-worker-only 404 guard. Approve/Return coverage lives in
/// RosteringCompletionReviewTests. Same EF InMemory + Moq&lt;ICurrentTenant&gt; +
/// NameIdentifier-claim pattern as PortalControllerTests.
/// </summary>
public class ShiftCompletionStateMachineTests
{
    private static readonly DateOnly ServiceDate = new(2026, 9, 8);

    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return (new OdipDbContext(options, tenant.Object), tenant);
    }

    private static PortalController MakeController(OdipDbContext db, ICurrentTenant tenant, Guid callerUserId)
    {
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, callerUserId.ToString())], "Test");
        return new PortalController(db, tenant)
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

    private static User SeedUser(OdipDbContext db) => Seed(db, new User
    {
        Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
        Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
    });

    private static Participant SeedParticipant(OdipDbContext db) => Seed(db, new Participant
    {
        Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true,
    });

    private static Shift SeedShift(OdipDbContext db, Guid participantId, Guid staffId, ShiftStatus status = ShiftStatus.Published) => Seed(db, new Shift
    {
        Id = Guid.NewGuid(), ParticipantId = participantId, UserId = staffId, ServiceDate = ServiceDate,
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
        NightType = SleepoverType.None, Status = status,
    });

    // ══════════════════════════════════════════════════════════════
    // START
    // ══════════════════════════════════════════════════════════════

    [Fact]
    public async Task StartShift_PublishedOwnShift_CreatesActiveCompletion_FlipsInProgress()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
        Assert.Equal(ShiftStatus.InProgress, body.Data!.Status);
        Assert.NotNull(body.Data.Completion);
        Assert.False(body.Data.Completion!.StartWasManual);

        var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal(ShiftStatus.InProgress, saved.Status);
        var completion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shift.Id);
        Assert.True(completion.IsActive);
        Assert.Equal(user.Id, completion.SubmittedByUserId);
    }

    [Fact]
    public async Task StartShift_AlreadyInProgress_Returns409SHIFT_NOT_STARTABLE_AndDoesNotDuplicate()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.InProgress);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
        Assert.Equal("SHIFT_NOT_STARTABLE", body.Code);
        Assert.Empty(await db.ShiftCompletions.ToListAsync());
    }

    [Theory]
    [InlineData(ShiftStatus.Draft)]
    [InlineData(ShiftStatus.Cancelled)]
    [InlineData(ShiftStatus.PendingReview)]
    [InlineData(ShiftStatus.Completed)]
    public async Task StartShift_NotPublished_Returns409SHIFT_NOT_STARTABLE(ShiftStatus status)
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, status);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task StartShift_ForeignShift_Returns404NotFound()
    {
        var (db, tenant) = CreateDb();
        var owner = SeedUser(db);
        var caller = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, owner.Id);
        var controller = MakeController(db, tenant.Object, caller.Id);

        var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task StartShift_SetsVarianceMinutesStart()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        // Published, 09:00-17:00 Australia/Sydney on 2026-09-08 -> rostered start 2026-09-07T23:00Z.
        var shift = SeedShift(db, participant.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var completion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shift.Id);
        var rosteredStartUtc = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc);
        var expected = (int)Math.Round((completion.ActualStart - rosteredStartUtc).TotalMinutes);
        Assert.Equal(expected, completion.VarianceMinutesStart);
        Assert.NotEqual(0, completion.VarianceMinutesStart); // real clock is well past the rostered start in these fixtures
    }

    [Fact]
    public async Task StartShift_GeolocationDeclined_RecordsDeclineWithNoCoordinates()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.StartShift(shift.Id, new StartShiftDto { GeolocationDeclined = true }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var completion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shift.Id);
        Assert.True(completion.GeolocationDeclined);
        Assert.Null(completion.StartLatitude);
        Assert.Null(completion.StartLongitude);
    }

    // ══════════════════════════════════════════════════════════════
    // FINISH
    // ══════════════════════════════════════════════════════════════

    private static void AddNote(OdipDbContext db, Guid shiftId, Guid authorId) => Seed(db, new ShiftNote
    {
        Id = Guid.NewGuid(), ShiftId = shiftId, AuthorUserId = authorId, AuthorName = "Ben Turner", Body = "All good today.",
    });

    [Fact]
    public async Task FinishShift_InProgressWithNote_ComputesVariance_FlipsPendingReview()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.InProgress);
        Seed(db, new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id,
            ActualStart = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc), // exactly on time
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = user.Id,
            StartedAt = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc), IsActive = true,
        });
        AddNote(db, shift.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
        Assert.Equal(ShiftStatus.PendingReview, body.Data!.Status);
        Assert.NotNull(body.Data.Completion!.ActualEnd);
        Assert.NotNull(body.Data.Completion.SubmittedAt);
        Assert.Equal(0, body.Data.Completion.VarianceMinutesStart);

        var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal(ShiftStatus.PendingReview, saved.Status);
    }

    [Fact]
    public async Task FinishShift_NoShiftNotes_Returns409SHIFT_NOTE_REQUIRED()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.InProgress);
        Seed(db, new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = DateTime.UtcNow,
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = user.Id, StartedAt = DateTime.UtcNow, IsActive = true,
        });
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
        Assert.Equal("SHIFT_NOTE_REQUIRED", body.Code);
    }

    [Fact]
    public async Task FinishShift_PublishedNoActualStartSupplied_Returns409SHIFT_NOT_IN_PROGRESS()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.Published);
        AddNote(db, shift.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
        Assert.Equal("SHIFT_NOT_IN_PROGRESS", body.Code);
    }

    [Fact]
    public async Task FinishShift_PublishedWithActualStartSupplied_ManualStartPath_CreatesCompletionAndFinishes()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.Published);
        AddNote(db, shift.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);
        var manualStart = DateTime.UtcNow.AddHours(-8);

        var result = await controller.FinishShift(shift.Id, new FinishShiftDto { ActualStart = manualStart }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
        Assert.Equal(ShiftStatus.PendingReview, body.Data!.Status);
        Assert.True(body.Data.Completion!.StartWasManual);

        var completion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shift.Id);
        Assert.Equal(manualStart, completion.ActualStart);
        Assert.True(completion.StartWasManual);
        Assert.NotEqual(manualStart, completion.StartedAt); // StartedAt is the real Finish-time stamp
    }

    [Fact]
    public async Task FinishShift_ManualStart_FutureActualStart_Returns400()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.Published);
        AddNote(db, shift.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);
        var futureStart = DateTime.UtcNow.AddHours(1);

        var result = await controller.FinishShift(shift.Id, new FinishShiftDto { ActualStart = futureStart }, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(badRequest.Value);
        Assert.Equal("SHIFT_ACTUAL_START_INVALID", body.Code);
        Assert.Empty(await db.ShiftCompletions.ToListAsync());
        var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal(ShiftStatus.Published, saved.Status);
    }

    [Fact]
    public async Task FinishShift_ManualStart_ActualStartTooEarly_Returns400()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.Published);
        AddNote(db, shift.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);
        // Rostered start = 2026-09-08 09:00 Australia/Sydney (AEST, no DST) = 2026-09-07T23:00Z.
        var tooEarly = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc).AddHours(-25);

        var result = await controller.FinishShift(shift.Id, new FinishShiftDto { ActualStart = tooEarly }, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(badRequest.Value);
        Assert.Equal("SHIFT_ACTUAL_START_INVALID", body.Code);
        Assert.Empty(await db.ShiftCompletions.ToListAsync());
        var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal(ShiftStatus.Published, saved.Status);
    }

    [Fact]
    public async Task FinishShift_ManualStart_UnspecifiedKind_StoredAsUtc()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.Published);
        AddNote(db, shift.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);
        var unspecified = DateTime.SpecifyKind(new DateTime(2026, 9, 7, 23, 10, 0), DateTimeKind.Unspecified);

        var result = await controller.FinishShift(shift.Id, new FinishShiftDto { ActualStart = unspecified }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var completion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shift.Id);
        Assert.Equal(DateTimeKind.Utc, completion.ActualStart.Kind);
        Assert.Equal(unspecified.Ticks, completion.ActualStart.Ticks);
    }

    [Theory]
    [InlineData(ShiftStatus.Draft)]
    [InlineData(ShiftStatus.Cancelled)]
    [InlineData(ShiftStatus.PendingReview)]
    [InlineData(ShiftStatus.Completed)]
    public async Task FinishShift_NotPublishedOrInProgress_Returns409SHIFT_NOT_IN_PROGRESS(ShiftStatus status)
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, status);
        AddNote(db, shift.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
        Assert.Equal("SHIFT_NOT_IN_PROGRESS", body.Code);
    }

    [Fact]
    public async Task FinishShift_ForeignShift_Returns404NotFound()
    {
        var (db, tenant) = CreateDb();
        var owner = SeedUser(db);
        var caller = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, owner.Id, ShiftStatus.InProgress);
        var controller = MakeController(db, tenant.Object, caller.Id);

        var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }
}
