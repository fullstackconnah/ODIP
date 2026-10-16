using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The one-off clear (L7) on a real PostgreSQL, each test on a database of its own (the clear reads every organisation): the Restrict and SetNull keys to Shifts never lose a row, a
/// referencing row no tenant filter would show still keeps its shift (S1), and the clear waits for the organisation's board lock. Provider's today: 2026-08-20, current Monday 2026-08-17.
/// </summary>
public class RosterWeekClearPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public RosterWeekClearPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 8, 20, 0, 0, 0, TimeSpan.Zero));
    private static readonly DateOnly Current = new(2026, 8, 17), W1 = new(2026, 8, 31), W2 = new(2026, 9, 7), W3 = new(2026, 9, 14), W4 = new(2026, 9, 21);

    private sealed record Org(string Cs, Guid TenantId, Guid UserId, Guid ParticipantId, Guid PatternId);

    private async Task<Org> NewDatabaseAsync()
    {
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync();
        var (db, tenantId) = await _pg.NewTenantContextAsync(cs);
        await using (db)
        {
            var user = db.Users.Add(new User
            {
                Id = Guid.NewGuid(), FirstName = "Sam", LastName = "Hill", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
                Role = UserRole.Coordinator, Position = Position.SupportWorker, IsActive = true,
            }).Entity;
            var mia = db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Mia", LastName = "Test", IsActive = true }).Entity;
            var revision = db.ServiceAgreementDrafts.Add(ApprovalTestSupport.BuildRevision(tenantId, mia.Id, 1, new[] { ApprovalTestSupport.WeekdayBlock() })).Entity;
            var pattern = db.ShiftPatterns.Add(new ShiftPattern
            {
                SourceDraftId = revision.Id, SourceBlockKey = "weekdays", WorkerSlot = 1,   // an agreement pattern: only its shifts are ever cleared
                Id = Guid.NewGuid(), ParticipantId = mia.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
            }).Entity;
            db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), OrganisationName = "Provider", State = "NSW", BSB = "062000", AccountNumber = "12345678" });
            await db.SaveChangesAsync();
            return new Org(cs, tenantId, user.Id, mia.Id, pattern.Id);
        }
    }

    private static DbContextOptions<OdipDbContext> Options(string cs) =>
        new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(cs).AddInterceptors(new AuditInterceptor(new Mock<IHttpContextAccessor>().Object)).Options;

    private static Shift Untouched(OdipDbContext db, Org org, DateOnly day) => db.Shifts.Add(new Shift
    {
        Id = Guid.NewGuid(), TenantId = org.TenantId, ParticipantId = org.ParticipantId, ShiftPatternId = org.PatternId, ServiceDate = day,
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft,
    }).Entity;

    [SkippableFact]
    public async Task OnPostgres_ClearsOnlyTheUntouchedWeek_AndNeverAShiftARestrictOrSetNullRowPointsAt()
    {
        RequirePostgres();
        var org = await NewDatabaseAsync();
        Guid w1a, w1b, w2a, w2b, w3, w4, noteId, taskId, incidentId;
        await using (var db = PostgresFixture.NewContext(org.Cs))   // SuperAdmin: rows keep the TenantId they are given, and the incident none
        {
            w1a = Untouched(db, org, W1).Id;
            w1b = Untouched(db, org, W1.AddDays(1)).Id;
            w2a = Untouched(db, org, W2).Id;
            w2b = Untouched(db, org, W2.AddDays(1)).Id;
            noteId = db.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), TenantId = org.TenantId, ShiftId = w2b, AuthorUserId = org.UserId, AuthorName = "Sam Hill", Body = "Note" }).Entity.Id;
            w3 = Untouched(db, org, W3).Id;
            taskId = db.BookingTasks.Add(new BookingTask { Id = Guid.NewGuid(), TenantId = org.TenantId, Title = "Call", ShiftId = w3 }).Entity.Id;
            w4 = Untouched(db, org, W4).Id;
            // S1: a rollback-window incident with no tenant, which the organisation's query filter hides.
            incidentId = db.IncidentReports.Add(new IncidentReport
            {
                Id = Guid.NewGuid(), TenantId = null, ReportedByUserId = org.UserId, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Low,
                Status = IncidentStatus.Draft, Title = "Incident", Description = "What happened.", IncidentDateTime = new DateTime(2026, 8, 19, 0, 0, 0, DateTimeKind.Utc), ShiftId = w4,
            }).Entity.Id;
            await db.SaveChangesAsync();
        }

        var run = await RosterWeekClear.RunAsync(Options(org.Cs), Clock, NullLogger.Instance, default);

        Assert.Equal((1, 2, 0), (run.WeeksCleared, run.ShiftsRemoved, run.Failures));
        await using var read = PostgresFixture.NewContext(org.Cs);
        Assert.Equal(new[] { w2a, w2b, w3, w4 }.OrderBy(id => id), (await read.Shifts.Select(s => s.Id).ToListAsync()).OrderBy(id => id));
        Assert.True(await read.ShiftNotes.AnyAsync(n => n.Id == noteId));
        Assert.Equal(w3, (await read.BookingTasks.SingleAsync(t => t.Id == taskId)).ShiftId);
        Assert.Equal(w4, (await read.IncidentReports.SingleAsync(i => i.Id == incidentId)).ShiftId);
        Assert.Equal(new[] { W2, W3, W4 }, await read.RosterWeeks.Where(w => w.TenantId == org.TenantId).Select(w => w.WeekStart).OrderBy(d => d).ToListAsync());
        var deleted = await read.AuditLogs.Where(a => a.Action == AuditAction.Deleted && a.ChangedByName == RosterWeekClear.ActorName).Select(a => a.EntityId).ToListAsync();
        Assert.Equal(new[] { w1a, w1b }.OrderBy(id => id), deleted.OrderBy(id => id));
    }

    [SkippableFact]
    public async Task OnPostgres_ADraftACoordinatorEdited_IsKept()   // B-M2: a changed time or ratio leaves no other mark than UpdatedAt
    {
        RequirePostgres();
        var org = await NewDatabaseAsync();
        Guid edited;
        await using (var db = PostgresFixture.NewContext(org.Cs))
        {
            var shift = Untouched(db, org, W1);
            shift.UpdatedAt = shift.CreatedAt.AddMinutes(5);
            edited = shift.Id;
            await db.SaveChangesAsync();
        }

        var run = await RosterWeekClear.RunAsync(Options(org.Cs), Clock, NullLogger.Instance, default);

        Assert.Equal(0, run.ShiftsRemoved);
        await using var read = PostgresFixture.NewContext(org.Cs);
        Assert.True(await read.Shifts.AnyAsync(s => s.Id == edited));
    }

    [SkippableFact]
    public async Task OnPostgres_TheLockIsTheBoardLock()
    {
        RequirePostgres();
        var org = await NewDatabaseAsync();
        await using (var db = PostgresFixture.NewContext(org.Cs))
        {
            Untouched(db, org, W1);
            await db.SaveChangesAsync();
        }

        await using var holder = PostgresFixture.NewContext(org.Cs);
        var held = await RosterGenerationLock.AcquireAsync(holder, org.TenantId, default, TimeSpan.FromSeconds(10), "roster-board");
        var running = RosterWeekClear.RunAsync(Options(org.Cs), Clock, NullLogger.Instance, default);
        await Task.Delay(300);
        Assert.False(running.IsCompleted);
        await held.CommitAsync(default);

        Assert.Equal(1, (await running).WeeksCleared);
    }
}
