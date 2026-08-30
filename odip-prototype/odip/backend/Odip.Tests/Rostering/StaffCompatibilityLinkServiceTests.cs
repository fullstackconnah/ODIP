using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Covers <see cref="StaffCompatibilityLinkService"/> (task 6d): the link between
/// <see cref="Participant.PreferredStaffId"/> and the rostering
/// <see cref="StaffParticipantCompatibility"/> matrix. Same EF InMemory + Moq&lt;ICurrentTenant&gt;
/// pattern as <c>RosteringControllerTests</c>. Each test calls the service directly against a
/// tracked <c>OdipDbContext</c> and then calls <c>SaveChangesAsync</c> itself — mirroring how
/// <c>ParticipantsController</c>/<c>RosteringController</c> use it (the service only mutates the
/// change tracker; the caller commits).
/// </summary>
public class StaffCompatibilityLinkServiceTests
{
    private static OdipDbContext CreateDb(string dbName, Guid? tenantId = null, bool isSuperAdmin = true)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(isSuperAdmin);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static Staff SeedStaff(OdipDbContext db, string firstName = "Ben", string lastName = "Turner")
    {
        var staff = new Staff { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, Role = StaffRole.SupportWorker, IsActive = true };
        db.Staff.Add(staff);
        db.SaveChanges();
        return staff;
    }

