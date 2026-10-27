using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Delete shift and plain create on a real PostgreSQL (roster write safety, 2026-10-17): the board lock and the shift-row lock Delete now takes, the completion foreign key
/// that used to make it a 500, the notice a Published delete raises, and two creates for one worker at once. Skipped without POSTGRES_CONNECTION_STRING; each test makes an organisation of its own.
/// </summary>
public class RosterWriteSafetyPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly DateOnly Monday = new(2026, 8, 24);
    private readonly PostgresFixture _pg;
    public RosterWriteSafetyPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static ICurrentTenant TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    private OdipDbContext Open(Guid tenantId) => PostgresFixture.NewContext(_pg.ConnectionString, TenantOf(tenantId));

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private static readonly TimeProvider BeforeTheWeek = new FixedClock(new DateTimeOffset(2026, 8, 20, 0, 0, 0, TimeSpan.Zero));

    private static RosteringController Controller(OdipDbContext db, Guid tenantId, TimeSpan? lockWait = null, string role = "Coordinator") =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: BeforeTheWeek, tenant: TenantOf(tenantId), generator: new RosterShiftGenerator(lockWait))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, role) }, "test")) },
            },
        };

    private async Task<Guid> NewOrganisationAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await db.DisposeAsync();
        return tenantId;
    }

    private static User Worker(OdipDbContext db, string first) => db.Users.Add(new User
    {
        Id = Guid.NewGuid(), FirstName = first, LastName = "Test", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
    }).Entity;

    private static Participant Person(OdipDbContext db, string first) =>
        db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = first, LastName = "Test", IsActive = true }).Entity;

    private static Shift ShiftOf(OdipDbContext db, Guid participantId, Guid? userId, ShiftStatus status, DateOnly day) => db.Shifts.Add(new Shift
    {
        Id = Guid.NewGuid(), ParticipantId = participantId, UserId = userId, ServiceDate = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status,
    }).Entity;

    [SkippableTheory]   // PT-ROSTER 2: the completion's Restrict foreign key made this a 500
    [InlineData(ShiftStatus.InProgress)]
    [InlineData(ShiftStatus.PendingReview)]
    [InlineData(ShiftStatus.Completed)]
    public async Task DeleteShift_OfAShiftWithACompletion_Is409_NotA500_AndKeepsTheShift(ShiftStatus status)
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid shiftId;
        await using (var db = Open(tenantId))
        {
            var sam = Worker(db, "Sam");
            shiftId = ShiftOf(db, Person(db, "Mia").Id, sam.Id, status, Monday).Id;
            db.ShiftCompletions.Add(new ShiftCompletion
            {
                Id = Guid.NewGuid(), ShiftId = shiftId, ActualStart = new DateTime(2026, 8, 23, 23, 0, 0, DateTimeKind.Utc), TimeZoneId = "Australia/Sydney",
                SubmittedByUserId = sam.Id, StartedAt = new DateTime(2026, 8, 23, 23, 0, 0, DateTimeKind.Utc), IsActive = true,
            });
            await db.SaveChangesAsync();
        }

        await using (var db = Open(tenantId))
        {
            var result = await Controller(db, tenantId).DeleteShift(shiftId, default);
            var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
            Assert.Equal(ShiftErrorCodes.ShiftStatusLocked, Assert.IsType<ApiResponse<bool>>(conflict.Value).Code);
        }

        await using var check = Open(tenantId);
        Assert.True(await check.Shifts.AnyAsync(s => s.Id == shiftId));
    }

    // Deep review of the PR: the Restrict foreign keys are on ROWS, not statuses. A returned shift is Published again but keeps its (inactive) completion, and a worker can
    // note any non-Draft shift of their own; both used to be a 500 (23503).
    [SkippableFact]
    public async Task DeleteShift_OfAReturnedShift_WhoseCompletionIsInactive_Is409_AndKeepsTheShift()
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid shiftId;
        await using (var db = Open(tenantId))
        {
            var sam = Worker(db, "Sam");
            var shift = ShiftOf(db, Person(db, "Mia").Id, sam.Id, ShiftStatus.Published, Monday);
            shift.ReturnCount = 1;
            shiftId = shift.Id;
            db.ShiftCompletions.Add(new ShiftCompletion
            {
                Id = Guid.NewGuid(), ShiftId = shiftId, ActualStart = new DateTime(2026, 8, 23, 23, 0, 0, DateTimeKind.Utc), TimeZoneId = "Australia/Sydney",
                SubmittedByUserId = sam.Id, StartedAt = new DateTime(2026, 8, 23, 23, 0, 0, DateTimeKind.Utc), IsActive = false, ReviewOutcome = ReviewOutcome.Returned,
            });
            await db.SaveChangesAsync();
        }

        await AssertDeleteIsRefusedAndKeepsAsync(tenantId, shiftId);
    }

    [SkippableFact]
    public async Task DeleteShift_OfAPublishedShiftWithAWorkersNote_Is409_AndKeepsTheShift()
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid shiftId;
        await using (var db = Open(tenantId))
        {
            var sam = Worker(db, "Sam");
            shiftId = ShiftOf(db, Person(db, "Mia").Id, sam.Id, ShiftStatus.Published, Monday).Id;
            db.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), ShiftId = shiftId, AuthorUserId = sam.Id, AuthorName = "Sam Test", Body = "Running ten minutes late." });
            await db.SaveChangesAsync();
        }

        await AssertDeleteIsRefusedAndKeepsAsync(tenantId, shiftId);
    }

    private async Task AssertDeleteIsRefusedAndKeepsAsync(Guid tenantId, Guid shiftId)
    {
        await using (var db = Open(tenantId))
        {
            var result = await Controller(db, tenantId).DeleteShift(shiftId, default);
            var response = Assert.IsType<ApiResponse<bool>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
            Assert.Equal(ShiftErrorCodes.ShiftStatusLocked, response.Code);
            Assert.Equal("This shift has notes or a timesheet behind it, so it can't be deleted. Cancel it instead.", Assert.Single(response.Errors!));
        }

        await using var check = Open(tenantId);
        Assert.True(await check.Shifts.AnyAsync(s => s.Id == shiftId));
    }

    [SkippableFact]   // the shift's own row lock, apart from the board lock: another write already holds this shift
    public async Task DeleteShift_WhileAnotherWriteHoldsTheShiftRow_Is409Busy_AndKeepsTheShift()
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid shiftId;
        await using (var db = Open(tenantId))
        {
            shiftId = ShiftOf(db, Person(db, "Mia").Id, Worker(db, "Sam").Id, ShiftStatus.Draft, Monday).Id;
            await db.SaveChangesAsync();
        }

        await using (var raw = new NpgsqlConnection(_pg.ConnectionString))
        {
            await raw.OpenAsync();
            await using var tx = await raw.BeginTransactionAsync();
            await using (var hold = new NpgsqlCommand("SELECT 1 FROM \"Shifts\" WHERE \"Id\" = @id FOR UPDATE", raw, tx))
            {
                hold.Parameters.AddWithValue("id", shiftId);
                await hold.ExecuteScalarAsync();
            }

            await using var db = Open(tenantId);
            var result = await Controller(db, tenantId, TimeSpan.FromMilliseconds(400)).DeleteShift(shiftId, default);
            var busy = Assert.IsType<ApiResponse<bool>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
            Assert.Equal("Another change to the roster is still running. Wait a moment, then try again.", Assert.Single(busy.Errors!));
        }

        await using var check = Open(tenantId);
        Assert.True(await check.Shifts.AnyAsync(s => s.Id == shiftId));
    }

    [SkippableFact]   // PT-ROSTER 2 case B: the worker of a Published shift hears it is gone, once
    public async Task DeleteShift_OfAPublishedShift_TellsItsWorkerOnce_ADraftTellsNobody()
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid samId, publishedId, draftId;
        await using (var db = Open(tenantId))
        {
            var sam = Worker(db, "Sam");
            var mia = Person(db, "Mia");
            samId = sam.Id;
            publishedId = ShiftOf(db, mia.Id, sam.Id, ShiftStatus.Published, Monday).Id;
            draftId = ShiftOf(db, mia.Id, sam.Id, ShiftStatus.Draft, Monday.AddDays(1)).Id;
            await db.SaveChangesAsync();
        }

        await using (var db = Open(tenantId))
        {
            Assert.IsType<OkObjectResult>((await Controller(db, tenantId).DeleteShift(publishedId, default)).Result);
            Assert.IsType<OkObjectResult>((await Controller(db, tenantId).DeleteShift(draftId, default)).Result);
        }

        await using var check = Open(tenantId);
        Assert.False(await check.Shifts.AnyAsync(s => s.Id == publishedId || s.Id == draftId));
        var told = await check.NotificationOutbox.Where(o => o.EventType == NotificationEventType.ShiftUnassigned && (o.EntityId == publishedId || o.EntityId == draftId))
            .Select(o => new { o.EntityId, o.RecipientUserId }).ToListAsync();
        var one = Assert.Single(told);
        Assert.Equal((publishedId, samId), (one.EntityId, one.RecipientUserId));
    }

    [SkippableFact]   // PT-ROSTER 2 case C: a Delete waits for a publish or a move of the organisation, as every other board write does
    public async Task DeleteShift_WhileTheRosterLockIsHeld_Is409Busy_AndKeepsTheShift()
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid shiftId;
        await using (var db = Open(tenantId))
        {
            shiftId = ShiftOf(db, Person(db, "Mia").Id, Worker(db, "Sam").Id, ShiftStatus.Draft, Monday).Id;
            await db.SaveChangesAsync();
        }

        await using (var holder = Open(tenantId))
        await using (var held = await RosterGenerationLock.AcquireAsync(holder, tenantId, default, scope: "roster-board"))
        await using (var db = Open(tenantId))
        {
            var result = await Controller(db, tenantId, TimeSpan.FromMilliseconds(400)).DeleteShift(shiftId, default);
            var busy = Assert.IsType<ApiResponse<bool>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
            Assert.Equal("Another change to the roster is still running. Wait a moment, then try again.", Assert.Single(busy.Errors!));
        }

        await using var check = Open(tenantId);
        Assert.True(await check.Shifts.AnyAsync(s => s.Id == shiftId));
    }

    // SURVEY section 2 item 4: plain POST shifts took no lock, so two creates for one worker could both read an empty day. Double-booking is refused for a Coordinator and needs a reason from an Admin
    // (2026-10-27); what the lock orders is who sees whom: for a Coordinator exactly one of two simultaneous creates saves, for an Admin with a reason both do.
    [SkippableTheory]
    [InlineData("Coordinator")]
    [InlineData("Admin")]
    public async Task TwoPlainCreatesForOneWorkerAtOnce_AreOrdered_TheSecondSeesTheFirstAsDoubleBooked(string role)
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid samId, miaId, ivyId;
        await using (var db = Open(tenantId))
        {
            samId = Worker(db, "Sam").Id;
            (miaId, ivyId) = (Person(db, "Mia").Id, Person(db, "Ivy").Id);
            await db.SaveChangesAsync();
        }

        CreateShiftDto For(Guid participantId, DateOnly day) => new()
        {
            ParticipantId = participantId, StaffId = samId, ServiceDate = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, OverrideReason = "Both shifts agreed with the worker.", AcknowledgedFindingCodes = ["DOUBLE_BOOKED_SHIFT"],
        };

        // A few rounds, each on a day of its own, both requests released together by a gate.
        for (var round = 0; round < 4; round++)
        {
            var day = Monday.AddDays(round);
            var gate = new TaskCompletionSource();
            async Task<ActionResult<ApiResponse<ShiftDto>>> Create(Guid participantId)
            {
                await using var db = Open(tenantId);
                await gate.Task;
                return await Controller(db, tenantId, role: role).CreateShift(For(participantId, day), default);
            }
            var one = Create(miaId);
            var two = Create(ivyId);
            gate.SetResult();
            var results = await Task.WhenAll(one, two);

            await using var check = Open(tenantId);
            var made = await check.Shifts.Where(s => s.UserId == samId && s.ServiceDate == day).Select(s => s.AcknowledgedFindingCodes).ToListAsync();
            if (role == "Coordinator")
            {
                Assert.Equal(1, results.Count(r => r.Result is OkObjectResult));
                Assert.Equal(1, results.Count(r => r.Result is UnprocessableEntityObjectResult));
                Assert.Single(made);
            }
            else
            {
                Assert.All(results, r => Assert.IsType<OkObjectResult>(r.Result));
                Assert.Equal(2, made.Count);
            }
        }
    }

    // The Generate button put a regular on shifts under the participant lock alone, so it ran beside a plain create for the same worker; it now waits for the organisation's board lock as Start week does.
    [SkippableFact]
    public async Task GeneratePattern_WhileTheRosterLockIsHeld_Is409Busy_AndMakesNoShifts()
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid patternId;
        await using (var db = Open(tenantId))
        {
            var samId = Worker(db, "Sam").Id;
            patternId = db.ShiftPatterns.Add(new ShiftPattern
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = Person(db, "Mia").Id, DefaultUserId = samId, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 8, 1), IsActive = true,
            }).Entity.Id;
            await db.SaveChangesAsync();
        }

        await using (var holder = Open(tenantId))
        await using (var held = await RosterGenerationLock.AcquireAsync(holder, tenantId, default, scope: "roster-board"))
        await using (var db = Open(tenantId))
        {
            var result = await Controller(db, tenantId, TimeSpan.FromMilliseconds(400)).GeneratePattern(patternId, Monday, Monday.AddDays(6), default);
            var busy = Assert.IsType<ApiResponse<GeneratePatternResultDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
            Assert.Equal(RosterBusyException.Words, Assert.Single(busy.Errors!));
        }

        await using var check = Open(tenantId);
        Assert.False(await check.Shifts.AnyAsync());
    }

    // Deep review note 1 (coverage of existing behaviour, passes on old and new code): after a plain create saved Sam on Monday 09:00-15:00 for Ivy, Generate for Mia's patterns opens the
    // clashing Monday shift (Sam stays its regular, "booked on another shift") and leaves Sam on the next Monday's, which clashes with nothing.
    [SkippableFact]
    public async Task GeneratePattern_AfterAPlainCreateForTheSameWorker_OpensTheClashingShift_AndKeepsTheRest()
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid samId, miaId, ivyId;
        await using (var db = Open(tenantId))
        {
            samId = Worker(db, "Sam").Id;
            (miaId, ivyId) = (Person(db, "Mia").Id, Person(db, "Ivy").Id);
            await db.SaveChangesAsync();
        }

        await using (var db = Open(tenantId))
        {
            var created = await Controller(db, tenantId).CreateShift(new CreateShiftDto
            {
                ParticipantId = ivyId, StaffId = samId, ServiceDate = Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
            }, default);
            Assert.IsType<OkObjectResult>(created.Result);
        }

        Guid patternId;
        await using (var db = Open(tenantId))
        {
            patternId = db.ShiftPatterns.Add(PatternOn(tenantId, miaId, samId, DayOfWeek.Monday)).Entity.Id;
            await db.SaveChangesAsync();
        }

        await using (var db = Open(tenantId))
        {
            var result = await Controller(db, tenantId).GeneratePattern(patternId, Monday, Monday.AddDays(13), default);
            Assert.IsType<OkObjectResult>(result.Result);
        }

        await using var check = Open(tenantId);
        var miaShifts = await check.Shifts.Where(s => s.ParticipantId == miaId).OrderBy(s => s.ServiceDate).ToListAsync();
        var monday = Assert.Single(miaShifts, s => s.ServiceDate == Monday);
        Assert.Null(monday.UserId);
        Assert.Equal(samId, monday.RegularUserId);
        Assert.Equal("booked on another shift", monday.RegularAwayReason);
        Assert.Equal(1, await check.Shifts.CountAsync(s => s.UserId == samId && s.ServiceDate == Monday));
        var nextMonday = Assert.Single(miaShifts, s => s.ServiceDate == Monday.AddDays(7));
        Assert.Equal(samId, nextMonday.UserId);
        Assert.Null(nextMonday.RegularAwayReason);
    }

    private static ShiftPattern PatternOn(Guid tenantId, Guid participantId, Guid userId, DayOfWeek day) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, DefaultUserId = userId, DayOfWeek = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 8, 1), IsActive = true,
    };
}
