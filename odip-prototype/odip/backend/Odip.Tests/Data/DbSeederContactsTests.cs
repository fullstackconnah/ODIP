using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Data;

/// <summary>
/// Coverage for the CONTACT-01/02/03 demo data DbSeeder.SeedAsync adds (People/
/// ParticipantContactRoles) — same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as
/// DbSeederExpansionTests.
/// </summary>
public class DbSeederContactsTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    [Fact]
    public async Task SeedAsync_SeedsPeopleAndContactRoles()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        var peopleCount = await db.People.CountAsync();
        var rolesCount = await db.ParticipantContactRoles.CountAsync();

        Assert.True(peopleCount >= 10, $"Expected at least 10 seeded people, found {peopleCount}.");
        Assert.True(rolesCount >= 12, $"Expected at least 12 seeded contact roles, found {rolesCount}.");
    }

    [Fact]
    public async Task SeedAsync_ContactRoles_AllReferenceASeededPersonAndParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        var roles = await db.ParticipantContactRoles.ToListAsync();
        var personIds = (await db.People.Select(p => p.Id).ToListAsync()).ToHashSet();
        var participantIds = (await db.Participants.Select(p => p.Id).ToListAsync()).ToHashSet();

        foreach (var role in roles)
        {
            Assert.Contains(role.PersonId, personIds);
            Assert.Contains(role.ParticipantId, participantIds);
        }
    }

    [Fact]
    public async Task SeedAsync_ContactRoles_AllPassContactRoleRulesForTheirParticipant()
    {
        // Sanity-checks the seed data itself never models a state the API would reject —
        // every seeded role must satisfy the same CONTACT-02 gate a real Create/Update call does.
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        var roles = await db.ParticipantContactRoles.Include(r => r.Participant).ToListAsync();
        foreach (var role in roles)
        {
            var error = ContactRoleRules.Validate(role.RoleType, role.Participant!.PlanType, role.Participant.DateOfBirth, role.RegisteredProviderFlag);
            Assert.True(error == null, $"Seeded role {role.RoleType} for participant {role.Participant.FullName} violates ContactRoleRules: {error}");
        }
    }

    [Fact]
    public async Task SeedAsync_ContactRoles_CoverAtLeastTwelveDistinctRoleTypes()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        var distinctTypes = await db.ParticipantContactRoles.Select(r => r.RoleType).Distinct().CountAsync();

        Assert.True(distinctTypes >= 12, $"Expected at least 12 distinct ContactRoleType values seeded, found {distinctTypes}.");
    }

    [Fact]
    public async Task SeedAsync_SamePersonHoldsMultipleRolesForSameParticipant_AtLeastOnce()
    {
        // CONTACT-03's core scenario: one Person, several ParticipantContactRole rows for the
        // same participant (e.g. Guardian + Plan Nominee).
        using var db = CreateDb(Guid.NewGuid().ToString());
        await DbSeeder.SeedAsync(db, CancellationToken.None);

        var grouped = await db.ParticipantContactRoles
            .GroupBy(r => new { r.ParticipantId, r.PersonId })
            .Select(g => g.Count())
            .ToListAsync();

        Assert.Contains(grouped, count => count >= 2);
    }
}
