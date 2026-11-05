using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Retention;
using Odip.Tests.Claims;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Retention;

/// <summary>The nightly scan keeps ONE open "records due" task per organisation in step with the count, and never deletes a row.</summary>
public class RetentionScanTests
{
    private readonly string _store = Guid.NewGuid().ToString();
    private readonly FixedClock _clock = new(new DateTimeOffset(2026, 11, 5, 3, 0, 0, TimeSpan.Zero));

    private RetentionScanBackgroundService Scan(bool enabled = false)
    {
        var services = new ServiceCollection();
        services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(_store));
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { [RetentionScanBackgroundService.ScanEnabledKey] = enabled.ToString() }).Build();
        return new RetentionScanBackgroundService(services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(), config, NullLogger<RetentionScanBackgroundService>.Instance, _clock);
    }

    private OdipDbContext Db() => TestDb.Create(_store);

    private Guid Tenant(OdipDbContext db)
    {
        var id = Guid.NewGuid();
        db.Tenants.Add(new Tenant { Id = id, Name = "Org " + id.ToString("N")[..4], EmailDomain = $"{id:N}.example.com" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = id, State = "NSW" });
        db.SaveChanges();
        return id;
    }

    private static Participant Archived(OdipDbContext db, Guid tenantId, DateOnly start)
    {
        var p = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Lee", NdisNumber = Guid.NewGuid().ToString("N")[..11], PlanType = PlanType.SelfManaged, IsActive = false, RetentionStartsOn = start };
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static readonly DateOnly Old = new(2018, 1, 1);

    private static Task<List<BookingTask>> Tasks(OdipDbContext db, Guid tenantId) =>
        db.BookingTasks.IgnoreQueryFilters().AsNoTracking().Where(t => t.TenantId == tenantId && t.TaskType == TaskType.RetentionPurgeDue).ToListAsync();

    [Fact]
    public async Task One_task_for_the_organisation_with_due_records_and_none_for_the_other_and_no_participant_name()
    {
        await using var db = Db();
        var (a, b) = (Tenant(db), Tenant(db));
        Archived(db, a, Old); Archived(db, a, Old);
        Archived(db, b, new DateOnly(2025, 6, 1));
        var rowsBefore = (await db.Participants.CountAsync(), await db.Shifts.CountAsync());

        Assert.Equal(RetentionScanBackgroundService.Interval, await Scan().RunOnceAsync(CancellationToken.None));

        var task = Assert.Single(await Tasks(db, a));
        Assert.Equal("2 participant records are due for purge", task.Title);
        Assert.DoesNotContain("Lee", task.Title);
        Assert.Equal(RetentionScanBackgroundService.LinkTo, task.LinkTo);
        Assert.Empty(await Tasks(db, b));
        Assert.Equal(rowsBefore, (await db.Participants.CountAsync(), await db.Shifts.CountAsync())); // the scan deletes nothing
    }

    [Fact]
    public async Task A_second_run_makes_no_new_task_and_a_third_due_record_refreshes_the_title_in_place()
    {
        await using var db = Db();
        var a = Tenant(db);
        Archived(db, a, Old); Archived(db, a, Old);
        var scan = Scan();
        await scan.RunOnceAsync(CancellationToken.None);
        await scan.RunOnceAsync(CancellationToken.None);
        Assert.Single(await Tasks(db, a));

        Archived(db, a, Old);
        await scan.RunOnceAsync(CancellationToken.None);

        Assert.Equal("3 participant records are due for purge", Assert.Single(await Tasks(db, a)).Title);
    }

    [Fact]
    public async Task Completing_the_task_then_a_new_record_coming_due_raises_a_new_task()
    {
        await using var db = Db();
        var a = Tenant(db);
        Archived(db, a, Old);
        var scan = Scan();
        await scan.RunOnceAsync(CancellationToken.None);
        Assert.Single(await Tasks(db, a));
        db.BookingTasks.IgnoreQueryFilters().Single(t => t.TenantId == a).Status = TaskItemStatus.Completed;
        db.SaveChanges();

        _clock.Now = _clock.Now.AddDays(1);
        Archived(db, a, Old);
        await scan.RunOnceAsync(CancellationToken.None);

        var all = await Tasks(db, a);
        Assert.Equal(2, all.Count);
        Assert.Single(all, t => t.Status != TaskItemStatus.Completed);
    }

    [Fact]
    public async Task When_nothing_is_due_any_more_the_open_task_completes()
    {
        await using var db = Db();
        var a = Tenant(db);
        var p = Archived(db, a, Old);
        var scan = Scan();
        await scan.RunOnceAsync(CancellationToken.None);
        Assert.Equal(TaskItemStatus.NotStarted, Assert.Single(await Tasks(db, a)).Status);

        p.RetentionStartsOn = new DateOnly(2026, 1, 1); // a restore-and-archive, or a later claim
        db.SaveChanges();
        await scan.RunOnceAsync(CancellationToken.None);

        Assert.Equal(TaskItemStatus.Completed, Assert.Single(await Tasks(db, a)).Status);
    }

    [Fact]
    public async Task Switched_off_by_default_the_service_starts_and_finishes_without_scanning()
    {
        await using var db = Db();
        var a = Tenant(db);
        Archived(db, a, Old);
        var scan = Scan(enabled: false);

        await scan.StartAsync(CancellationToken.None);
        await scan.ExecuteTask!;

        Assert.Empty(await Tasks(db, a));
    }
}
