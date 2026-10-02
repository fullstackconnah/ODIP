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
/// T5 (the guard half): every demo write is checked before it reaches the database. A row for another tenant, a table the top-up has no
/// business touching, a changed identity column, a delete, or an audit row about somebody else's entity is refused, whatever the pack
/// that produced it intended. The guard is the reason a bug in a pack can cost a demo a bad day but never another tenant's data.
/// </summary>
public class DemoTenantGuardTests
{
    private static readonly Guid DemoTenant = Guid.Parse("b0000000-0000-0000-0000-000000000001");
    private static readonly Guid OtherTenant = Guid.Parse("a0000000-0000-0000-0000-000000000001");

    private static DbContextOptions<OdipDbContext> NewOptions(params IInterceptor[] interceptors) =>
        new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(interceptors)
            .Options;

    private static OdipDbContext NewDb(DbContextOptions<OdipDbContext> options, Guid? tenantId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId ?? DemoTenant);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new OdipDbContext(options, tenant.Object);
    }

    private static DemoTenantGuard NewGuard(params Guid[] knownUsers)
    {
        var owned = new DemoOwnedIds();
        foreach (var id in knownUsers) owned.Users.Add(id);
        return new DemoTenantGuard(DemoTenant, owned);
    }

    private static User NewUser(Guid? tenantId = null, string email = "jade.watkins@demo.odip.com.au") => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId ?? DemoTenant, Username = email, Email = email, FirstName = "Jade", LastName = "Watkins",
        Role = UserRole.SupportWorker, IsFirstAidQualified = true,
    };

    private static Shift NewShift(Guid? tenantId = null) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId ?? DemoTenant, ParticipantId = Guid.NewGuid(), ServiceDate = new DateOnly(2026, 10, 5),
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Published,
    };

    private static async Task<OdipDbContext> DbWithAsync(DbContextOptions<OdipDbContext> options, params object[] rows)
    {
        await using (var seed = NewDb(options))
        {
            seed.AddRange(rows);
            await seed.SaveChangesAsync();
        }
        return NewDb(options);
    }

    [Fact]
    public async Task Passes_ARowForTheDemoTenant()
    {
        await using var db = NewDb(NewOptions());
        db.Shifts.Add(NewShift());

        NewGuard().Verify(db.ChangeTracker);
    }

    [Fact]
    public async Task Rejects_ARowForAnotherTenant()
    {
        await using var db = NewDb(NewOptions());
        db.Shifts.Add(NewShift(OtherTenant));

        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));

        Assert.Contains("Shift", ex.Message);
        Assert.Contains("another tenant", ex.Message);
    }

    [Fact]
    public async Task Rejects_ARowWithNoTenantAtAll()
    {
        await using var db = NewDb(NewOptions());
        db.Shifts.Add(NewShift(Guid.Empty));

        Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
    }

    [Fact]
    public async Task Rejects_EveryTableTheTopUpHasNoBusinessWriting()
    {
        // Global tables (no tenant column), a tenant table nobody asked for, and a non-tenant child table with no rule: all refused.
        object[] rows =
        {
            new Tenant { Id = Guid.NewGuid(), Name = "Demo 2", EmailDomain = "demo2.example.com" },
            new PublicHoliday { Id = Guid.NewGuid(), Date = new DateOnly(2026, 10, 5), Name = "Labour Day", State = "NSW" },
            new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "X", DisplayName = "X" },
            new Participant { Id = Guid.NewGuid(), TenantId = DemoTenant, FirstName = "New", LastName = "Person" },
            new IncidentReport { Id = Guid.NewGuid() },
            new EarlyAccessRequest { Id = Guid.NewGuid(), Name = "x", Organisation = "x", Email = "x@example.com" },
        };

        foreach (var row in rows)
        {
            await using var db = NewDb(NewOptions());
            db.Add(row);

            var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
            Assert.Contains(row.GetType().Name, ex.Message);
        }
    }

    [Theory]
    [InlineData(nameof(User.WorkerScreeningNumber))]
    [InlineData(nameof(User.WorkerScreeningExpiryDate))]
    [InlineData(nameof(User.FirstAidExpiryDate))]
    [InlineData(nameof(User.DriverLicenceExpiryDate))]
    [InlineData(nameof(User.ManualHandlingExpiryDate))]
    [InlineData(nameof(User.MedicationCompetencyExpiryDate))]
    public async Task AnExistingUser_MayHaveItsCredentialColumnsFilled(string property)
    {
        var options = NewOptions();
        var user = NewUser();
        await using var db = await DbWithAsync(options, user);
        var tracked = await db.Users.SingleAsync(u => u.Id == user.Id);

        switch (property)
        {
            case nameof(User.WorkerScreeningNumber): tracked.WorkerScreeningNumber = "WS-DEMO-0001"; break;
            case nameof(User.WorkerScreeningExpiryDate): tracked.WorkerScreeningExpiryDate = new DateOnly(2027, 1, 1); break;
            case nameof(User.FirstAidExpiryDate): tracked.FirstAidExpiryDate = new DateOnly(2027, 1, 1); break;
            case nameof(User.DriverLicenceExpiryDate): tracked.DriverLicenceExpiryDate = new DateOnly(2027, 1, 1); break;
            case nameof(User.ManualHandlingExpiryDate): tracked.ManualHandlingExpiryDate = new DateOnly(2027, 1, 1); break;
            default: tracked.MedicationCompetencyExpiryDate = new DateOnly(2027, 1, 1); break;
        }
        tracked.UpdatedAt = DateTime.UtcNow;

        NewGuard(user.Id).Verify(db.ChangeTracker);
    }

    [Theory]
    [InlineData(nameof(User.Email))]
    [InlineData(nameof(User.Username))]
    [InlineData(nameof(User.Role))]
    [InlineData(nameof(User.FirstName))]
    [InlineData(nameof(User.IsActive))]
    [InlineData(nameof(User.IsMedicationCompetent))]
    [InlineData(nameof(User.TenantId))]
    public async Task AnExistingUser_NeverHasItsIdentityEmailRoleOrFlagsChanged(string property)
    {
        var options = NewOptions();
        var user = NewUser();
        await using var db = await DbWithAsync(options, user);
        var tracked = await db.Users.SingleAsync(u => u.Id == user.Id);

        switch (property)
        {
            case nameof(User.Email): tracked.Email = "someone.else@demo.odip.com.au"; break;
            case nameof(User.Username): tracked.Username = "someone.else"; break;
            case nameof(User.Role): tracked.Role = UserRole.Admin; break;
            case nameof(User.FirstName): tracked.FirstName = "Renamed"; break;
            case nameof(User.IsActive): tracked.IsActive = false; break;
            case nameof(User.IsMedicationCompetent): tracked.IsMedicationCompetent = true; break;
            default: tracked.TenantId = OtherTenant; break;
        }

        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard(user.Id).Verify(db.ChangeTracker));
        Assert.Contains(property, ex.Message);
    }

    [Fact]
    public async Task AShift_MayMoveStatus_ButIsNeverReassignedOrRescheduled()
    {
        var options = NewOptions();
        var shift = NewShift();
        await using var db = await DbWithAsync(options, shift);

        var tracked = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        tracked.Status = ShiftStatus.PendingReview;
        tracked.UpdatedAt = DateTime.UtcNow;
        NewGuard().Verify(db.ChangeTracker);

        tracked.UserId = Guid.NewGuid();
        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.Contains(nameof(Shift.UserId), ex.Message);
    }

    [Fact]
    public async Task Rejects_AnyDelete()
    {
        var options = NewOptions();
        var shift = NewShift();
        await using var db = await DbWithAsync(options, shift);
        db.Shifts.Remove(await db.Shifts.SingleAsync(s => s.Id == shift.Id));

        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.Contains("delete", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ANonTenantRow_MustHangOffAUserTheDemoTenantOwns()
    {
        var demoUser = Guid.NewGuid();
        var strangerUser = Guid.NewGuid();
        await using var db = NewDb(NewOptions());

        db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = demoUser, StartDateTime = new DateTime(2026, 10, 9), EndDateTime = new DateTime(2026, 10, 9, 23, 59, 59),
            AvailabilityType = AvailabilityType.Unavailable,
        });
        NewGuard(demoUser).Verify(db.ChangeTracker);

        db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = strangerUser, StartDateTime = new DateTime(2026, 10, 9), EndDateTime = new DateTime(2026, 10, 9, 23, 59, 59),
            AvailabilityType = AvailabilityType.Unavailable,
        });
        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard(demoUser).Verify(db.ChangeTracker));
        Assert.Contains("StaffAvailability", ex.Message);
    }

    [Fact]
    public async Task AParentAddedInTheSameSave_CountsAsOwned()
    {
        await using var db = NewDb(NewOptions());
        var newUser = NewUser();
        db.Users.Add(newUser);
        db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = newUser.Id, StartDateTime = new DateTime(2026, 10, 9), EndDateTime = new DateTime(2026, 10, 9, 23, 59, 59),
            AvailabilityType = AvailabilityType.Unavailable,
        });

        // The user is not on the list, but it is being added in this same save and passed the tenant rule, so the child is reachable.
        // (A user addition is itself refused, so this checks the parent lookup in isolation through the violation list.)
        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.DoesNotContain("StaffAvailability", ex.Message);
        Assert.Contains("User", ex.Message);
    }

    [Fact]
    public async Task AuditRows_MustPointAtEntitiesInTheSameSaveOrOnesTheDemoTenantOwns()
    {
        await using var db = NewDb(NewOptions());
        var shift = NewShift();
        db.Shifts.Add(shift);
        db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = nameof(Shift), EntityId = shift.Id, Action = AuditAction.Created, ChangedAt = DateTimeOffset.UtcNow });
        NewGuard().Verify(db.ChangeTracker);

        db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = nameof(Participant), EntityId = Guid.NewGuid(), Action = AuditAction.Updated, ChangedAt = DateTimeOffset.UtcNow });
        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.Contains("AuditLog", ex.Message);
    }

    [Fact]
    public async Task AuditRows_AboutAKnownDemoUser_AreFine()
    {
        var demoUser = Guid.NewGuid();
        await using var db = NewDb(NewOptions());
        db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = nameof(User), EntityId = demoUser, Action = AuditAction.Updated, ChangedAt = DateTimeOffset.UtcNow });

        NewGuard(demoUser).Verify(db.ChangeTracker);
    }

    [Fact]
    public async Task TheInterceptor_StopsTheSave_BeforeAnythingIsWritten()
    {
        var guard = NewGuard();
        var options = NewOptions(new DemoGuardInterceptor(guard));
        await using (var db = NewDb(options))
        {
            db.Shifts.Add(NewShift());                  // fine
            db.Shifts.Add(NewShift(OtherTenant));       // not fine
            await Assert.ThrowsAsync<DemoGuardViolationException>(() => db.SaveChangesAsync());
        }

        await using var check = NewDb(options);
        Assert.Equal(0, await check.Shifts.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task TheInterceptor_SeesTheAuditRowsTheAuditInterceptorAdds_WhenItRunsAfterIt()
    {
        var guard = NewGuard();
        var audit = new AuditInterceptor(new HttpContextAccessor());
        var options = NewOptions(audit, new DemoGuardInterceptor(guard));
        await using (var db = NewDb(options))
        {
            db.Shifts.Add(NewShift());
            await db.SaveChangesAsync();                // the shift's own "Created" audit row points at the shift in this save: allowed
        }

        await using var check = NewDb(options);
        Assert.Equal(1, await check.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task TheViolationReportsEveryProblem_NotJustTheFirst()
    {
        await using var db = NewDb(NewOptions());
        db.Shifts.Add(NewShift(OtherTenant));
        db.Shifts.Add(NewShift(Guid.Empty));
        db.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = new DateOnly(2026, 10, 5), Name = "Labour Day", State = "NSW" });

        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));

        Assert.Equal(3, ex.Violations.Count);
    }
}
