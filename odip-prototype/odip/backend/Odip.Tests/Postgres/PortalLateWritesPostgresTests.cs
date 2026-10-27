using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Postgres;

/// <summary>
/// Late writes on a real PostgreSQL: the SentFromOffline column arrives false on existing rows, a re-sent queued break or note
/// (same client id, sent twice at once) leaves ONE row, and an id belonging to another organisation is found past the tenant filter.
/// </summary>
public class PortalLateWritesPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly DateTime Now = new(2026, 7, 14, 1, 0, 0, DateTimeKind.Utc);
    private readonly PostgresFixture _pg;
    public PortalLateWritesPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static Mock<ICurrentTenant> TenantMock(Guid tenantId)
    {
        var mock = new Mock<ICurrentTenant>();
        mock.Setup(t => t.TenantId).Returns(tenantId);
        mock.Setup(t => t.IsSuperAdmin).Returns(false);
        return mock;
    }

    private static async Task<(Guid ShiftId, Guid UserId, Guid CompletionId)> SeedAsync(OdipDbContext db)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        var user = new User
        {
            Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(), FirstName = "Ben", LastName = "Turner",
            Role = UserRole.SupportWorker, IsActive = true, IsMedicationCompetent = true, MedicationCompetencyExpiryDate = new DateOnly(2099, 1, 1),
        };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = user.Id, ServiceDate = new DateOnly(2026, 7, 14),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Status = ShiftStatus.InProgress,
        };
        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = new DateTime(2026, 7, 13, 23, 5, 0, DateTimeKind.Utc),
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = user.Id, StartedAt = new DateTime(2026, 7, 13, 23, 5, 0, DateTimeKind.Utc), IsActive = true,
        };
        db.AddRange(participant, user, shift, completion);
        await db.SaveChangesAsync();
        return (shift.Id, user.Id, completion.Id);
    }

    private static PortalController PortalFor(OdipDbContext db, Guid tenantId, Guid userId)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim("fullName", "Ben Turner")], "Test");
        return new PortalController(db, TenantMock(tenantId).Object, clock: FakeClock.AtUtc(Now.Year, Now.Month, Now.Day, Now.Hour, Now.Minute))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    private async Task<T[]> RaceAsync<T>(Guid tenantId, int count, Func<OdipDbContext, Task<T>> attempt)
    {
        var tenant = TenantMock(tenantId);
        using var gate = new ManualResetEventSlim(false);
        var tasks = Enumerable.Range(0, count).Select(_ => Task.Run(async () =>
        {
            await using var db = PostgresFixture.NewContext(_pg.ConnectionString, tenant.Object);
            gate.Wait();
            return await attempt(db);
        })).ToList();
        gate.Set();
        return await Task.WhenAll(tasks);
    }

    [SkippableFact]
    public async Task SentFromOffline_ColumnExists_AndExistingRowsReadFalse()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var (_, _, completionId) = await SeedAsync(db);

        await using var verify = PostgresFixture.NewContext(_pg.ConnectionString, TenantMock(tenantId).Object);
        Assert.False((await verify.ShiftCompletions.SingleAsync(c => c.Id == completionId)).SentFromOffline);
    }

    [SkippableFact]
    public async Task TwoConcurrentStartsOfTheSameBreakId_LeaveOneRow_AndBothAnswer200()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var (shiftId, userId, completionId) = await SeedAsync(db);
        var breakId = Guid.NewGuid();

        var results = await RaceAsync(tenantId, 2, async request =>
            await PortalFor(request, tenantId, userId).StartBreak(shiftId, new StartBreakDto { BreakId = breakId, StartedAt = Now.AddMinutes(-30) }, default));

        Assert.All(results, r => Assert.IsType<OkObjectResult>(r.Result));
        await using var verify = PostgresFixture.NewContext(_pg.ConnectionString, TenantMock(tenantId).Object);
        Assert.Equal(breakId, Assert.Single(await verify.ShiftBreaks.Where(b => b.ShiftCompletionId == completionId).ToListAsync()).Id);
    }

    [SkippableFact]
    public async Task TwoConcurrentNotesWithTheSameId_LeaveOneRow_AndBothAnswer200()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var (shiftId, userId, _) = await SeedAsync(db);
        var noteId = Guid.NewGuid();

        var results = await RaceAsync(tenantId, 2, async request =>
            await PortalFor(request, tenantId, userId).CreateShiftNote(shiftId, new CreateShiftNoteDto { Id = noteId, Body = "Settled." }, default));

        Assert.All(results, r => Assert.Equal(200, Assert.IsAssignableFrom<ObjectResult>(r.Result).StatusCode));
        await using var verify = PostgresFixture.NewContext(_pg.ConnectionString, TenantMock(tenantId).Object);
        Assert.Equal(noteId, Assert.Single(await verify.ShiftNotes.Where(n => n.ShiftId == shiftId).ToListAsync()).Id);
    }

    [SkippableFact]
    public async Task AnIdOfAnotherTenantsBreak_IsFoundPastTheTenantFilter_AndRefused409()
    {
        RequirePostgres();
        var (otherDb, _) = await _pg.NewTenantContextAsync();
        await using var _other = otherDb;
        var (_, otherUser, otherCompletion) = await SeedAsync(otherDb);
        var theirs = new ShiftBreak { Id = Guid.NewGuid(), ShiftCompletionId = otherCompletion, StartedAt = Now.AddHours(-5), EndedAt = Now.AddHours(-4), CreatedByUserId = otherUser };
        otherDb.ShiftBreaks.Add(theirs);
        await otherDb.SaveChangesAsync();

        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var (shiftId, userId, _) = await SeedAsync(db);

        var result = await PortalFor(db, tenantId, userId).StartBreak(shiftId, new StartBreakDto { BreakId = theirs.Id }, default);

        Assert.Equal(409, Assert.IsAssignableFrom<ObjectResult>(result.Result).StatusCode);
    }
}
