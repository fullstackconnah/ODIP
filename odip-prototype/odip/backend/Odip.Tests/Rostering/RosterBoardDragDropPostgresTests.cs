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
/// Roster board drag and drop on a real PostgreSQL (<see cref="PostgresFixture"/>: skipped without POSTGRES_CONNECTION_STRING; the runner's dotnet target provides one). What EF InMemory
/// cannot show: a move's one transaction, the organisation's roster lock (RosterGenerationLock, scope "roster-board") and two requests at once. Each test makes an organisation of its own.
/// </summary>
public class RosterBoardDragDropPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly DateOnly Monday = new(2026, 8, 24);
    private readonly PostgresFixture _pg;
    public RosterBoardDragDropPostgresTests(PostgresFixture pg) => _pg = pg;

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

    // The provider's today is 2026-08-20, so the test week is in the future and Publish week notifies (it tells nobody about a day that has gone).
    private static readonly TimeProvider BeforeTheWeek = new FixedClock(new DateTimeOffset(2026, 8, 20, 0, 0, 0, TimeSpan.Zero));

    private static RosteringController Controller(OdipDbContext db, Guid tenantId, TimeSpan? lockWait = null) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: BeforeTheWeek, tenant: TenantOf(tenantId), generator: new RosterShiftGenerator(lockWait));

    private async Task<Guid> NewOrganisationAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await db.DisposeAsync();
        return tenantId;
    }

    private static User Worker(OdipDbContext db, string first, bool screeningValid = true) => db.Users.Add(new User
    {
        Id = Guid.NewGuid(), FirstName = first, LastName = "Test", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = screeningValid ? new DateOnly(2030, 1, 1) : new DateOnly(2020, 1, 1),
    }).Entity;

    private static Participant Person(OdipDbContext db, string first) =>
        db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = first, LastName = "Test", IsActive = true }).Entity;

    private static Shift ShiftOf(OdipDbContext db, Guid participantId, Guid? userId, ShiftStatus status, DateOnly day) => db.Shifts.Add(new Shift
    {
        Id = Guid.NewGuid(), ParticipantId = participantId, UserId = userId, ServiceDate = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status,
    }).Entity;

    private async Task<Guid?> WorkerOn(Guid tenantId, Guid shiftId)
    {
        await using var db = Open(tenantId);
        return (await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shiftId)).UserId;
    }

    [SkippableFact]
    public async Task ARefusedSwap_LeavesBothShiftsAndTheOutboxUnchanged()
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid samId, alexId, fromId, toId;
        await using (var db = Open(tenantId))
        {
            var sam = Worker(db, "Sam");
            var alex = Worker(db, "Alex", screeningValid: false);   // landing on the source is WSC_EXPIRED: Blocking
            var mia = Person(db, "Mia");
            (samId, alexId) = (sam.Id, alex.Id);
            fromId = ShiftOf(db, mia.Id, sam.Id, ShiftStatus.Published, Monday).Id;
            toId = ShiftOf(db, mia.Id, alex.Id, ShiftStatus.Published, Monday.AddDays(1)).Id;
            await db.SaveChangesAsync();
        }

        await using (var db = Open(tenantId))
        {
            var result = await Controller(db, tenantId).MoveStaff(new MoveStaffDto { FromShiftId = fromId, ToShiftId = toId, Mode = MoveStaffMode.Swap, OverrideReason = "Sick call" }, default);
            Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
            Assert.Null(db.Database.CurrentTransaction);   // the lock's transaction was rolled back, and the lock went with it
        }

        Assert.Equal(samId, await WorkerOn(tenantId, fromId));
        Assert.Equal(alexId, await WorkerOn(tenantId, toId));
        await using var check = Open(tenantId);
        Assert.False(await check.NotificationOutbox.AnyAsync(o => o.EntityId == fromId || o.EntityId == toId));
    }

    [SkippableFact]
    public async Task UpdateShift_WhileTheRosterLockIsHeld_Is409Busy_AndChangesNothing()   // deep review S1: a PUT waits for a publish or a move, then reads
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid samId, leeId, shiftId;
        Shift seeded;
        await using (var db = Open(tenantId))
        {
            var sam = Worker(db, "Sam");
            var lee = Worker(db, "Lee");
            (samId, leeId) = (sam.Id, lee.Id);
            seeded = ShiftOf(db, Person(db, "Mia").Id, sam.Id, ShiftStatus.Draft, Monday);
            shiftId = seeded.Id;
            await db.SaveChangesAsync();
        }

        // A Publish week or a move of the same organisation, still running.
        await using (var holder = Open(tenantId))
        await using (var held = await RosterGenerationLock.AcquireAsync(holder, tenantId, default, scope: "roster-board"))
        await using (var db = Open(tenantId))
        {
            var put = new UpdateShiftDto
            {
                ParticipantId = seeded.ParticipantId, StaffId = leeId, ServiceDate = seeded.ServiceDate, StartTime = seeded.StartTime, EndTime = seeded.EndTime,
                Ratio = seeded.Ratio, NightType = seeded.NightType, Status = ShiftStatus.Draft,
            };
            var result = await Controller(db, tenantId, TimeSpan.FromMilliseconds(400)).UpdateShift(shiftId, put, default);
            var busy = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
            Assert.Equal("Another change to the roster is still running. Wait a moment, then try again.", Assert.Single(busy.Errors!));
        }

        Assert.Equal(samId, await WorkerOn(tenantId, shiftId));
    }

    [SkippableFact]
    public async Task MoveStaff_WhileTheRosterLockIsHeld_Is409Busy_AndChangesNothing()
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid samId, fromId, toId;
        await using (var db = Open(tenantId))
        {
            var sam = Worker(db, "Sam");
            var mia = Person(db, "Mia");
            samId = sam.Id;
            fromId = ShiftOf(db, mia.Id, sam.Id, ShiftStatus.Draft, Monday).Id;
            toId = ShiftOf(db, mia.Id, null, ShiftStatus.Draft, Monday.AddDays(1)).Id;
            await db.SaveChangesAsync();
        }

        // Another drop or a publish of the same organisation, still running.
        await using (var holder = Open(tenantId))
        await using (var held = await RosterGenerationLock.AcquireAsync(holder, tenantId, default, scope: "roster-board"))
        await using (var db = Open(tenantId))
        {
            var result = await Controller(db, tenantId, TimeSpan.FromMilliseconds(400)).MoveStaff(new MoveStaffDto { FromShiftId = fromId, ToShiftId = toId, Mode = MoveStaffMode.Move }, default);
            var busy = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
            // The organisation's lock, in its own words (not RosterBusyException's "this participant's roster").
            Assert.Equal("Another change to the roster is still running. Wait a moment, then try again.", Assert.Single(busy.Errors!));
        }

        Assert.Equal(samId, await WorkerOn(tenantId, fromId));
        Assert.Null(await WorkerOn(tenantId, toId));
    }

    [SkippableFact]
    public async Task MoveStaff_WhileAShiftRowIsHeld_Is409Busy_AndChangesNothing()   // lock order: the board lock, then the shift rows by Id, under a bounded wait
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid samId, fromId, toId;
        await using (var db = Open(tenantId))
        {
            var sam = Worker(db, "Sam");
            var mia = Person(db, "Mia");
            samId = sam.Id;
            fromId = ShiftOf(db, mia.Id, sam.Id, ShiftStatus.Draft, Monday).Id;
            toId = ShiftOf(db, mia.Id, null, ShiftStatus.Draft, Monday.AddDays(1)).Id;
            await db.SaveChangesAsync();
        }

        // A PUT (which takes no board lock) is mid-transaction on the target row.
        await using var other = new NpgsqlConnection(_pg.ConnectionString);
        await other.OpenAsync();
        await using var editing = await other.BeginTransactionAsync();
        await using (var touch = new NpgsqlCommand("UPDATE \"Shifts\" SET \"Notes\" = 'edited' WHERE \"Id\" = @id", other, editing))
        {
            touch.Parameters.AddWithValue("id", toId);
            await touch.ExecuteNonQueryAsync();
        }

        await using (var db = Open(tenantId))
        {
            var result = await Controller(db, tenantId, TimeSpan.FromMilliseconds(400)).MoveStaff(new MoveStaffDto { FromShiftId = fromId, ToShiftId = toId, Mode = MoveStaffMode.Move }, default);
            var busy = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
            Assert.Equal("Another change to the roster is still running. Wait a moment, then try again.", Assert.Single(busy.Errors!));
        }
        await editing.RollbackAsync();

        Assert.Equal(samId, await WorkerOn(tenantId, fromId));
        Assert.Null(await WorkerOn(tenantId, toId));
    }

    [SkippableFact]
    public async Task TwoStripDropsOntoOneNeedsStaffShiftAtOnce_OneWinsTheOtherIs409()   // deep review M1: /assign under the board lock and the row lock
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid kimId, leeId, openId;
        await using (var db = Open(tenantId))
        {
            var kim = Worker(db, "Kim");
            var lee = Worker(db, "Lee");
            (kimId, leeId) = (kim.Id, lee.Id);
            openId = ShiftOf(db, Person(db, "Mia").Id, null, ShiftStatus.Published, Monday).Id;
            await db.SaveChangesAsync();
        }

        // Both boards drew it as Needs staff (expectedStaffId null).
        await using var one = Open(tenantId);
        await using var two = Open(tenantId);
        var results = await Task.WhenAll(
            Controller(one, tenantId).AssignShift(openId, new AssignShiftDto { StaffId = kimId, ExpectedStaffId = null }, default),
            Controller(two, tenantId).AssignShift(openId, new AssignShiftDto { StaffId = leeId, ExpectedStaffId = null }, default));

        Assert.Single(results, r => r.Result is OkObjectResult);
        Assert.Single(results, r => r.Result is ConflictObjectResult);
        var winner = await WorkerOn(tenantId, openId);
        Assert.Contains(winner, new Guid?[] { kimId, leeId });
        // Only the winner was told they are on it: nobody holds an "assigned" notice for a shift they are not on.
        await using var check = Open(tenantId);
        var told = await check.NotificationOutbox.Where(o => o.EntityId == openId && o.EventType == NotificationEventType.ShiftAssigned).Select(o => o.RecipientUserId).ToListAsync();
        Assert.Equal(new[] { winner!.Value }, told);
    }

    [SkippableFact]
    public async Task TwoEmptyDayMovesOffOneShiftAtOnce_OneWinsTheOtherIs409_AndOnlyOneShiftIsMade()   // post-merge review N3: the moving create under contention
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid samId, sourceId, miaId;
        await using (var db = Open(tenantId))
        {
            var sam = Worker(db, "Sam");
            var mia = Person(db, "Mia");
            (samId, miaId) = (sam.Id, mia.Id);
            sourceId = ShiftOf(db, mia.Id, sam.Id, ShiftStatus.Draft, Monday).Id;
            await db.SaveChangesAsync();
        }

        // Two boards carried Sam off Monday onto two different empty days, and both saved the panel at once.
        CreateShiftDto MoveTo(DateOnly day) => new()
        {
            ParticipantId = miaId, StaffId = samId, ServiceDate = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, MoveFromShiftId = sourceId,
        };
        await using var one = Open(tenantId);
        await using var two = Open(tenantId);
        var results = await Task.WhenAll(
            Controller(one, tenantId).CreateShift(MoveTo(Monday.AddDays(2)), default),
            Controller(two, tenantId).CreateShift(MoveTo(Monday.AddDays(3)), default));

        Assert.Single(results, r => r.Result is OkObjectResult);
        Assert.Single(results, r => r.Result is ConflictObjectResult);
        Assert.Null(await WorkerOn(tenantId, sourceId));
        await using var check = Open(tenantId);
        Assert.Equal(1, await check.Shifts.CountAsync(s => s.UserId == samId));   // Sam is on exactly one new shift, never two
        Assert.Equal(2, await check.Shifts.CountAsync());
    }

    [SkippableFact]
    public async Task AssignShift_OnAnotherOrganisationsHeldRow_Is404_NotBusy()   // post-merge review N5: the row lock never reaches another organisation's rows
    {
        RequirePostgres();
        var ours = await NewOrganisationAsync();
        var theirsTenant = await NewOrganisationAsync();
        Guid samId, theirShift;
        await using (var db = Open(ours)) { samId = Worker(db, "Sam").Id; await db.SaveChangesAsync(); }
        await using (var db = Open(theirsTenant)) { theirShift = ShiftOf(db, Person(db, "Ivy").Id, null, ShiftStatus.Draft, Monday).Id; await db.SaveChangesAsync(); }

        // Their own coordinator is mid-save on that row.
        await using var other = new NpgsqlConnection(_pg.ConnectionString);
        await other.OpenAsync();
        await using var editing = await other.BeginTransactionAsync();
        await using (var touch = new NpgsqlCommand("UPDATE \"Shifts\" SET \"Notes\" = 'theirs' WHERE \"Id\" = @id", other, editing))
        {
            touch.Parameters.AddWithValue("id", theirShift);
            await touch.ExecuteNonQueryAsync();
        }

        await using (var db = Open(ours))
        {
            // A guessed id from another organisation: 404 at once, not a lock wait that answers busy and so says the row exists and is being written.
            var result = await Controller(db, ours, TimeSpan.FromMilliseconds(400)).AssignShift(theirShift, new AssignShiftDto { StaffId = samId }, default);
            Assert.IsType<NotFoundObjectResult>(result.Result);
        }
        await editing.RollbackAsync();
    }

    [SkippableFact]
    public async Task TwoMovesOntoOneNeedsStaffShiftAtOnce_OneWinsTheOtherIs409()   // Review Focus 1
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid samId, alexId, samShift, alexShift, openShift;
        await using (var db = Open(tenantId))
        {
            var sam = Worker(db, "Sam");
            var alex = Worker(db, "Alex");
            var mia = Person(db, "Mia");
            (samId, alexId) = (sam.Id, alex.Id);
            samShift = ShiftOf(db, mia.Id, sam.Id, ShiftStatus.Draft, Monday).Id;
            alexShift = ShiftOf(db, mia.Id, alex.Id, ShiftStatus.Draft, Monday.AddDays(1)).Id;
            openShift = ShiftOf(db, mia.Id, null, ShiftStatus.Draft, Monday.AddDays(2)).Id;
            await db.SaveChangesAsync();
        }

        await using var one = Open(tenantId);
        await using var two = Open(tenantId);
        var results = await Task.WhenAll(
            Controller(one, tenantId).MoveStaff(new MoveStaffDto { FromShiftId = samShift, ToShiftId = openShift, Mode = MoveStaffMode.Move }, default),
            Controller(two, tenantId).MoveStaff(new MoveStaffDto { FromShiftId = alexShift, ToShiftId = openShift, Mode = MoveStaffMode.Move }, default));

        Assert.Single(results, r => r.Result is OkObjectResult);
        Assert.Single(results, r => r.Result is ConflictObjectResult);
        var winner = await WorkerOn(tenantId, openShift);
        Assert.Contains(winner, new Guid?[] { samId, alexId });
        // The loser is still on their own shift; the winner's is empty.
        Assert.Equal(winner == samId ? alexId : samId, await WorkerOn(tenantId, winner == samId ? alexShift : samShift));
        Assert.Null(await WorkerOn(tenantId, winner == samId ? samShift : alexShift));
    }

    [SkippableFact]
    public async Task TwoPublishWeeksAtOnce_NotifyEachWorkerOnce_AndStayInTheirOrganisation()   // Review Focus 2
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        var otherTenant = await NewOrganisationAsync();
        Guid theirDraft;
        await using (var db = Open(tenantId))
        {
            var mia = Person(db, "Mia");
            ShiftOf(db, mia.Id, Worker(db, "Sam").Id, ShiftStatus.Draft, Monday);
            ShiftOf(db, mia.Id, Worker(db, "Alex").Id, ShiftStatus.Draft, Monday.AddDays(1));
            ShiftOf(db, mia.Id, null, ShiftStatus.Draft, Monday.AddDays(2));
            await db.SaveChangesAsync();
        }
        await using (var db = Open(otherTenant))
        {
            theirDraft = ShiftOf(db, Person(db, "Ivy").Id, Worker(db, "Lee").Id, ShiftStatus.Draft, Monday).Id;
            await db.SaveChangesAsync();
        }

        await using var one = Open(tenantId);
        await using var two = Open(tenantId);
        var results = await Task.WhenAll(Controller(one, tenantId).PublishWeek(Monday, default), Controller(two, tenantId).PublishWeek(Monday.AddDays(3), default));

        var counts = results.Select(r => Assert.IsType<ApiResponse<PublishWeekResultDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!).ToList();
        Assert.Equal(3, counts.Sum(c => c.Published));        // one call published all three, the other found none left
        Assert.Contains(counts, c => c.Published == 0 && c.Notified == 0);
        await using var check = Open(tenantId);
        Assert.Equal(2, await check.NotificationOutbox.CountAsync(o => o.EventType == NotificationEventType.ShiftAssigned));
        await using var theirs = Open(otherTenant);
        Assert.Equal(ShiftStatus.Draft, (await theirs.Shifts.SingleAsync(s => s.Id == theirDraft)).Status);
    }


    [SkippableFact]
    public async Task PublishWeek_NeverWritesPublishedOverAConcurrentCancel()   // N8: a writer holding the row (here raw SQL, standing in for any write that skips the board lock) makes the publish wait
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid keptId, cancelledId;
        await using (var db = Open(tenantId))
        {
            var mia = Person(db, "Mia");
            keptId = ShiftOf(db, mia.Id, Worker(db, "Sam").Id, ShiftStatus.Draft, Monday).Id;
            cancelledId = ShiftOf(db, mia.Id, Worker(db, "Alex").Id, ShiftStatus.Draft, Monday.AddDays(1)).Id;
            await db.SaveChangesAsync();
        }

        // A PUT cancelling Tuesday's draft is mid-transaction, holding the row, when the publish starts.
        await using var other = new NpgsqlConnection(_pg.ConnectionString);
        await other.OpenAsync();
        await using var cancelling = await other.BeginTransactionAsync();
        await using (var cancel = new NpgsqlCommand("UPDATE \"Shifts\" SET \"Status\" = @status WHERE \"Id\" = @id", other, cancelling))
        {
            cancel.Parameters.AddWithValue("status", (int)ShiftStatus.Cancelled);
            cancel.Parameters.AddWithValue("id", cancelledId);
            await cancel.ExecuteNonQueryAsync();
        }

        await using var publisher = Open(tenantId);
        var publishing = Controller(publisher, tenantId).PublishWeek(Monday, default);
        await Task.Delay(500);
        Assert.False(publishing.IsCompleted);   // waiting on the row the PUT holds
        await cancelling.CommitAsync();

        var result = Assert.IsType<ApiResponse<PublishWeekResultDto>>(Assert.IsType<OkObjectResult>((await publishing).Result).Value).Data!;
        Assert.Equal(1, result.Published);
        await using var check = Open(tenantId);
        Assert.Equal(ShiftStatus.Cancelled, (await check.Shifts.SingleAsync(s => s.Id == cancelledId)).Status);
        Assert.Equal(ShiftStatus.Published, (await check.Shifts.SingleAsync(s => s.Id == keptId)).Status);
    }
}