    private static Participant SeedParticipant(OdipDbContext db, string firstName = "Amy", string lastName = "Ng", Guid? preferredStaffId = null)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true, PreferredStaffId = preferredStaffId };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    // ── SyncFromParticipantPreferredStaffAsync: set/create ─────────────────

    [Fact]
    public async Task SetPreferredStaff_NoExistingRow_CreatesAutoLinkedPreferredRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var service = new StaffCompatibilityLinkService(db);

        await service.SyncFromParticipantPreferredStaffAsync(participant.Id, null, staff.Id, CancellationToken.None);
        await db.SaveChangesAsync();

        var row = await db.StaffParticipantCompatibilities.SingleAsync(c => c.StaffId == staff.Id && c.ParticipantId == participant.Id);
        Assert.Equal(CompatibilityLevel.Preferred, row.Level);
        Assert.True(row.AutoLinked);
        Assert.False(string.IsNullOrEmpty(row.Reason));
    }

    [Fact]
    public async Task SetPreferredStaff_SameValueTwice_IsANoOp()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var service = new StaffCompatibilityLinkService(db);

        await service.SyncFromParticipantPreferredStaffAsync(participant.Id, null, staff.Id, CancellationToken.None);
        await db.SaveChangesAsync();

        // Second call with oldStaffId == newStaffId (both staff.Id) must not touch anything.
        await service.SyncFromParticipantPreferredStaffAsync(participant.Id, staff.Id, staff.Id, CancellationToken.None);
        await db.SaveChangesAsync();

        var rows = await db.StaffParticipantCompatibilities.Where(c => c.StaffId == staff.Id && c.ParticipantId == participant.Id).ToListAsync();
        Assert.Single(rows);
    }

    [Fact]
    public async Task SetPreferredStaff_ExistingHumanManagedAllowedRow_IsNotUpgradedToPreferred()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), StaffId = staff.Id, ParticipantId = participant.Id,
            Level = CompatibilityLevel.Allowed, AutoLinked = false, Reason = "Coordinator note", UpdatedAt = DateTime.UtcNow,
        });
        db.SaveChanges();
        var service = new StaffCompatibilityLinkService(db);

        await service.SyncFromParticipantPreferredStaffAsync(participant.Id, null, staff.Id, CancellationToken.None);
        await db.SaveChangesAsync();

        var row = await db.StaffParticipantCompatibilities.SingleAsync(c => c.StaffId == staff.Id && c.ParticipantId == participant.Id);
        Assert.Equal(CompatibilityLevel.Allowed, row.Level); // untouched
        Assert.Equal("Coordinator note", row.Reason);
        Assert.False(row.AutoLinked);
    }

    [Fact]
    public async Task SetPreferredStaff_ExistingHumanManagedExcludedRow_IsNeverSilentlyUpgraded()
    {
        // The safety-critical case: a human excluded this pair (e.g. a documented incident).
        // Picking that same staff member as "preferred" on the participant must not paper over it.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), StaffId = staff.Id, ParticipantId = participant.Id,
            Level = CompatibilityLevel.Excluded, AutoLinked = false, Reason = "Documented incident", UpdatedAt = DateTime.UtcNow,
        });
        db.SaveChanges();
        var service = new StaffCompatibilityLinkService(db);

        await service.SyncFromParticipantPreferredStaffAsync(participant.Id, null, staff.Id, CancellationToken.None);
        await db.SaveChangesAsync();

        var row = await db.StaffParticipantCompatibilities.SingleAsync(c => c.StaffId == staff.Id && c.ParticipantId == participant.Id);
        Assert.Equal(CompatibilityLevel.Excluded, row.Level);
        Assert.Equal("Documented incident", row.Reason);
    }

    // ── SyncFromParticipantPreferredStaffAsync: change ──────────────────────

    [Fact]
    public async Task ChangePreferredStaff_RemovesOldAutoLinkedRow_CreatesNewOne()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var oldStaff = SeedStaff(db, "Old", "Staff");
        var newStaff = SeedStaff(db, "New", "Staff");
        var participant = SeedParticipant(db);
        var service = new StaffCompatibilityLinkService(db);

        await service.SyncFromParticipantPreferredStaffAsync(participant.Id, null, oldStaff.Id, CancellationToken.None);
        await db.SaveChangesAsync();

        await service.SyncFromParticipantPreferredStaffAsync(participant.Id, oldStaff.Id, newStaff.Id, CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.False(await db.StaffParticipantCompatibilities.AnyAsync(c => c.StaffId == oldStaff.Id && c.ParticipantId == participant.Id));
        var newRow = await db.StaffParticipantCompatibilities.SingleAsync(c => c.StaffId == newStaff.Id && c.ParticipantId == participant.Id);
        Assert.Equal(CompatibilityLevel.Preferred, newRow.Level);
        Assert.True(newRow.AutoLinked);
    }

    [Fact]
    public async Task ChangePreferredStaff_OldRowIsHumanManaged_IsNeverDeleted()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var oldStaff = SeedStaff(db, "Old", "Staff");
        var newStaff = SeedStaff(db, "New", "Staff");
        var participant = SeedParticipant(db);
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), StaffId = oldStaff.Id, ParticipantId = participant.Id,
            Level = CompatibilityLevel.Preferred, AutoLinked = false, Reason = "Set by coordinator directly", UpdatedAt = DateTime.UtcNow,
        });
        db.SaveChanges();
        var service = new StaffCompatibilityLinkService(db);

        await service.SyncFromParticipantPreferredStaffAsync(participant.Id, oldStaff.Id, newStaff.Id, CancellationToken.None);
        await db.SaveChangesAsync();

        // Human-edited row for the old pairing survives, level untouched.
        var oldRow = await db.StaffParticipantCompatibilities.SingleAsync(c => c.StaffId == oldStaff.Id && c.ParticipantId == participant.Id);
        Assert.Equal(CompatibilityLevel.Preferred, oldRow.Level);
        Assert.Equal("Set by coordinator directly", oldRow.Reason);
    }

    // ── SyncFromParticipantPreferredStaffAsync: clear ───────────────────────

    [Fact]
    public async Task ClearPreferredStaff_AutoLinkedRow_IsRemoved()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        var service = new StaffCompatibilityLinkService(db);

        await service.SyncFromParticipantPreferredStaffAsync(participant.Id, null, staff.Id, CancellationToken.None);
        await db.SaveChangesAsync();
        Assert.True(await db.StaffParticipantCompatibilities.AnyAsync(c => c.StaffId == staff.Id && c.ParticipantId == participant.Id));

        await service.SyncFromParticipantPreferredStaffAsync(participant.Id, staff.Id, null, CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.False(await db.StaffParticipantCompatibilities.AnyAsync(c => c.StaffId == staff.Id && c.ParticipantId == participant.Id));
    }

    [Fact]
    public async Task ClearPreferredStaff_HumanManagedRow_IsNeverRemoved()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db);
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), StaffId = staff.Id, ParticipantId = participant.Id,
            Level = CompatibilityLevel.Preferred, AutoLinked = false, Reason = "Marked directly in the matrix", UpdatedAt = DateTime.UtcNow,
        });
        db.SaveChanges();
        var service = new StaffCompatibilityLinkService(db);

        await service.SyncFromParticipantPreferredStaffAsync(participant.Id, staff.Id, null, CancellationToken.None);
        await db.SaveChangesAsync();

        var row = await db.StaffParticipantCompatibilities.SingleAsync(c => c.StaffId == staff.Id && c.ParticipantId == participant.Id);
        Assert.Equal(CompatibilityLevel.Preferred, row.Level);
        Assert.Equal("Marked directly in the matrix", row.Reason);
    }

    // ── SyncFromCompatibilityUpsertAsync: reflect matrix -> participant ─────

    [Fact]
    public async Task MarkPreferredInMatrix_ParticipantPreferredStaffIdEmpty_IsPopulated()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db, preferredStaffId: null);
        var service = new StaffCompatibilityLinkService(db);

        var row = new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), StaffId = staff.Id, ParticipantId = participant.Id,
            Level = CompatibilityLevel.Preferred, AutoLinked = false, UpdatedAt = DateTime.UtcNow,
        };
        db.StaffParticipantCompatibilities.Add(row);

        await service.SyncFromCompatibilityUpsertAsync(row, CompatibilityLevel.Allowed, CancellationToken.None);
        await db.SaveChangesAsync();

        var reloaded = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.Equal(staff.Id, reloaded.PreferredStaffId);
    }

    [Fact]
    public async Task MarkPreferredInMatrix_ParticipantAlreadyHasADifferentPreferredStaff_IsNotOverwritten()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var existingPreferred = SeedStaff(db, "Existing", "Preferred");
        var newlyMarkedPreferred = SeedStaff(db, "Newly", "Marked");
        var participant = SeedParticipant(db, preferredStaffId: existingPreferred.Id);
        var service = new StaffCompatibilityLinkService(db);

        var row = new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), StaffId = newlyMarkedPreferred.Id, ParticipantId = participant.Id,
            Level = CompatibilityLevel.Preferred, AutoLinked = false, UpdatedAt = DateTime.UtcNow,
        };
        db.StaffParticipantCompatibilities.Add(row);

        await service.SyncFromCompatibilityUpsertAsync(row, CompatibilityLevel.Allowed, CancellationToken.None);
        await db.SaveChangesAsync();

        var reloaded = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.Equal(existingPreferred.Id, reloaded.PreferredStaffId); // unchanged
    }

    [Fact]
    public async Task MoveOffPreferredInMatrix_MatchesParticipantsCurrentPreferredStaffId_ClearsIt()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = SeedParticipant(db, preferredStaffId: staff.Id);
        var service = new StaffCompatibilityLinkService(db);

        var row = new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), StaffId = staff.Id, ParticipantId = participant.Id,
            Level = CompatibilityLevel.Excluded, AutoLinked = false, Reason = "New incident", UpdatedAt = DateTime.UtcNow,
        };
        db.StaffParticipantCompatibilities.Add(row);

        await service.SyncFromCompatibilityUpsertAsync(row, CompatibilityLevel.Preferred, CancellationToken.None);
        await db.SaveChangesAsync();

        var reloaded = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.Null(reloaded.PreferredStaffId);
    }

    [Fact]
    public async Task MoveOffPreferredInMatrix_DoesNotMatchParticipantsCurrentPreferredStaffId_LeavesItAlone()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var someoneElse = SeedStaff(db, "Someone", "Else");
        var staff = SeedStaff(db, "Downgraded", "Staff");
        var participant = SeedParticipant(db, preferredStaffId: someoneElse.Id);
        var service = new StaffCompatibilityLinkService(db);

        var row = new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), StaffId = staff.Id, ParticipantId = participant.Id,
            Level = CompatibilityLevel.Excluded, AutoLinked = false, UpdatedAt = DateTime.UtcNow,
        };
        db.StaffParticipantCompatibilities.Add(row);

        await service.SyncFromCompatibilityUpsertAsync(row, CompatibilityLevel.Preferred, CancellationToken.None);
        await db.SaveChangesAsync();

        var reloaded = await db.Participants.SingleAsync(p => p.Id == participant.Id);
        Assert.Equal(someoneElse.Id, reloaded.PreferredStaffId); // untouched
    }

    // ── Tenant scoping ───────────────────────────────────────────────────

    [Fact]
    public async Task SetPreferredStaff_TenantScoped_DoesNotSeeOrMutateAnotherTenantsRow()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var staffId = Guid.NewGuid();
        var participantId = Guid.NewGuid();

        // Seed a tenant-B auto-linked row for the same staff/participant ids directly (bypassing
        // filters via a SuperAdmin context) so it exists in the shared InMemory store.
        using (var seedDb = CreateDb(dbName, tenantB, isSuperAdmin: true))
        {
            seedDb.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
            {
                Id = Guid.NewGuid(), TenantId = tenantB, StaffId = staffId, ParticipantId = participantId,
                Level = CompatibilityLevel.Preferred, AutoLinked = true, UpdatedAt = DateTime.UtcNow,
            });
            seedDb.SaveChanges();
        }

        // A tenant-A-scoped context/service must not see tenant B's row — it creates its own.
        using var db = CreateDb(dbName, tenantA, isSuperAdmin: false);
        var service = new StaffCompatibilityLinkService(db);

        await service.SyncFromParticipantPreferredStaffAsync(participantId, null, staffId, CancellationToken.None);
        await db.SaveChangesAsync();

        var tenantARow = await db.StaffParticipantCompatibilities
            .SingleAsync(c => c.StaffId == staffId && c.ParticipantId == participantId);
        Assert.Equal(tenantA, tenantARow.TenantId);

        // Both rows exist independently in the underlying store — tenant B's original is untouched.
        using var verifyDb = CreateDb(dbName, null, isSuperAdmin: true);
        var allRows = await verifyDb.StaffParticipantCompatibilities.IgnoreQueryFilters()
            .Where(c => c.StaffId == staffId && c.ParticipantId == participantId).ToListAsync();
        Assert.Equal(2, allRows.Count);
        Assert.Contains(allRows, r => r.TenantId == tenantB);
    }
}
