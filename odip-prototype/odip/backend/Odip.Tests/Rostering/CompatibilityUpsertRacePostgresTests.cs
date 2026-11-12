using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Against a real PostgreSQL (skipped without POSTGRES_CONNECTION_STRING): two first writes for one (staff, participant) pair. The other request's row lands between this request's read
/// and its save, so the unique index refuses the insert and the controller redoes the write as an update. InMemory enforces no index, so only PostgreSQL can show the retry.
/// </summary>
public class CompatibilityUpsertRacePostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public CompatibilityUpsertRacePostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact]
    public async Task AFirstWriteThatLosesTheUniqueIndexRace_IsRetriedAsAnUpdate_AndTheCallersAnswerIsTheOneRow()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var staff = new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Lee", Username = $"sam.{Guid.NewGuid():N}", Email = $"sam.{Guid.NewGuid():N}@example.test", Role = UserRole.SupportWorker, IsActive = true };
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Amy", LastName = "Ng", IsActive = true };
        await using (seed)
        {
            seed.AddRange(staff, participant);
            await seed.SaveChangesAsync();
        }

        // The other request's first write, saved from its own context just before this request's save.
        var winnerId = Guid.NewGuid();
        var winner = new RunOnceBeforeSave(async () =>
        {
            await using var other = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
            other.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
            {
                Id = winnerId, TenantId = tenantId, UserId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Backup, Rank = 1, Reason = "The winner's reason",
            });
            await other.SaveChangesAsync();
        });
        await using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).AddInterceptors(winner).Options, tenant.Object);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.UpsertCompatibility(
            new UpsertCompatibilityDto { StaffId = staff.Id, ParticipantId = participant.Id, Level = CompatibilityLevel.Excluded, Reason = "The caller's reason" }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.True(winner.Ran);
                await using var check = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
        var row = await check.StaffParticipantCompatibilities.AsNoTracking().SingleAsync(c => c.UserId == staff.Id && c.ParticipantId == participant.Id);
        Assert.Equal((CompatibilityLevel.Excluded, "The caller's reason"), (row.Level, row.Reason));
    }

    private sealed class RunOnceBeforeSave(Func<Task> action) : SaveChangesInterceptor
    {
        public bool Ran { get; private set; }
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            // Only the save that inserts the pair's row: an earlier save in the request would let the other row land before this request's read, and no insert would race.
            if (!Ran && eventData.Context!.ChangeTracker.Entries<StaffParticipantCompatibility>().Any(e => e.State == EntityState.Added)) { Ran = true; await action(); }
            return result;
        }
    }
}
