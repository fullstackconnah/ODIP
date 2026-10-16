using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Rostering.RosterStartWeekTests;

namespace Odip.Tests.Rostering;

/// <summary>
/// Start rostering on a real PostgreSQL (skipped without POSTGRES_CONNECTION_STRING): the organisation's board lock, each participant's generation lock and the unique RosterWeeks row
/// keep two Starts, or a Start and another writer, from making a week twice.
/// </summary>
public class RosterStartWeekPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public RosterStartWeekPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private OdipDbContext Open(Guid tenantId) => PostgresFixture.NewContext(_pg.ConnectionString, TenantOf(tenantId));

    private static RosteringController StartController(OdipDbContext db, Guid tenantId, TimeSpan? lockWait = null) =>
        // No NameIdentifier: StartedByUserId stays null (a user id here would need a Users row for its key; the InMemory tests pin who started it).
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: Clock, tenant: TenantOf(tenantId), generator: new RosterShiftGenerator(lockWait))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, "Coordinator") }, "test")) },
            },
        };

    /// <summary>An organisation of its own with Mia, who has a Monday-to-Friday agreement pattern each.</summary>
    private async Task<(Guid TenantId, Guid MiaId)> MiaWithAWeekOfPatternsAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await db.DisposeAsync();
        await using var seed = Open(tenantId);
        var mia = seed.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Mia", LastName = "Test", IsActive = true }).Entity;
        var revision = seed.ServiceAgreementDrafts.Add(ApprovalTestSupport.BuildRevision(tenantId, mia.Id, 1, new[] { ApprovalTestSupport.WeekdayBlock() })).Entity;
        foreach (var day in RosterStartWeekTests.Weekdays)
            seed.ShiftPatterns.Add(new ShiftPattern
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = mia.Id, DayOfWeek = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 10, 1), IsActive = true,
                SourceDraftId = revision.Id, SourceBlockKey = "weekdays", WorkerSlot = 1,
            });
        await seed.SaveChangesAsync();
        return (tenantId, mia.Id);
    }

    private async Task<(int Rows, int Shifts)> CountsAsync(Guid tenantId)
    {
        await using var db = Open(tenantId);
        return (await db.RosterWeeks.CountAsync(), await db.Shifts.CountAsync());
    }

    private static string? ConflictCode(ActionResult<ApiResponse<StartWeekResultDto>> result) =>
        Assert.IsType<ApiResponse<StartWeekResultDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value).Code;

    [SkippableFact]
    public async Task TwoStartsAtOnce_MakeOneWeek_AndNoDuplicateShifts()
    {
        RequirePostgres();
        var (tenantId, _) = await MiaWithAWeekOfPatternsAsync();

        await using var one = Open(tenantId);
        await using var two = Open(tenantId);
        var results = await Task.WhenAll(StartController(one, tenantId).StartWeek(Monday, default), StartController(two, tenantId).StartWeek(Monday, default));

        Assert.Single(results, r => r.Result is OkObjectResult);
        var refused = Assert.Single(results, r => r.Result is ConflictObjectResult);
        Assert.Contains(ConflictCode(refused), new[] { RosteringController.RosterWeekStartedCode, null });   // started, or busy if it waited past the lock
        Assert.Equal((1, 5), await CountsAsync(tenantId));
    }

    [SkippableFact]
    public async Task Start_LosesTheUniqueRowToAConcurrentWriter_AndKeepsNothing()
    {
        RequirePostgres();
        var (tenantId, miaId) = await MiaWithAWeekOfPatternsAsync();

        await using var holder = Open(tenantId);
        var held = await RosterGenerationLock.AcquireAsync(holder, miaId, default);
        await using var starter = Open(tenantId);
        var start = StartController(starter, tenantId, TimeSpan.FromSeconds(5)).StartWeek(Monday, default);
        await Task.Delay(300);
        await using (var writer = Open(tenantId))
        {
            writer.RosterWeeks.Add(new RosterWeek { Id = Guid.NewGuid(), TenantId = tenantId, WeekStart = Monday });
            await writer.SaveChangesAsync();
        }
        await held.CommitAsync(default);

        Assert.Equal(RosteringController.RosterWeekStartedCode, ConflictCode(await start));
        Assert.Equal((1, 0), await CountsAsync(tenantId));
    }

    [SkippableFact]
    public async Task Start_WaitsForAParticipantsGeneration_ThenAnswersBusy()
    {
        RequirePostgres();
        var (tenantId, miaId) = await MiaWithAWeekOfPatternsAsync();

        await using var holder = Open(tenantId);
        await using var held = await RosterGenerationLock.AcquireAsync(holder, miaId, default);
        await using (var starter = Open(tenantId))
        {
            var result = await StartController(starter, tenantId, TimeSpan.FromMilliseconds(300)).StartWeek(Monday, default);
            Assert.Null(ConflictCode(result));   // the busy message, not roster-week-started
        }

        Assert.Equal((0, 0), await CountsAsync(tenantId));
    }
}
