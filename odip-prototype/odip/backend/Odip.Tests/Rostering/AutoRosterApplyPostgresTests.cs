using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Auto-roster apply (R7 PR2) on a real PostgreSQL (<see cref="PostgresFixture"/>: skipped without POSTGRES_CONNECTION_STRING; the runner's dotnet target provides one). What EF InMemory
/// cannot show: apply is one transaction (a failure part-way keeps no row), and it takes the board lock, so a drop made at the same moment cannot double-assign a shift.
/// </summary>
public class AutoRosterApplyPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly DateOnly Monday = new(2026, 8, 24);
    private readonly PostgresFixture _pg;
    public AutoRosterApplyPostgresTests(PostgresFixture pg) => _pg = pg;

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

    private static RosteringController Controller(OdipDbContext db, Guid tenantId, IObligationTaskService? tasks = null) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), obligationTasks: tasks, clock: BeforeTheWeek, tenant: TenantOf(tenantId));

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

    private static Shift OpenShift(OdipDbContext db, Guid participantId, int day) => db.Shifts.Add(new Shift
    {
        Id = Guid.NewGuid(), ParticipantId = participantId, ServiceDate = Monday.AddDays(day), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft,
    }).Entity;

    private static AutoRosterApplyDto Rows(Guid staffId, params Guid[] shiftIds) =>
        new() { Rows = shiftIds.Select(id => new AutoRosterApplyRowDto { ShiftId = id, StaffId = staffId }).ToList() };

    private async Task<List<Guid?>> WorkersOn(Guid tenantId, params Guid[] shiftIds)
    {
        await using var db = Open(tenantId);
        var rows = await db.Shifts.AsNoTracking().Where(s => shiftIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.UserId);
        return shiftIds.Select(id => rows[id]).ToList();
    }

    [SkippableFact]
    public async Task AFailureOnTheSecondOfThreeRows_RollsBackEveryRow()   // the "Nothing was saved." copy of the draft panel stands on this
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid sam;
        Guid[] shifts;
        await using (var db = Open(tenantId))
        {
            sam = Worker(db, "Sam").Id;
            var mia = db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Mia", LastName = "Test", IsActive = true }).Entity;
            shifts = [OpenShift(db, mia.Id, 0).Id, OpenShift(db, mia.Id, 1).Id, OpenShift(db, mia.Id, 2).Id];
            await db.SaveChangesAsync();
        }

        // Row 1 is saved by its own SaveChanges before row 2 throws: only the one transaction can take it back.
        var tasks = new Mock<IObligationTaskService>();
        tasks.Setup(t => t.CompleteByShiftAsync(shifts[1], It.IsAny<TaskType>(), It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("injected"));
        await using (var db = Open(tenantId))
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => Controller(db, tenantId, tasks.Object).AutoRosterApply(Monday, Rows(sam, shifts), default));
            Assert.Null(db.Database.CurrentTransaction);   // the lock's transaction was rolled back, and the lock went with it
        }

        Assert.All(await WorkersOn(tenantId, shifts), Assert.Null);
    }

    [SkippableFact]
    public async Task ApplyAndADropOnTheSameShiftAtOnce_LetExactlyOneWin()
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid sam, lee, shiftId;
        await using (var db = Open(tenantId))
        {
            (sam, lee) = (Worker(db, "Sam").Id, Worker(db, "Lee").Id);
            var mia = db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Mia", LastName = "Test", IsActive = true }).Entity;
            shiftId = OpenShift(db, mia.Id, 0).Id;
            await db.SaveChangesAsync();
        }

        await using var applyDb = Open(tenantId);
        await using var dropDb = Open(tenantId);
        var apply = Controller(applyDb, tenantId).AutoRosterApply(Monday, Rows(sam, shiftId), default);
        var drop = Controller(dropDb, tenantId).AssignShift(shiftId, new AssignShiftDto { StaffId = lee, ExpectedStaffId = null }, default);   // the board showed the shift open
        await Task.WhenAll(apply, drop);

        var applied = Assert.IsType<ApiResponse<AutoRosterApplyResultDto>>(Assert.IsType<OkObjectResult>((await apply).Result).Value).Data!.Applied.Count;
        var dropped = (await drop).Result is OkObjectResult ? 1 : 0;
        Assert.Equal(1, applied + dropped);
        Assert.Equal(applied == 1 ? sam : lee, Assert.Single(await WorkersOn(tenantId, shiftId)));
    }
}
