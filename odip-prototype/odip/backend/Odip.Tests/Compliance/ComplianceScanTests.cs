using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Tasks;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Tasks;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Compliance;

/// <summary>The nightly compliance scan: one Admin task per date from 90 days out, retitled at 30 days and when the date passes, closed when the date moves or goes, and always inside its own organisation.</summary>
public class ComplianceScanTests
{
    private sealed class MutableClock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static readonly DateOnly Expires = new(2027, 2, 4);

    private readonly string _store = Guid.NewGuid().ToString();
    // 6 Nov 2026 01:30 in Sydney (NSW, +11): the provider's today is the 6th while the UTC date is still the 5th.
    private readonly MutableClock _clock = new(new DateTimeOffset(2026, 11, 5, 14, 30, 0, TimeSpan.Zero));

    private ComplianceScanBackgroundService Scan()
    {
        var services = new ServiceCollection();
        services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(_store));
        var config = new ConfigurationBuilder().Build();
        return new ComplianceScanBackgroundService(services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(), config, NullLogger<ComplianceScanBackgroundService>.Instance, _clock);
    }

    private OdipDbContext Db() => TestDb.Create(_store);

    private static Guid Tenant(OdipDbContext db)
    {
        var id = Guid.NewGuid();
        db.Tenants.Add(new Tenant { Id = id, Name = "Org " + id.ToString("N")[..4], EmailDomain = $"{id:N}.example.com" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = id, State = "NSW" });
        db.SaveChanges();
        return id;
    }

    private static ComplianceItem Item(OdipDbContext db, Guid tenantId, DateOnly on, ComplianceKind kind = ComplianceKind.Registration, string label = "NDIS registration")
    {
        var item = new ComplianceItem { Id = Guid.NewGuid(), TenantId = tenantId, Kind = kind, Label = label, ExpiresOn = on };
        db.ComplianceItems.Add(item);
        db.SaveChanges();
        return item;
    }

    /// <summary>Sets the clock to 14:00 in Sydney on this date (03:00 UTC, the same calendar day in both zones' offsets).</summary>
    private void SydneyDay(DateOnly date) => _clock.Now = new DateTimeOffset(date.ToDateTime(new TimeOnly(3, 0)), TimeSpan.Zero);

    private static Task<List<BookingTask>> Tasks(OdipDbContext db, Guid tenantId) =>
        db.BookingTasks.IgnoreQueryFilters().AsNoTracking().Where(t => t.TenantId == tenantId && t.TaskType == TaskType.ComplianceDue).ToListAsync();

    [Fact]
    public void The_scan_is_on_when_nothing_is_configured() =>
        Assert.True(ComplianceScanBackgroundService.Enabled(new ConfigurationBuilder().Build()));

    [Fact]
    public void The_scan_can_be_switched_off()
    {
        var off = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { [ComplianceScanBackgroundService.ScanEnabledKey] = "false" }).Build();
        Assert.False(ComplianceScanBackgroundService.Enabled(off));
    }

    [Fact]
    public async Task No_task_at_91_days_and_one_task_at_90_with_the_date_the_link_and_the_first_band_title()
    {
        await using var db = Db();
        var tenant = Tenant(db);
        var item = Item(db, tenant, Expires);

        SydneyDay(Expires.AddDays(-91));
        await Scan().RunOnceAsync(CancellationToken.None);
        Assert.Empty(await Tasks(db, tenant));

        SydneyDay(Expires.AddDays(-90));
        await Scan().RunOnceAsync(CancellationToken.None);
        var task = Assert.Single(await Tasks(db, tenant));
        Assert.Equal("NDIS registration expires on 4 Feb 2027", task.Title);
        Assert.Equal(Expires, task.DueDate);
        Assert.Equal(ComplianceDueTasks.LinkTo, task.LinkTo);
        Assert.Equal(ComplianceDueTasks.SourceKey(item.Id, Expires), task.SourceKey);
    }

    [Fact]
    public async Task At_30_days_the_same_single_task_is_retitled_and_a_second_scan_the_same_day_adds_nothing()
    {
        await using var db = Db();
        var tenant = Tenant(db);
        Item(db, tenant, Expires);
        SydneyDay(Expires.AddDays(-90));
        await Scan().RunOnceAsync(CancellationToken.None);
        var first = Assert.Single(await Tasks(db, tenant));

        SydneyDay(Expires.AddDays(-31));
        await Scan().RunOnceAsync(CancellationToken.None);
        Assert.Equal("NDIS registration expires on 4 Feb 2027", Assert.Single(await Tasks(db, tenant)).Title);

        SydneyDay(Expires.AddDays(-30));
        await Scan().RunOnceAsync(CancellationToken.None);
        await Scan().RunOnceAsync(CancellationToken.None);
        var task = Assert.Single(await Tasks(db, tenant));
        Assert.Equal(first.Id, task.Id);
        Assert.Equal("NDIS registration expires within 30 days, on 4 Feb 2027", task.Title);
    }

    [Fact]
    public async Task The_day_after_the_date_the_title_says_expired_and_the_house_overdue_rule_counts_it()
    {
        await using var db = Db();
        var tenant = Tenant(db);
        Item(db, tenant, Expires);
        SydneyDay(Expires);
        await Scan().RunOnceAsync(CancellationToken.None);
        Assert.Equal(0, await db.BookingTasks.IgnoreQueryFilters().CountAsync(TaskOverdue.IsOverdueExpr(Expires))); // the day itself is not overdue

        SydneyDay(Expires.AddDays(1));
        await Scan().RunOnceAsync(CancellationToken.None);

        Assert.Equal("NDIS registration expired on 4 Feb 2027", Assert.Single(await Tasks(db, tenant)).Title);
        Assert.Equal(1, await db.BookingTasks.IgnoreQueryFilters().CountAsync(TaskOverdue.IsOverdueExpr(Expires.AddDays(1))));
    }

    [Fact]
    public async Task An_audit_says_is_due_and_was_due()
    {
        await using var db = Db();
        var tenant = Tenant(db);
        Item(db, tenant, Expires, ComplianceKind.Audit, "Certification audit");
        SydneyDay(Expires.AddDays(-60));
        await Scan().RunOnceAsync(CancellationToken.None);
        Assert.Equal("Certification audit is due on 4 Feb 2027", Assert.Single(await Tasks(db, tenant)).Title);

        SydneyDay(Expires.AddDays(-10));
        await Scan().RunOnceAsync(CancellationToken.None);
        Assert.Equal("Certification audit is due within 30 days, on 4 Feb 2027", Assert.Single(await Tasks(db, tenant)).Title);

        SydneyDay(Expires.AddDays(2));
        await Scan().RunOnceAsync(CancellationToken.None);
        Assert.Equal("Certification audit was due on 4 Feb 2027", Assert.Single(await Tasks(db, tenant)).Title);
    }

    [Fact]
    public async Task Today_follows_the_providers_zone_not_the_utc_date()
    {
        await using var db = Db();
        var tenant = Tenant(db);
        Item(db, tenant, new DateOnly(2027, 2, 4)); // 90 days after the 6th of November, 91 after the 5th
        // _clock is 5 Nov 14:30 UTC = 6 Nov in Sydney.
        await Scan().RunOnceAsync(CancellationToken.None);
        Assert.Single(await Tasks(db, tenant));
    }

    [Fact]
    public async Task A_moved_date_closes_the_old_task_and_opens_the_new_one_and_a_deleted_date_closes_its_task()
    {
        await using var db = Db();
        var tenant = Tenant(db);
        var item = Item(db, tenant, Expires);
        SydneyDay(Expires.AddDays(-60));
        await Scan().RunOnceAsync(CancellationToken.None);

        item.ExpiresOn = Expires.AddDays(20);
        await db.SaveChangesAsync();
        await Scan().RunOnceAsync(CancellationToken.None);

        var both = await Tasks(db, tenant);
        Assert.Equal(2, both.Count);
        Assert.Equal(TaskItemStatus.Completed, Assert.Single(both, t => t.DueDate == Expires).Status);
        Assert.Equal(TaskItemStatus.NotStarted, Assert.Single(both, t => t.DueDate == Expires.AddDays(20)).Status);

        db.ComplianceItems.Remove(item);
        await db.SaveChangesAsync();
        await Scan().RunOnceAsync(CancellationToken.None);
        Assert.All(await Tasks(db, tenant), t => Assert.Equal(TaskItemStatus.Completed, t.Status));
    }

    [Fact]
    public async Task A_task_an_admin_ticked_off_is_not_reopened_by_the_next_band()
    {
        await using var db = Db();
        var tenant = Tenant(db);
        Item(db, tenant, Expires);
        SydneyDay(Expires.AddDays(-80));
        await Scan().RunOnceAsync(CancellationToken.None);
        var task = await db.BookingTasks.IgnoreQueryFilters().SingleAsync(t => t.TenantId == tenant);
        task.Status = TaskItemStatus.Completed;
        await db.SaveChangesAsync();

        SydneyDay(Expires.AddDays(-20));
        await Scan().RunOnceAsync(CancellationToken.None);

        var after = Assert.Single(await Tasks(db, tenant));
        Assert.Equal(TaskItemStatus.Completed, after.Status);
        Assert.Equal("NDIS registration expires on 4 Feb 2027", after.Title);
    }

    [Fact]
    public async Task Two_organisations_each_keep_exactly_their_own_task_and_a_second_run_closes_neither()
    {
        await using var db = Db();
        var (a, b) = (Tenant(db), Tenant(db));
        Item(db, a, Expires, ComplianceKind.KeyPersonnel, "Sam Lee, Chief executive");
        Item(db, b, Expires.AddDays(1), ComplianceKind.Insurance, "Public liability insurance");
        SydneyDay(Expires.AddDays(-60));

        await Scan().RunOnceAsync(CancellationToken.None);
        await Scan().RunOnceAsync(CancellationToken.None);

        var taskA = Assert.Single(await Tasks(db, a));
        var taskB = Assert.Single(await Tasks(db, b));
        Assert.Contains("Sam Lee", taskA.Title);
        Assert.DoesNotContain("Sam Lee", taskB.Title);
        Assert.Equal(TaskItemStatus.NotStarted, taskA.Status);
        Assert.Equal(TaskItemStatus.NotStarted, taskB.Status);
    }
}
