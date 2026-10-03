using System.ComponentModel.DataAnnotations;
using System.Globalization;
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
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Tests.Medications;
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

    private static PortalController MakeController(OdipDbContext db, ICurrentTenant tenant, Guid callerUserId, TimeProvider? clock = null)
    {
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, callerUserId.ToString())], "Test");
        return new PortalController(db, tenant, clock: clock)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
    }

    /// <summary>
    /// Audit coverage (critique M12) needs AuditInterceptor wired — CreateDb()/MakeController()
    /// above don't, since most facts in this file don't need it. Same construction as
    /// RosteringCompletionReviewTests.ApproveBatch_Approved_WritesAuditLogPerShiftCompletion.
    /// </summary>
    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant, Mock<IHttpContextAccessor> Accessor) CreateAuditedDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var accessor = new Mock<IHttpContextAccessor>();
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;

        return (new OdipDbContext(options, tenant.Object), tenant, accessor);
    }

    private static PortalController MakeAuditedController(OdipDbContext db, ICurrentTenant tenant, Mock<IHttpContextAccessor> accessor, Guid callerUserId)
    {
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, callerUserId.ToString())], "Test");
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });
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

    [Theory]
    [InlineData(95, false)]
    [InlineData(90.5, false)]
    [InlineData(90, true)]
    [InlineData(-90, true)]
    [InlineData(-90.5, false)]
    public void StartShiftDto_LatitudeOutOfRange_FailsValidation(double latitude, bool expectedValid)
    {
        var dto = new StartShiftDto { Latitude = (decimal)latitude };
        var context = new ValidationContext(dto);
        var results = new List<ValidationResult>();

        var isValid = Validator.TryValidateObject(dto, context, results, validateAllProperties: true);

        Assert.Equal(expectedValid, isValid);
    }

    [Fact]
    public async Task StartShift_AlreadyInProgress_ReturnsCurrentDetail_NoDuplicateCompletion()
    {
        var (db, tenant, accessor) = CreateAuditedDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.InProgress);
        var existing = Seed(db, new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = DateTime.UtcNow.AddHours(-1),
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = user.Id,
            StartedAt = DateTime.UtcNow.AddHours(-1), IsActive = true,
        });
        var controller = MakeAuditedController(db, tenant.Object, accessor, user.Id);
        var auditCountBefore = await db.AuditLogs.CountAsync(); // seeding above already wrote Created rows (User/Shift/ShiftCompletion are all audited)

        var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
        Assert.Equal(ShiftStatus.InProgress, body.Data!.Status);
        Assert.Equal(existing.Id, body.Data.Completion!.Id);

        var completions = await db.ShiftCompletions.Where(c => c.ShiftId == shift.Id).ToListAsync();
        var only = Assert.Single(completions);
        Assert.Equal(existing.Id, only.Id);
        Assert.Equal(existing.ActualStart, only.ActualStart);
        Assert.Equal(existing.StartedAt, only.StartedAt); // idempotent replay must not re-stamp
        Assert.Equal(auditCountBefore, await db.AuditLogs.CountAsync()); // idempotent replay must not write an audit row (critique M12)
    }

    // Early-start guard (PR1 review 4 N1): Start is refused more than PortalController.EarliestStartLeadMinutes
    // before the rostered start. Rostered start is provider-local (no ProviderSettings row => Australia/Sydney).
    // These tests run the controller on a fixed clock. Against the real clock they failed for an hour or two around each daylight-saving
    // change: at 23:18 AEST on Sat 3 Oct 2026 a shift "180 minutes from now" is rostered 03:18 AEDT, and the hour before it,
    // 02:18, does not exist on the wall clock. OrdinaryDayNoon is Tue 8 Sep 2026 12:00 AEST (02:00Z), weeks from either change, so
    // "N minutes from now" is plain wall-clock arithmetic there.
    private static readonly DateTimeOffset OrdinaryDayNoon = new(2026, 9, 8, 2, 0, 0, TimeSpan.Zero);

    private static readonly TimeZoneInfo Sydney = ProviderLocalTime.ResolveZone("Australia/Sydney");

    private static Shift SeedShiftAt(OdipDbContext db, Guid participantId, Guid staffId, DateOnly serviceDate, TimeOnly startTime) => Seed(db, new Shift
    {
        Id = Guid.NewGuid(), ParticipantId = participantId, UserId = staffId,
        ServiceDate = serviceDate, StartTime = startTime,
        EndTime = new TimeOnly(23, 59), Ratio = SupportRatio.OneToOne,
        NightType = SleepoverType.None, Status = ShiftStatus.Published,
    });

    private static Shift SeedShiftStartingIn(OdipDbContext db, Guid participantId, Guid staffId, DateTimeOffset now, TimeSpan fromNow)
    {
        var zone = ProviderLocalTime.ResolveZone(null);
        var local = TimeZoneInfo.ConvertTimeFromUtc(now.UtcDateTime.Add(fromNow), zone);
        return SeedShiftAt(db, participantId, staffId, DateOnly.FromDateTime(local), new TimeOnly(local.Hour, local.Minute));
    }

    [Fact]
    public void EarliestStartLeadMinutes_IsSixty() => Assert.Equal(60, PortalController.EarliestStartLeadMinutes);

    [Fact]
    public async Task StartShift_MoreThanAnHourBeforeRosteredStart_Is409NamingWhenItCanStart()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShiftStartingIn(db, participant.Id, user.Id, OrdinaryDayNoon, TimeSpan.FromMinutes(180));
        var controller = MakeController(db, tenant.Object, user.Id, new FakeClock(OrdinaryDayNoon));

        var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
        Assert.Equal(ShiftErrorCodes.ShiftStartTooEarly, body.Code);
        // Rostered 15:00 (12:00 + 3 hours); Start opens an hour earlier.
        Assert.Equal("It's too early to start this shift. You can start from 2:00 pm on Tue 8 Sep.", Assert.Single(body.Errors!));
        Assert.Empty(await db.ShiftCompletions.ToListAsync());
        Assert.Equal(ShiftStatus.Published, (await db.Shifts.SingleAsync(s => s.Id == shift.Id)).Status);
    }

    [Theory]
    [InlineData(50)]
    [InlineData(0)]
    [InlineData(-240)]
    public async Task StartShift_WithinAnHourOrLate_StillStarts(int minutesUntilStart)
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShiftStartingIn(db, participant.Id, user.Id, OrdinaryDayNoon, TimeSpan.FromMinutes(minutesUntilStart));
        var controller = MakeController(db, tenant.Object, user.Id, new FakeClock(OrdinaryDayNoon));

        var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    // ── "Too early" across Sydney's two daylight-saving changes ──────────────────────────────────
    // The rostered start is a provider-local wall-clock value (ServiceDate + StartTime). StartShift resolves it to a UTC INSTANT
    // (ShiftVarianceCalculator.ResolveRosteredTimesUtc), takes the instant 60 minutes before that, and only then shows it on the
    // provider's wall clock. "StartTime minus 60 minutes on the wall clock", which the real-clock test expected, is a different answer
    // around a change. Each case runs the controller on a fixed clock: one minute before the opening instant
    // Start is refused with exactly the message pinned in the case, and at the opening instant it starts, so the time the message
    // names is the time Start really opens. The opening instants are written in UTC, worked out by hand rather than by the code under test.

    private static async Task AssertStartOpensAt(string serviceDate, string startTime, string opensAtUtc, string expectedClock, string expectedDay)
    {
        var date = DateOnly.ParseExact(serviceDate, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var opensAt = DateTimeOffset.Parse(opensAtUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
        // The time the message names must be a real wall-clock time: one inside a skipped hour never appears on the clock.
        var named = DateTime.ParseExact($"{expectedDay} {date.Year} {expectedClock}", "ddd d MMM yyyy h:mm tt", CultureInfo.InvariantCulture);
        Assert.False(Sydney.IsInvalidTime(named), $"{expectedClock} on {expectedDay} does not exist on the Sydney wall clock");

        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShiftAt(db, participant.Id, user.Id, date, TimeOnly.ParseExact(startTime, "HH:mm", CultureInfo.InvariantCulture));

        var tooEarly = await MakeController(db, tenant.Object, user.Id, new FakeClock(opensAt.AddMinutes(-1)))
            .StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(tooEarly.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
        Assert.Equal(ShiftErrorCodes.ShiftStartTooEarly, body.Code);
        Assert.Equal($"It's too early to start this shift. You can start from {expectedClock} on {expectedDay}.", Assert.Single(body.Errors!));
        Assert.Empty(await db.ShiftCompletions.ToListAsync());

        var onTime = await MakeController(db, tenant.Object, user.Id, new FakeClock(opensAt))
            .StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

        Assert.IsType<OkObjectResult>(onTime.Result);
    }

    // (c) An ordinary day: the instant 60 minutes before is the wall-clock time 60 minutes before.
    [Fact]
    public Task StartShift_TooEarly_OrdinaryDay_NamesAnHourBeforeTheRosteredStart() =>
        AssertStartOpensAt("2026-09-08", "09:00", "2026-09-07T22:00:00Z", "8:00 am", "Tue 8 Sep");

    // (a) The skipped hour. At 2026-10-03T16:00Z (Sun 4 Oct) Sydney clocks jump from 02:00 AEST to 03:00 AEDT, so 02:00-02:59 never appears.
    [Theory]
    // The 2026-10-03 flake. Rostered 03:18 AEDT opens at 15:18Z, which is still AEST and reads 1:18 am: the hour before 03:18 contains the
    // skipped hour, so "03:18 - 60 minutes = 2:18 am" names a time that never exists.
    [InlineData("2026-10-04", "03:18", "2026-10-03T15:18:00Z", "1:18 am", "Sun 4 Oct")]
    // A rostered time inside the skipped hour does not exist either. As everywhere else (ShiftVarianceCalculator, ProviderLocalTime.LocalToUtc)
    // it is moved one hour later, 02:30 -> 03:30 AEDT, so Start opens at the same instant as for a 03:30 start.
    [InlineData("2026-10-04", "02:30", "2026-10-03T15:30:00Z", "1:30 am", "Sun 4 Oct")]
    // Rostered 04:00 AEDT opens at 16:00Z, the instant of the change itself: the first reading of the new offset, 3:00 am.
    [InlineData("2026-10-04", "04:00", "2026-10-03T16:00:00Z", "3:00 am", "Sun 4 Oct")]
    public Task StartShift_TooEarly_SkippedHour_NamesATimeThatExists(
        string serviceDate, string startTime, string opensAtUtc, string expectedClock, string expectedDay) =>
        AssertStartOpensAt(serviceDate, startTime, opensAtUtc, expectedClock, expectedDay);

    // (b) The repeated hour. At 2027-04-03T16:00Z (Sun 4 Apr) Sydney clocks go back from 03:00 AEDT to 02:00 AEST, so 02:00-02:59 happens twice.
    [Theory]
    // A rostered 02:30 is ambiguous. The server resolves it to STANDARD time, the .NET default for an ambiguous time (ShiftVarianceCalculator relies on
    // it, ProviderLocalTime.LocalToUtc documents it): 02:30 AEST, 16:30Z. Start opens an hour earlier, 15:30Z, which is the FIRST 02:30 (AEDT), so the
    // message names 2:30 am, the same reading as the shift's own start, a real hour apart.
    [InlineData("2027-04-04", "02:30", "2027-04-03T15:30:00Z", "2:30 am", "Sun 4 Apr")]
    // Rostered 03:30 AEST (17:30Z) is unambiguous and opens at 16:30Z, the SECOND 02:30 (AEST): the same words as the case above, an hour later.
    [InlineData("2027-04-04", "03:30", "2027-04-03T16:30:00Z", "2:30 am", "Sun 4 Apr")]
    public Task StartShift_TooEarly_RepeatedHour_ResolvesAnAmbiguousTimeToStandardTime(
        string serviceDate, string startTime, string opensAtUtc, string expectedClock, string expectedDay) =>
        AssertStartOpensAt(serviceDate, startTime, opensAtUtc, expectedClock, expectedDay);

    [Theory]
    [InlineData(ShiftStatus.PendingReview, "SHIFT_ALREADY_FINISHED")]
    [InlineData(ShiftStatus.Completed, "SHIFT_ALREADY_COMPLETED")]
    [InlineData(ShiftStatus.Cancelled, "SHIFT_CANCELLED")]
    [InlineData(ShiftStatus.Draft, "SHIFT_NOT_PUBLISHED")]
    public async Task StartShift_NotStartable_ReturnsDistinctCodePerStatus(ShiftStatus status, string expectedCode)
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, status);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
        Assert.Equal(expectedCode, body.Code);
        Assert.Empty(await db.ShiftCompletions.ToListAsync());
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

    /// <summary>NotificationEventType.ShiftCompletionPendingReview trigger — one outbox row per tenant Admin/Coordinator, none for a SupportWorker. docs/specs/2026-09-08-notifications-design.md §5.</summary>
    [Fact]
    public async Task FinishShift_InProgressWithNote_RaisesShiftCompletionPendingReviewForCoordinators()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var coordinator = Seed(db, new User
        {
            Id = Guid.NewGuid(), FirstName = "Cara", LastName = "Coord",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.Coordinator, IsActive = true,
        });
        var otherWorker = Seed(db, new User
        {
            Id = Guid.NewGuid(), FirstName = "Sam", LastName = "Support",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, IsActive = true,
        });
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.InProgress);
        var completion = Seed(db, new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id,
            ActualStart = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc),
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = user.Id,
            StartedAt = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc), IsActive = true,
        });
        AddNote(db, shift.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);

        await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

        var rows = await db.NotificationOutbox.ToListAsync();
        var row = Assert.Single(rows);
        Assert.Equal(NotificationEventType.ShiftCompletionPendingReview, row.EventType);
        Assert.Equal(coordinator.Id, row.RecipientUserId);
        Assert.DoesNotContain(rows, r => r.RecipientUserId == otherWorker.Id);
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
        Assert.Equal("SHIFT_ACTUAL_START_IN_FUTURE", body.Code);
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
        Assert.Equal("SHIFT_ACTUAL_START_TOO_EARLY", body.Code);
        Assert.Empty(await db.ShiftCompletions.ToListAsync());
        var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal(ShiftStatus.Published, saved.Status);
    }

    [Fact]
    public async Task FinishShift_ManualStart_ActualStartWithinClockSkewGrace_Returns200()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.Published);
        AddNote(db, shift.Id, user.Id);
        var controller = MakeController(db, tenant.Object, user.Id);
        var withinGrace = DateTime.UtcNow.AddMinutes(2); // < the 5-minute grace, must still pass

        var result = await controller.FinishShift(shift.Id, new FinishShiftDto { ActualStart = withinGrace }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
        Assert.Equal(ShiftStatus.PendingReview, body.Data!.Status);
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

    [Fact]
    public async Task FinishShift_PendingReview_ReturnsCurrentDetail_NoWrites()
    {
        var (db, tenant, accessor) = CreateAuditedDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.PendingReview);
        var existing = Seed(db, new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id,
            ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow.AddHours(-1),
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = user.Id,
            StartedAt = DateTime.UtcNow.AddHours(-8), SubmittedAt = DateTime.UtcNow.AddHours(-1), IsActive = true,
        });
        var controller = MakeAuditedController(db, tenant.Object, accessor, user.Id);
        var auditCountBefore = await db.AuditLogs.CountAsync(); // seeding above already wrote Created rows (User/Shift/ShiftCompletion are all audited)

        var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
        Assert.Equal(ShiftStatus.PendingReview, body.Data!.Status);
        Assert.Equal(existing.Id, body.Data.Completion!.Id);

        var completions = await db.ShiftCompletions.Where(c => c.ShiftId == shift.Id).ToListAsync();
        var only = Assert.Single(completions);
        Assert.Equal(existing.ActualEnd, only.ActualEnd);
        Assert.Equal(existing.SubmittedAt, only.SubmittedAt); // idempotent replay must not re-stamp
        var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal(0, saved.ReturnCount);
        Assert.Equal(auditCountBefore, await db.AuditLogs.CountAsync()); // idempotent replay must not write an audit row (critique M12)
    }

    [Theory]
    [InlineData(ShiftStatus.Completed, "SHIFT_ALREADY_COMPLETED")]
    [InlineData(ShiftStatus.Cancelled, "SHIFT_CANCELLED")]
    [InlineData(ShiftStatus.Draft, "SHIFT_NOT_PUBLISHED")]
    public async Task FinishShift_NotFinishable_ReturnsDistinctCodePerStatus(ShiftStatus status, string expectedCode)
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, user.Id, status);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
        Assert.Equal(expectedCode, body.Code);
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
