using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// Review finding L6 (plan 4.4): the audit interceptor stamps every history row with the real "now" and no actor, so a shift rostered a
/// fortnight ago would show a "Created" entry at the minute the top-up ran, written by nobody. <see cref="DemoAuditStampInterceptor"/> sits
/// after it in the maintainer's context and rewrites the rows the audit interceptor has just added, BEFORE they are written: the time the row
/// describes, and a system actor (or a scripted user the pack names). The "Changes" JSON is the audit interceptor's own, untouched, and the
/// audit table stays append-only (the guard still refuses any change to an existing audit row).
/// </summary>
public class DemoAuditStampTests
{
    private static readonly Guid DemoTenant = Guid.Parse("b0000000-0000-0000-0000-000000000001");
    private static readonly DateTime Now = new(2026, 10, 2, 0, 30, 0, DateTimeKind.Utc);          // Fri 10:30 AEST

    private static DbContextOptions<OdipDbContext> Options(DemoAuditStamps? stamps, string? name = null)
    {
        var builder = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name ?? Guid.NewGuid().ToString());
        var interceptors = new List<IInterceptor> { new AuditInterceptor(new HttpContextAccessor()) };
        if (stamps is not null) interceptors.Add(new DemoAuditStampInterceptor(stamps));
        return builder.AddInterceptors(interceptors).Options;
    }

    private static OdipDbContext Db(DbContextOptions<OdipDbContext> options)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(DemoTenant);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new OdipDbContext(options, tenant.Object);
    }

    private static Shift NewShift(DateTime createdAt, Guid? id = null) => new()
    {
        Id = id ?? Guid.NewGuid(), TenantId = DemoTenant, ParticipantId = Guid.NewGuid(), ServiceDate = new DateOnly(2026, 9, 21),
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Published, CreatedAt = createdAt, UpdatedAt = createdAt,
    };

    private static DateTimeOffset At(DateTime utc) => new(DateTime.SpecifyKind(utc, DateTimeKind.Utc));

    [Fact]
    public async Task ACreatedRow_IsStampedWithTheTimeItDescribes_AndTheSystemActor()
    {
        var stamps = new DemoAuditStamps { NowUtc = Now };
        var options = Options(stamps);
        var rosteredOn = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc);
        await using (var db = Db(options))
        {
            db.Shifts.Add(NewShift(rosteredOn));
            await db.SaveChangesAsync();
        }

        await using var check = Db(options);
        var log = await check.AuditLogs.SingleAsync();
        Assert.Equal(AuditAction.Created, log.Action);
        Assert.Equal(At(rosteredOn), log.ChangedAt);                       // not the minute the top-up ran
        Assert.Null(log.ChangedById);
        Assert.Equal(DemoAuditActors.SystemName, log.ChangedByName);       // a named system actor, never nobody
    }

    [Fact]
    public async Task AnUpdatedRow_IsStampedWithItsOwnUpdatedAt()
    {
        var stamps = new DemoAuditStamps { NowUtc = Now };
        var options = Options(stamps);
        var id = Guid.NewGuid();
        var movedAt = new DateTime(2026, 9, 22, 4, 0, 0, DateTimeKind.Utc);
        await using (var db = Db(options))
        {
            db.Shifts.Add(NewShift(new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc), id));
            await db.SaveChangesAsync();
        }
        await using (var db = Db(options))
        {
            var shift = await db.Shifts.SingleAsync(s => s.Id == id);
            shift.Status = ShiftStatus.PendingReview;
            shift.UpdatedAt = movedAt;
            await db.SaveChangesAsync();
        }

        await using var check = Db(options);
        var updated = await check.AuditLogs.SingleAsync(l => l.Action == AuditAction.Updated);
        Assert.Equal(At(movedAt), updated.ChangedAt);
        Assert.Equal(DemoAuditActors.SystemName, updated.ChangedByName);
    }

    [Fact]
    public async Task ARowIsNeverStampedLaterThanTheTicksNow()
    {
        var stamps = new DemoAuditStamps { NowUtc = Now };
        var options = Options(stamps);
        await using (var db = Db(options))
        {
            db.Shifts.Add(NewShift(Now.AddDays(3)));                        // a creation time in the future cannot be history
            await db.SaveChangesAsync();
        }

        await using var check = Db(options);
        Assert.Equal(At(Now), (await check.AuditLogs.SingleAsync()).ChangedAt);
    }

    [Fact]
    public async Task AnExplicitStamp_NamesTheTimeAndTheScriptedUser_AndIsUsedOnce()
    {
        var stamps = new DemoAuditStamps { NowUtc = Now };
        var options = Options(stamps);
        var id = Guid.NewGuid();
        var sarah = Guid.NewGuid();
        var decidedAt = new DateTime(2026, 10, 1, 22, 30, 0, DateTimeKind.Utc);
        await using (var db = Db(options))
        {
            db.Shifts.Add(NewShift(new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc), id));
            stamps.Set(id, decidedAt, sarah, "Sarah Mitchell");
            await db.SaveChangesAsync();
        }
        await using (var db = Db(options))
        {
            var shift = await db.Shifts.SingleAsync(s => s.Id == id);
            shift.Status = ShiftStatus.Cancelled;
            shift.UpdatedAt = Now;
            await db.SaveChangesAsync();                                    // no stamp this time: the one above was used up
        }

        await using var check = Db(options);
        var created = await check.AuditLogs.SingleAsync(l => l.Action == AuditAction.Created);
        Assert.Equal((At(decidedAt), (Guid?)sarah, "Sarah Mitchell"), (created.ChangedAt, created.ChangedById, created.ChangedByName));
        var updated = await check.AuditLogs.SingleAsync(l => l.Action == AuditAction.Updated);
        Assert.Equal(At(Now), updated.ChangedAt);
        Assert.Equal((Guid?)null, updated.ChangedById);
        Assert.Equal(DemoAuditActors.SystemName, updated.ChangedByName);
    }

    [Fact]
    public async Task TheChangesJson_IsExactlyWhatTheAuditInterceptorWroteOnItsOwn()
    {
        var created = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc);
        var id = Guid.NewGuid();
        var participantId = Guid.NewGuid();
        async Task<string> ChangesAsync(DemoAuditStamps? stamps)
        {
            var options = Options(stamps);
            await using (var db = Db(options))
            {
                var shift = NewShift(created, id);
                shift.ParticipantId = participantId;
                db.Shifts.Add(shift);
                await db.SaveChangesAsync();
            }
            await using var check = Db(options);
            return (await check.AuditLogs.SingleAsync()).Changes;
        }

        var plain = await ChangesAsync(null);
        var stamped = await ChangesAsync(new DemoAuditStamps { NowUtc = Now });

        Assert.Equal(plain, stamped);
        Assert.Contains("ServiceDate", stamped);
    }

    [Fact]
    public async Task WithoutTheStamper_TheAuditInterceptorStillStampsRealNowWithNoActor()
    {
        var options = Options(null);
        await using (var db = Db(options))
        {
            db.Shifts.Add(NewShift(new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc)));
            await db.SaveChangesAsync();
        }

        await using var check = Db(options);
        var log = await check.AuditLogs.SingleAsync();
        Assert.True(log.ChangedAt > DateTimeOffset.UtcNow.AddMinutes(-5));  // the behaviour L6 corrects, and which the app itself keeps
        Assert.Null(log.ChangedByName);
    }

    // ── through the maintainer, on the production pack list ──────────────────

    [Fact]
    public async Task AFullTick_StampsEveryAuditRowWithTheTimeOfTheRowItDescribes_AndAnActor_NeverInTheFuture()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        HashSet<Guid> fixtureRows;
        await using (var before = env.AdminDb()) fixtureRows = (await before.AuditLogs.Select(l => l.Id).ToListAsync()).ToHashSet();   // the fixture's own, written by the test

        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);

        Assert.Equal(DemoTickStatus.Ran, result.Status);
        Assert.Empty(result.Failures);
        await using var db = env.AdminDb();
        var logs = (await db.AuditLogs.ToListAsync()).Where(l => !fixtureRows.Contains(l.Id)).ToList();
        var shifts = await db.Shifts.ToDictionaryAsync(s => s.Id);
        Assert.True(logs.Count > 100, $"only {logs.Count} audit rows");
        Assert.All(logs, l => Assert.False(string.IsNullOrWhiteSpace(l.ChangedByName), $"{l.EntityType} {l.Action} has no actor"));
        Assert.All(logs, l => Assert.True(l.ChangedAt <= env.Clock.GetUtcNow(), $"{l.EntityType} {l.Action} is stamped in the future"));
        var created = logs.Where(l => l.EntityType == nameof(Shift) && l.Action == AuditAction.Created).ToList();
        Assert.True(created.Count > 20);
        Assert.All(created, l => Assert.Equal(At(shifts[l.EntityId].CreatedAt), l.ChangedAt));
        Assert.Contains(created, l => l.ChangedAt < env.Clock.GetUtcNow().AddDays(-7));       // shifts rostered before the tick keep their history
    }

    [Fact]
    public async Task ASecondTick_AddsNoAuditRow_SoNothingIsReStamped()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
        List<(Guid Id, DateTimeOffset At, string? By)> Rows()
        {
            using var db = env.AdminDb();
            return db.AuditLogs.AsEnumerable().Select(l => (l.Id, l.ChangedAt, l.ChangedByName)).OrderBy(r => r.Id).ToList();
        }
        var first = Rows();

        await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);

        Assert.Equal(first, Rows());
    }
}
