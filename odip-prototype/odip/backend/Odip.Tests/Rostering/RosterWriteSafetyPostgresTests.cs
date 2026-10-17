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

    private static RosteringController Controller(OdipDbContext db, Guid tenantId, TimeSpan? lockWait = null) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: BeforeTheWeek, tenant: TenantOf(tenantId), generator: new RosterShiftGenerator(lockWait));

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

    // SURVEY section 2 item 4: plain POST shifts took no lock, so two creates for one worker could both read an empty day. DOUBLE_BOOKED_SHIFT is a warning that needs no reason, so both saves
    // succeed; what the lock orders is who sees whom: exactly one of the two stored shifts (the later) carries the double-booking.
    [SkippableFact]
    public async Task TwoPlainCreatesForOneWorkerAtOnce_AreOrdered_TheSecondSeesTheFirstAsDoubleBooked()
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
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
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
                return await Controller(db, tenantId).CreateShift(For(participantId, day), default);
            }
            var one = Create(miaId);
            var two = Create(ivyId);
            gate.SetResult();
            var results = await Task.WhenAll(one, two);

            Assert.All(results, r => Assert.IsType<OkObjectResult>(r.Result));
            await using var check = Open(tenantId);
            var made = await check.Shifts.Where(s => s.UserId == samId && s.ServiceDate == day).Select(s => s.AcknowledgedFindingCodes).ToListAsync();
            Assert.Equal(2, made.Count);
            Assert.Equal(1, made.Count(codes => codes != null && codes.Contains("DOUBLE_BOOKED_SHIFT")));
        }
    }
}
