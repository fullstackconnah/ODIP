using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Rostering.RosterStartWeekTests;

namespace Odip.Tests.Rostering;

/// <summary>
/// Start rostering (2026-10-16, L6, L10): the daily top-up is gone, and a Generate from an AGREEMENT pattern that makes shifts in a week nobody has started marks it started, so the board stops offering Start there; one from a hand-made pattern marks nothing (owner, 2026-10-29).
/// EF InMemory, the RosterStartWeekTests fixture.
/// </summary>
public class RosterGenerateStartsWeekTests
{
    [Fact]
    public void TheDailyTopUpIsGone() =>
        Assert.Null(typeof(RosterShiftGenerator).Assembly.GetType("Odip.Infrastructure.BackgroundServices.RosterTopUpBackgroundService"));

    private static async Task<GeneratePatternResultDto> GenerateAsync(string dbName, Guid patternId, DateOnly from, DateOnly to)
    {
        using var db = TestDb.ForTenant(dbName, TenantA);
        var result = await Controller(db, TenantOf(TenantA)).GeneratePattern(patternId, from, to, default);
        return Assert.IsType<ApiResponse<GeneratePatternResultDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    private static List<RosterWeek> Rows(string dbName)
    {
        using var db = TestDb.Create(dbName);
        return db.RosterWeeks.AsNoTracking().OrderBy(w => w.WeekStart).ToList();
    }

    [Fact]
    public async Task Generate_FromAnAgreementPattern_IntoAnUnstartedWeek_StartsIt_AndStartIsThenRefused()
    {
        Guid patternId = default;
        var dbName = NewDatabase(db => patternId = Pattern(db, Person(db, "Mia").Id, DayOfWeek.Monday).Id);

        Assert.Equal(2, (await GenerateAsync(dbName, patternId, Monday, Monday.AddDays(13))).Created);

        var rows = Rows(dbName);
        Assert.Equal(new[] { Monday, Monday.AddDays(7) }, rows.Select(w => w.WeekStart));
        Assert.All(rows, w => Assert.Equal((TenantA, (Guid?)CoordinatorId), (w.TenantId, w.StartedByUserId)));
        AssertWeekStarted409(await StartAsync(dbName, Monday));
    }

    [Fact]
    public async Task Generate_FromAHandMadePattern_StartsNothing_AndStartThenAddsTheAgreementShiftsWithoutTouchingIt()
    {
        Guid handMade = default;
        Guid ben = default;
        var dbName = NewDatabase(db =>
        {
            handMade = Pattern(db, Person(db, "Mia").Id, DayOfWeek.Monday, fromAgreement: false).Id;
            Pattern(db, (ben = Person(db, "Ben").Id), DayOfWeek.Monday);
        });

        Assert.Equal(1, (await GenerateAsync(dbName, handMade, Monday, Monday.AddDays(6))).Created);

        Assert.Empty(Rows(dbName));
        Assert.Equal(1, Ok(await StartAsync(dbName, Monday)).Created);
        using var db = TestDb.Create(dbName);
        var shifts = db.Shifts.AsNoTracking().ToList();
        Assert.Equal(2, shifts.Count);
        Assert.Single(shifts, s => s.ShiftPatternId == handMade);
        Assert.Single(shifts, s => s.ParticipantId == ben);
        Assert.Single(Rows(dbName));
    }

    [Fact]
    public async Task Generate_IntoAStartedWeek_AddsNoSecondRow()
    {
        Guid patternId = default;
        var dbName = NewDatabase(db =>
        {
            patternId = Pattern(db, Person(db, "Mia").Id, DayOfWeek.Monday).Id;
            db.RosterWeeks.Add(new RosterWeek { Id = Guid.NewGuid(), TenantId = TenantA, WeekStart = Monday });
        });

        await GenerateAsync(dbName, patternId, Monday, Monday.AddDays(6));

        Assert.Single(Rows(dbName));
    }

    [Fact]
    public async Task Generate_ThatMakesNothing_StartsNothing()
    {
        Guid patternId = default;
        var dbName = NewDatabase(db => patternId = Pattern(db, Person(db, "Mia").Id, DayOfWeek.Monday).Id);
        await GenerateAsync(dbName, patternId, Monday, Monday.AddDays(6));
        using (var db = TestDb.Create(dbName))
        {
            db.RosterWeeks.RemoveRange(db.RosterWeeks);
            db.SaveChanges();
        }

        Assert.Equal(0, (await GenerateAsync(dbName, patternId, Monday, Monday.AddDays(6))).Created);

        Assert.Empty(Rows(dbName));
    }
}
