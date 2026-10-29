using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>The one "started" rule (R1 as amended): a RosterWeek row, or a non-Cancelled shift an AGREEMENT pattern made in the week. A one-off, or a shift a hand-made pattern made, starts nothing (owner, 2026-10-29).</summary>
public class StartedWeeksTests
{
    private static readonly DateOnly From = new(2026, 10, 19), To = new(2026, 11, 1);

    /// <summary>A shift on <paramref name="day"/>: from a pattern of the given kind (seeded into <paramref name="db"/>), or a one-off when <paramref name="fromAgreement"/> is null.</summary>
    private static Shift ShiftOn(OdipDbContext db, Guid tenantId, DateOnly day, ShiftStatus status, bool? fromAgreement) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = Guid.NewGuid(), ServiceDate = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status,
        ShiftPatternId = fromAgreement is { } agreement ? RosterStartWeekTests.Pattern(db, Guid.NewGuid(), DayOfWeek.Monday, tenantId: tenantId, fromAgreement: agreement).Id : null,
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
    public async Task AnAgreementPatternShift_StartsItsWeek_WithoutARow() =>
        Assert.Equal(new[] { new DateOnly(2026, 10, 26) }, await StartedAsync(db => db.Shifts.Add(ShiftOn(db, TenantA, new DateOnly(2026, 10, 28), ShiftStatus.Draft, fromAgreement: true))));

    [Fact]
    public async Task APublishedOneOffAlone_DoesNotStartAWeek() =>
        Assert.Empty(await StartedAsync(db => db.Shifts.Add(ShiftOn(db, TenantA, new DateOnly(2026, 10, 20), ShiftStatus.Published, fromAgreement: null))));

    [Fact]
    public async Task AHandMadePatternShiftAlone_DoesNotStartAWeek() =>
        Assert.Empty(await StartedAsync(db => db.Shifts.Add(ShiftOn(db, TenantA, new DateOnly(2026, 10, 28), ShiftStatus.Draft, fromAgreement: false))));

    [Fact]
    public async Task ACancelledPatternShiftAlone_DoesNotStartAWeek() =>
        Assert.Empty(await StartedAsync(db => db.Shifts.Add(ShiftOn(db, TenantA, new DateOnly(2026, 10, 20), ShiftStatus.Cancelled, fromAgreement: true))));

    [Fact]
    public async Task AnotherOrganisationsRowsAndShifts_AreNotCounted() =>
        Assert.Empty(await StartedAsync(db =>
        {
            db.RosterWeeks.Add(Row(TenantB, From));
            db.Shifts.Add(ShiftOn(db, TenantB, new DateOnly(2026, 10, 28), ShiftStatus.Draft, fromAgreement: true));
        }));

    [Fact]
    public async Task ARowAndAPatternShiftInOneWeek_GiveItsMondayOnce() =>
        Assert.Equal(new[] { From }, await StartedAsync(db =>
        {
            db.RosterWeeks.Add(Row(TenantA, From));
            db.Shifts.Add(ShiftOn(db, TenantA, new DateOnly(2026, 10, 21), ShiftStatus.Draft, fromAgreement: true));
        }));
}
