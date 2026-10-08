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
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The roster's budget check against a real PostgreSQL (budget phase 3; skipped, never failed, when POSTGRES_CONNECTION_STRING is unset, so these run in CI and not on a machine without a server). What EF InMemory
/// cannot show: that the check's own queries (the saved shift, the pattern link, the settings' mode, the holidays, the review task by shift) translate and return the same rows, that numeric(18,2) figures come out
/// to the cent in a finding, that the review task's unique source key holds a retry to ONE task, and that the participant's ledger still reads through the tenant filter. Same builders and fixed clock as the
/// ledger's own PostgreSQL tests, over a scratch database of their own.
/// </summary>
public class ShiftBudgetPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Mon12Oct = new(2026, 10, 12);
    private static readonly DateOnly Tue13Oct = new(2026, 10, 13);
    private static readonly DateOnly Wed14Oct = new(2026, 10, 14);

    private readonly PostgresFixture _pg;
    public ShiftBudgetPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    /// <summary>A migrated scratch database; a kit over a tenant of it (provider in NSW, community access catalogue in); and that tenant as the request would carry it.</summary>
    private async Task<(LedgerKit Kit, ICurrentTenant Tenant)> SetUpAsync()
    {
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync(Ct);
        var (db, tenantId) = await _pg.NewTenantContextAsync(cs);
        var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return (kit, tenant.Object);
    }

    private static ShiftBudgetRequest Request(Participant participant, DateOnly date, Guid? shiftId = null, int endHour = 17, bool admin = false) =>
        new(participant.TenantId, participant.Id, shiftId, date, new TimeOnly(9, 0), new TimeOnly(endHour, 0), false, SupportRatio.OneToOne, SleepoverType.None, null, null, admin);

    [SkippableFact]
    public async Task TheCheck_OfANewAndAnEditedShift_ReturnsTheLedgersFiguresToTheCent_AndHonoursTheModeAndTheSavedPatternLink()
    {
        RequirePostgres();
        var (kit, _) = await SetUpAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 1234.56m)));
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);   // $480.00 used, not yet claimed
        kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed);   // $960.00 used
        var booked = kit.SeedShift(person, Mon12Oct);                              // $480.00 booked ahead
        kit.SeedShift(person, Tue13Oct);                                           // $960.00 booked ahead
        kit.Db.BudgetSettings.Add(new BudgetSettings { Id = Guid.NewGuid(), TenantId = kit.TenantId, Mode = BudgetLimitMode.HardLimit });
        await kit.Db.SaveChangesAsync(Ct);
        var check = new ShiftBudgetCheck(kit.Db, kit.Ledger);

        var created = await check.CheckAsync(Request(person, Wed14Oct), Ct);
        var raised = await check.CheckAsync(Request(person, Mon12Oct, booked.Id, endHour: 19), Ct);
        var lowered = await check.CheckAsync(Request(person, Mon12Oct, booked.Id, endHour: 15), Ct);

        var forecast = Assert.Single(created.Findings, f => f.Code == BudgetFindingCodes.ForecastOver);
        Assert.Equal(RosterFindingSeverity.Blocking, forecast.Severity);
        Assert.Equal(new BudgetFindingFigures("Core (flexible)", new DateOnly(2026, 10, 1), new DateOnly(2026, 12, 31), 1234.56m, 960.00m, 2400.00m, 480.00m), forecast.Budget);
        Assert.Equal(1165.44m, forecast.Budget!.OverBy);
        Assert.Equal(RosterFindingSeverity.Blocking, raised.Findings.Single(f => f.Code == BudgetFindingCodes.ForecastOver).Severity);
        Assert.Equal(2040.00m, raised.Findings.Single(f => f.Code == BudgetFindingCodes.ForecastOver).Budget!.Forecast);   // $960.00 used and $1,080.00 booked: the old $480 replaced by $600, not added to
        Assert.Equal(RosterFindingSeverity.Warning, lowered.Findings.Single(f => f.Code == BudgetFindingCodes.ForecastOver).Severity);
    }

    [SkippableFact]
    public async Task ShiftsAndABookingTakenPastTheFunding_GiveWarningsOverNpgsql()
    {
        RequirePostgres();
        var (kit, _) = await SetUpAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 1000.00m)));
        var booking = kit.SeedBooking(kit.SeedTrip(new DateOnly(2026, 10, 20), 3), person);
        var effect = new ShiftBudgetEffect(kit.Db, kit.Ledger);

        var forBooking = await effect.ForBookingAsync(kit.TenantId, person.Id, booking.Id, Ct);
        var forShifts = await effect.ForShiftsAsync(kit.TenantId, person.Id,
            new[] { new PlannedShift(null, Mon12Oct, new TimeOnly(9, 0), new TimeOnly(17, 0), false, SupportRatio.OneToOne, SleepoverType.None) }, Ct);

        var bookingWarning = Assert.Single(forBooking);
        Assert.Equal((1440.00m, 440.00m), (bookingWarning.Added, bookingWarning.OverBy));
        var shiftWarning = Assert.Single(forShifts);
        Assert.Equal((1920.00m, 480.00m), (shiftWarning.Forecast, shiftWarning.Added));   // the booking's $1,440.00 and this shift's $480.00
    }

    [SkippableFact]
    public async Task TheEmergencyPath_SavesOnce_RaisesExactlyOneTask_AndTheTasksUniqueKeyHoldsARetryToIt()
    {
        RequirePostgres();
        var (kit, tenant) = await SetUpAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 1000.00m)));
        kit.SeedShift(person, Mon12Oct);
        kit.SeedShift(person, Tue13Oct);
        kit.Db.BudgetSettings.Add(new BudgetSettings { Id = Guid.NewGuid(), TenantId = kit.TenantId, Mode = BudgetLimitMode.HardLimit });
        await kit.Db.SaveChangesAsync(Ct);
        var controller = new RosteringController(kit.Db, new StaffCompatibilityLinkService(kit.Db), new StaffUnavailabilityQuery(kit.Db), clock: kit.Clock, tenant: tenant)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, "Coordinator") }, "test")) } },
        };
        var dto = new CreateShiftDto
        {
            ParticipantId = person.Id, ServiceDate = Wed14Oct, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
        };

        var refused = await controller.CreateShift(dto, Ct);
        var saved = ((ApiResponse<ShiftDto>)Assert.IsType<OkObjectResult>((await controller.CreateShift(dto with { Emergency = true, OverrideReason = "Participant unsafe at home tonight" }, Ct)).Result).Value!).Data!;
        var shift = await kit.Db.Shifts.SingleAsync(s => s.Id == saved.Id, Ct);
        var edited = await controller.UpdateShift(shift.Id, new UpdateShiftDto
        {
            ParticipantId = person.Id, ServiceDate = Wed14Oct, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(19, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
            Status = ShiftStatus.Draft, Emergency = true, OverrideReason = "Still unsafe, needs the extra two hours",
        }, Ct);

        Assert.IsType<UnprocessableEntityObjectResult>(refused.Result);
        Assert.Equal(new[] { BudgetFindingCodes.Emergency }, saved.AcknowledgedFindingCodes);
        Assert.Equal(BudgetReviewState.Pending, saved.BudgetReview!.State);
        Assert.IsType<OkObjectResult>(edited.Result);
        var task = await kit.Db.BookingTasks.SingleAsync(Ct);   // a second save of the same shift did not make a second task
        Assert.Equal((TaskType.BudgetEmergencyReview, $"budget-emergency:{saved.Id}", kit.TenantId), (task.TaskType, task.SourceKey, task.TenantId));
        Assert.Equal(new DateOnly(2026, 10, 5), task.DueDate);
    }
}
