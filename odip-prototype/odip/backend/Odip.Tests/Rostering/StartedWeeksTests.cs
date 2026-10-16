using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>The one "started" rule (R1 as amended): a RosterWeek row, or a non-Cancelled shift a pattern made in the week. A one-off alone starts nothing.</summary>
public class StartedWeeksTests
{
    private static readonly DateOnly From = new(2026, 10, 19), To = new(2026, 11, 1);

    private static Shift ShiftOn(Guid tenantId, DateOnly day, ShiftStatus status, bool fromPattern) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = Guid.NewGuid(), ServiceDate = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status, ShiftPatternId = fromPattern ? Guid.NewGuid() : null,
    };

    private static RosterWeek Row(Guid tenantId, DateOnly monday) => new() { Id = Guid.NewGuid(), TenantId = tenantId, WeekStart = monday };

    private static async Task<HashSet<DateOnly>> StartedAsync(Action<OdipDbContext> seed)
    {
        await using var db = NewDb(Guid.NewGuid().ToString());
        seed(db);
        await db.SaveChangesAsync();
        return await StartedWeeks.MondaysAsync(db, TenantA, From, To, default);
    }

    [Fact]
    public async Task ARow_StartsItsWeek() =>
        Assert.Equal(new[] { From }, await StartedAsync(db => db.RosterWeeks.Add(Row(TenantA, From))));

    [Fact]
    public async Task ALivePatternShift_StartsItsWeek_WithoutARow() =>
        Assert.Equal(new[] { new DateOnly(2026, 10, 26) }, await StartedAsync(db => db.Shifts.Add(ShiftOn(TenantA, new DateOnly(2026, 10, 28), ShiftStatus.Draft, fromPattern: true))));

    [Fact]
    public async Task APublishedOneOffAlone_DoesNotStartAWeek() =>
        Assert.Empty(await StartedAsync(db => db.Shifts.Add(ShiftOn(TenantA, new DateOnly(2026, 10, 20), ShiftStatus.Published, fromPattern: false))));

    [Fact]
    public async Task ACancelledPatternShiftAlone_DoesNotStartAWeek() =>
        Assert.Empty(await StartedAsync(db => db.Shifts.Add(ShiftOn(TenantA, new DateOnly(2026, 10, 20), ShiftStatus.Cancelled, fromPattern: true))));

    [Fact]
    public async Task AnotherOrganisationsRowsAndShifts_AreNotCounted() =>
        Assert.Empty(await StartedAsync(db =>
        {
            db.RosterWeeks.Add(Row(TenantB, From));
            db.Shifts.Add(ShiftOn(TenantB, new DateOnly(2026, 10, 28), ShiftStatus.Draft, fromPattern: true));
        }));

    [Fact]
    public async Task ARowAndAPatternShiftInOneWeek_GiveItsMondayOnce() =>
        Assert.Equal(new[] { From }, await StartedAsync(db =>
        {
            db.RosterWeeks.Add(Row(TenantA, From));
            db.Shifts.Add(ShiftOn(TenantA, new DateOnly(2026, 10, 21), ShiftStatus.Draft, fromPattern: true));
        }));
}
