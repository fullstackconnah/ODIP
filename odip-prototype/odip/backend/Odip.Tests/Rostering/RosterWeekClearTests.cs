using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Start rostering's one-off (2026-10-16, L7) on EF InMemory: untouched future weeks are cleared, every other week holding a shift and the current week are marked started, and an
/// organisation already done is skipped. The clock: Wed 2026-10-14 01:00 UTC, so Sydney's today is 2026-10-14, the current Monday 2026-10-12, the first clearable Monday 2026-10-19.
/// </summary>
public class RosterWeekClearTests
{
    private static readonly Guid TenantA = Guid.NewGuid(), TenantB = Guid.NewGuid();
    private static readonly DateOnly Current = new(2026, 10, 12), Next = new(2026, 10, 19);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 10, 14, 1, 0, 0, TimeSpan.Zero));

    private static DbContextOptions<OdipDbContext> Options() =>
        new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).AddInterceptors(new AuditInterceptor(new Mock<IHttpContextAccessor>().Object)).Options;

    private static OdipDbContext Admin(DbContextOptions<OdipDbContext> options) => new(options, new ScopedTenantOverride { IsSuperAdmin = true });

    private static void Seed(DbContextOptions<OdipDbContext> options, Action<OdipDbContext> seed)
    {
        using var db = Admin(options);
        seed(db);
        db.SaveChanges();
    }

    /// <summary>An open Draft an agreement pattern made (DEEP-S1: only those are cleared, as Start makes them again).</summary>
    private static Shift Untouched(OdipDbContext db, DateOnly day, Guid? tenantId = null, bool fromAgreement = true) => db.Shifts.Add(new Shift
    {
        Id = Guid.NewGuid(), TenantId = tenantId ?? TenantA, ParticipantId = Guid.NewGuid(), ShiftPatternId = PatternOf(db, tenantId ?? TenantA, fromAgreement), ServiceDate = day,
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft,
    }).Entity;

    private static Guid PatternOf(OdipDbContext db, Guid tenantId, bool fromAgreement) => db.ShiftPatterns.Add(new ShiftPattern
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = Guid.NewGuid(), DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 1, 1), SourceDraftId = fromAgreement ? Guid.NewGuid() : null,
    }).Entity.Id;

    private static DbContextOptions<OdipDbContext> NewSet(Action<OdipDbContext> seed)
    {
        var options = Options();
        Seed(options, db =>
        {
            db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantA, State = "NSW" });
            db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantB, State = "NSW" });
            seed(db);
        });
        return options;
    }

    private static Task<RosterWeekClearRun> RunAsync(DbContextOptions<OdipDbContext> options) => RosterWeekClear.RunAsync(options, Clock, NullLogger.Instance, default);

    private static List<Guid> ShiftIds(DbContextOptions<OdipDbContext> options) { using var db = Admin(options); return db.Shifts.Select(s => s.Id).ToList(); }

    private static List<DateOnly> Rows(DbContextOptions<OdipDbContext> options, Guid? tenantId = null)
    {
        using var db = Admin(options);
        return db.RosterWeeks.Where(w => w.TenantId == (tenantId ?? TenantA)).Select(w => w.WeekStart).OrderBy(d => d).ToList();
    }

    [Fact]
    public async Task ClearsAnUntouchedWeekAfterTheCurrentOne_AndAuditsEachRemoval()
    {
        Guid one = default, two = default;
        var options = NewSet(db => { one = Untouched(db, Next).Id; two = Untouched(db, Next.AddDays(2)).Id; });

        var run = await RunAsync(options);

        Assert.Equal((2, 1), (run.ShiftsRemoved, run.WeeksCleared));
        Assert.Empty(ShiftIds(options));
        using var db = Admin(options);
        var deletes = db.AuditLogs.Where(a => a.Action == AuditAction.Deleted && a.ChangedByName == RosterWeekClear.ActorName).Select(a => a.EntityId).ToList();
        Assert.Equal(new[] { one, two }.OrderBy(id => id), deletes.OrderBy(id => id));
    }

    [Theory]
    [InlineData("worker")]
    [InlineData("published")]
    [InlineData("notes")]
    [InlineData("override")]
    [InlineData("codes")]
    [InlineData("returned")]
    [InlineData("edited")]
    [InlineData("one-off")]
    [InlineData("hand-made-pattern")]
    [InlineData("note-row")]
    [InlineData("completion-row")]
    [InlineData("handover-row")]
    [InlineData("claim-row")]
    [InlineData("task-row")]
    [InlineData("incident-row")]
    public async Task KeepsTheWholeWeek_WhenOneShiftIsTouched(string mark)
    {
        var week = new DateOnly(2026, 10, 26);
        var options = NewSet(db =>
        {
            Untouched(db, week);
            var touched = Untouched(db, week.AddDays(1));
            switch (mark)
            {
                case "worker": touched.UserId = Guid.NewGuid(); break;
                case "published": touched.Status = ShiftStatus.Published; break;
                case "notes": touched.Notes = "Bring the hoist"; break;
                case "override": touched.OverrideReason = "Agreed with family"; break;
                case "codes": touched.AcknowledgedFindingCodes = "OVER_HOURS"; break;
                case "returned": touched.ReturnCount = 1; break;
                case "edited": touched.UpdatedAt = touched.CreatedAt.AddMinutes(5); break;   // a coordinator changed its times or ratio, nothing else
                case "one-off": touched.ShiftPatternId = null; break;
                case "hand-made-pattern": touched.ShiftPatternId = PatternOf(db, TenantA, fromAgreement: false); break;   // DEEP-S1: Start never makes these again
                case "note-row": db.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), TenantId = TenantA, ShiftId = touched.Id, AuthorUserId = Guid.NewGuid(), AuthorName = "Sam Hill", Body = "Note" }); break;
                case "completion-row":
                    db.ShiftCompletions.Add(new ShiftCompletion { Id = Guid.NewGuid(), TenantId = TenantA, ShiftId = touched.Id, ActualStart = DateTime.UtcNow, TimeZoneId = "Australia/Sydney", SubmittedByUserId = Guid.NewGuid(), StartedAt = DateTime.UtcNow, IsActive = true });
                    break;
                case "handover-row": db.HandoverAcknowledgements.Add(new HandoverAcknowledgement { Id = Guid.NewGuid(), TenantId = TenantA, SourceCompletionId = Guid.NewGuid(), ShiftId = touched.Id, UserId = Guid.NewGuid(), AcknowledgedAt = DateTime.UtcNow }); break;
                case "claim-row":
                    db.ClaimLineItems.Add(new ClaimLineItem
                    {
                        Id = Guid.NewGuid(), TripClaimId = Guid.NewGuid(), ShiftId = touched.Id, SupportItemCode = "04_SHIFT", DayType = ClaimDayType.Weekday,
                        SupportsDeliveredFrom = touched.ServiceDate, SupportsDeliveredTo = touched.ServiceDate, Hours = 4m, UnitPrice = 40m, TotalAmount = 160m,
                    });
                    break;
                case "task-row": db.BookingTasks.Add(new BookingTask { Id = Guid.NewGuid(), TenantId = TenantA, Title = "Call", ShiftId = touched.Id }); break;
                case "incident-row":
                    db.IncidentReports.Add(new IncidentReport
                    {
                        Id = Guid.NewGuid(), TenantId = TenantA, ReportedByUserId = Guid.NewGuid(), IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Low,
                        Status = IncidentStatus.Draft, Title = "Incident", Description = "What happened.", IncidentDateTime = DateTime.UtcNow, ShiftId = touched.Id,
                    });
                    break;
            }
        });

        var run = await RunAsync(options);

        Assert.Equal(0, run.ShiftsRemoved);
        Assert.Equal(2, ShiftIds(options).Count);
        Assert.Contains(week, Rows(options));
    }

    [Fact]
    public async Task NeverClearsTheCurrentWeek_AndMarksPastAndCurrentWeeksStarted()
    {
        var options = NewSet(db =>
        {
            Untouched(db, new DateOnly(2026, 10, 14));
            var past = Untouched(db, new DateOnly(2026, 10, 1));
            past.Status = ShiftStatus.Published;
        });

        await RunAsync(options);

        Assert.Equal(2, ShiftIds(options).Count);
        Assert.Equal(new[] { new DateOnly(2026, 9, 28), Current }, Rows(options));
    }

    [Fact]
    public async Task ASecondRun_ChangesNothing_EvenForAWeekStartMadeAllOpen()
    {
        var options = NewSet(db => Untouched(db, new DateOnly(2026, 10, 1)).Status = ShiftStatus.Published);
        await RunAsync(options);
        Guid startMade = default;
        Seed(options, db =>
        {
            startMade = Untouched(db, new DateOnly(2026, 11, 2)).Id;
            db.RosterWeeks.Add(new RosterWeek { Id = Guid.NewGuid(), TenantId = TenantA, WeekStart = new DateOnly(2026, 11, 2) });
        });

        var second = await RunAsync(options);

        Assert.Equal((1, 0), (second.AlreadyDone, second.ShiftsRemoved));
        Assert.Contains(startMade, ShiftIds(options));
    }

    [Fact]
    public async Task AnOrganisationWithOnlyUntouchedFutureWeeks_IsCleared_AndGetsNoRow_SoItsCurrentWeekCanStillBeStarted()   // DEEP-S2: no forced current-week row
    {
        var options = NewSet(db => Untouched(db, Next));

        var run = await RunAsync(options);

        Assert.Equal((1, 1, 0), (run.ShiftsRemoved, run.WeeksCleared, run.WeeksMarked));
        Assert.Empty(Rows(options));
    }

    [Theory]
    [InlineData("one-off")]
    [InlineData("cancelled-pattern-shift")]
    public async Task AWeekHoldingNoLivePatternShift_IsKept_ButNotMarkedStarted(string holds)   // DEEP-S2: the backfill follows the StartedWeeks rule
    {
        var week = new DateOnly(2026, 10, 26);
        var options = NewSet(db =>
        {
            var shift = Untouched(db, week);
            if (holds == "one-off") { shift.ShiftPatternId = null; shift.Status = ShiftStatus.Published; }
            else shift.Status = ShiftStatus.Cancelled;
        });

        var run = await RunAsync(options);

        Assert.Equal(0, run.ShiftsRemoved);
        Assert.Single(ShiftIds(options));
        Assert.Empty(Rows(options));
    }

    [Fact]
    public async Task EachOrganisationIsJudgedAlone()
    {
        Guid bShift = default;
        var options = NewSet(db =>
        {
            Untouched(db, Next);
            var b = Untouched(db, Next, TenantB);
            b.UserId = Guid.NewGuid();
            bShift = b.Id;
        });

        await RunAsync(options);

        Assert.Equal(new[] { bShift }, ShiftIds(options));
        Assert.Contains(Next, Rows(options, TenantB));
        Assert.DoesNotContain(Next, Rows(options));
    }
}
