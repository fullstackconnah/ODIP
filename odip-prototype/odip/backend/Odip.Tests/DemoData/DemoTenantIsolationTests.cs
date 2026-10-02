using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// T5: the top-up writes to the Demo tenant and nowhere else. A snapshot of every row of every table (every tenant, every global table) is
/// taken before and after a full run; the only differences allowed are rows of the Demo tenant, the non-tenant rows that hang off its
/// users, and audit history about those. Another tenant's rows, the global tables and old audit rows are unchanged. With no Demo tenant,
/// or a tenant that merely looks like it, nothing at all is written.
/// </summary>
public class DemoTenantIsolationTests
{
    private static readonly Guid OdipTenant = Guid.Parse("a0000000-0000-0000-0000-000000000001");
    private static readonly Guid ConnahTenant = Guid.Parse("c0000000-0000-0000-0000-0000000000c1");

    /// <summary>Two other tenants with a bit of everything the top-up writes, plus global rows and some old audit history.</summary>
    private static async Task SeedForeignTenantsAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        db.Tenants.Add(new Tenant { Id = OdipTenant, Name = "Odip", EmailDomain = "odip.com.au", IsActive = true });
        db.Tenants.Add(new Tenant { Id = ConnahTenant, Name = "Connah", EmailDomain = "connah.example.com", IsActive = true });

        foreach (var (tenant, tag) in new[] { (OdipTenant, "odip"), (ConnahTenant, "connah") })
        {
            var user = new User { Id = Guid.NewGuid(), TenantId = tenant, Username = $"{tag}.worker", Email = $"{tag}.worker@example.com", FirstName = "Worker", LastName = tag, Role = UserRole.SupportWorker, IsFirstAidQualified = true };
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenant, FirstName = "Pat", LastName = tag, NdisNumber = "43099999" + (tag == "odip" ? "1" : "2"), IsActive = true };
            db.Users.Add(user);
            db.Participants.Add(participant);
            db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenant, State = "VIC", OrganisationName = $"{tag} provider", ABN = "11 111 111 111" });
            db.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = participant.Id, UserId = user.Id, ServiceDate = new DateOnly(2026, 10, 6), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Published });
            db.LeaveRequests.Add(new LeaveRequest { Id = Guid.NewGuid(), TenantId = tenant, UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = new DateOnly(2026, 10, 1), EndDate = new DateOnly(2026, 10, 3), Status = LeaveStatus.Pending, RequestedByUserId = user.Id, RequestedAt = new DateTime(2026, 9, 20, 0, 0, 0, DateTimeKind.Utc) });
            db.StaffAvailabilities.Add(new StaffAvailability { Id = Guid.NewGuid(), UserId = user.Id, StartDateTime = new DateTime(2026, 10, 7), EndDateTime = new DateTime(2026, 10, 7, 23, 59, 59), AvailabilityType = AvailabilityType.Unavailable });
            db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = nameof(User), EntityId = user.Id, Action = AuditAction.Created, ChangedAt = DateTimeOffset.UtcNow.AddDays(-30), Changes = "[]" });
        }
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = new DateOnly(2026, 10, 5), Name = "Labour Day", State = "NSW" });
        db.SupportActivityGroups.Add(new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "01", DisplayName = "Assistance with daily life" });
        db.EarlyAccessRequests.Add(new EarlyAccessRequest { Id = Guid.NewGuid(), Name = "A Visitor", Organisation = "Somewhere", Email = "visitor@example.com", CreatedAtUtc = DateTime.UtcNow, LastRequestedAtUtc = DateTime.UtcNow, RequestCount = 1 });
        await db.SaveChangesAsync();
    }

    private static async Task<DemoSnapshot> SnapshotAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        return DemoSnapshot.Take(db);
    }

    private static bool IsTenantRow(DemoSnapshot snapshot, string key, Guid tenant) =>
        snapshot.Row(key)!.TryGetValue("TenantId", out var value) && value == tenant.ToString("D");

    [Fact]
    public async Task T5_AFullRun_ChangesNothingOutsideTheDemoTenant()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        await SeedForeignTenantsAsync(env);
        var before = await SnapshotAsync(env);

        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);

        Assert.Equal(DemoTickStatus.Ran, result.Status);
        Assert.Empty(result.Failures);
        var after = await SnapshotAsync(env);
        var demoUsers = after.Keys.Where(k => DemoSnapshot.TypeOf(k) == nameof(User) && IsTenantRow(after, k, DemoTestEnv.DemoTenantId))
            .Select(k => k[(k.IndexOf('|') + 1)..]).ToHashSet();
        var demoIds = after.Keys.Where(k => after.Row(k)!.ContainsKey("TenantId") && IsTenantRow(after, k, DemoTestEnv.DemoTenantId)).Select(k => k[(k.IndexOf('|') + 1)..])
            .Concat(after.Keys.Where(k => DemoSnapshot.TypeOf(k) == nameof(StaffAvailability) && demoUsers.Contains(after.Row(k)!["UserId"])).Select(k => k[(k.IndexOf('|') + 1)..]))
            .ToHashSet();

        var changes = before.Diff(after);
        Assert.DoesNotContain(changes, c => c.Kind == "removed");
        Assert.NotEmpty(changes);
        foreach (var change in changes)
        {
            var type = DemoSnapshot.TypeOf(change.Key);
            var row = after.Row(change.Key)!;
            var allowed = type switch
            {
                nameof(AuditLog) => demoIds.Contains(row["EntityId"]),
                nameof(StaffAvailability) => demoUsers.Contains(row["UserId"]),
                _ => IsTenantRow(after, change.Key, DemoTestEnv.DemoTenantId),
            };
            Assert.True(allowed, $"{change.Key} was {change.Kind} but is not a Demo row");
        }

        // Spell it out for the rows that matter most: both other tenants, every global table, and the old audit history.
        foreach (var tenant in new[] { OdipTenant, ConnahTenant })
        {
            var theirs = before.Keys.Where(k => before.Row(k)!.ContainsKey("TenantId") && IsTenantRow(before, k, tenant)).ToList();
            Assert.NotEmpty(theirs);
            foreach (var key in theirs) Assert.Empty(before.Where(k => k == key).Diff(after.Where(k => k == key)));
        }
        foreach (var type in new[] { nameof(Tenant), nameof(PublicHoliday), nameof(SupportActivityGroup), nameof(EarlyAccessRequest) })
            Assert.Empty(before.Where(k => DemoSnapshot.TypeOf(k) == type).Diff(after.Where(k => DemoSnapshot.TypeOf(k) == type)));
        Assert.Empty(before.Where(k => DemoSnapshot.TypeOf(k) == nameof(AuditLog)).Diff(after.Where(k => before.Row(k) is not null && DemoSnapshot.TypeOf(k) == nameof(AuditLog))));
    }

    [Fact]
    public async Task T5_EveryNewNonTenantRow_HangsOffADemoUser_AndEveryNewAuditRowDescribesADemoEntity()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        await SeedForeignTenantsAsync(env);
        HashSet<Guid> auditBefore;
        await using (var pre = env.AdminDb()) auditBefore = (await pre.AuditLogs.Select(a => a.Id).ToListAsync()).ToHashSet();

        await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);

        await using var db = env.AdminDb();
        var demoUsers = await db.Users.Where(u => u.TenantId == DemoTestEnv.DemoTenantId).Select(u => u.Id).ToListAsync();
        var demoAvailability = await db.StaffAvailabilities.Where(a => demoUsers.Contains(a.UserId)).Select(a => a.Id).ToListAsync();
        Assert.True(demoAvailability.Count >= 7);
        // Both foreign users keep exactly their one availability row.
        var foreignUsers = await db.Users.Where(u => u.TenantId != DemoTestEnv.DemoTenantId).Select(u => u.Id).ToListAsync();
        Assert.Equal(2, await db.StaffAvailabilities.CountAsync(a => foreignUsers.Contains(a.UserId)));

        var demoEntityIds = new HashSet<Guid>(demoUsers.Concat(demoAvailability));
        demoEntityIds.UnionWith(DemoTenantEntityIds(db));                      // every row of every tenant table that carries the Demo tenant
        var newAudit = (await db.AuditLogs.ToListAsync()).Where(a => !auditBefore.Contains(a.Id)).ToList();
        Assert.True(newAudit.Count > 100, "the top-up's rows are audited like anyone's");
        Assert.All(newAudit, a => Assert.Contains(a.EntityId, demoEntityIds));
    }

    /// <summary>The ids of every row, of every table that has a tenant column, that belongs to the Demo tenant: audit history may describe any of them.</summary>
    private static List<Guid> DemoTenantEntityIds(OdipDbContext db)
    {
        var ids = new List<Guid>();
        foreach (var type in db.Model.GetEntityTypes().Select(t => t.ClrType).Where(t => typeof(ITenantEntity).IsAssignableFrom(t) && t.GetProperty("Id")?.PropertyType == typeof(Guid)))
        {
            var found = (IEnumerable<Guid>)typeof(DemoTenantIsolationTests).GetMethod(nameof(IdsOf), System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!
                .MakeGenericMethod(type).Invoke(null, new object[] { db })!;
            ids.AddRange(found);
        }
        return ids;
    }

    private static List<Guid> IdsOf<T>(OdipDbContext db) where T : class, ITenantEntity =>
        db.Set<T>().IgnoreQueryFilters().Where(e => e.TenantId == DemoTestEnv.DemoTenantId).Select(e => EF.Property<Guid>(e, "Id")).ToList();

    [Fact]
    public async Task T5_WithNoDemoTenant_NothingAtAllIsWritten()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await SeedForeignTenantsAsync(env);
        var before = await SnapshotAsync(env);

        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);

        Assert.Equal(DemoTickStatus.NoDemoTenant, result.Status);
        Assert.Empty(before.Diff(await SnapshotAsync(env)));
    }

    [Fact]
    public async Task T5_ATenantNamedDemoOnAnotherDomain_IsNotTheDemoTenant_AndNothingIsWritten()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await SeedForeignTenantsAsync(env);
        await env.AddTenantAsync("Demo", "demo.example.com", true, Guid.NewGuid());
        var before = await SnapshotAsync(env);

        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);

        Assert.Equal(DemoTickStatus.NoDemoTenant, result.Status);
        Assert.Empty(before.Diff(await SnapshotAsync(env)));
    }

    [Fact]
    public async Task T5_TheDemoTenantAloneWithNoOtherTenants_StillRunsCleanly()
    {
        var env = new DemoTestEnv(new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);

        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);

        Assert.Equal(DemoTickStatus.Ran, result.Status);
        Assert.Empty(result.Failures);
    }
}
