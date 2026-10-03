using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;
using static Odip.Tests.Funding.FundingTestKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The backstop under the participant lock: when PostgreSQL's unique index on (tenant, participant, plan start) refuses a save (SQLSTATE 23505), the service forgets what it
/// tried to write, reads the plan that got there first and answers the overlap 409 naming it; a 23505 with no overlapping plan to name, or any other database error, is not an
/// overlap and is thrown. The InMemory provider enforces no index and the Postgres race tests are always settled by the lock before the index can fire, so neither can show this
/// mapping: a SaveChangesInterceptor stands in for the index, as <c>FundingControllerTests</c> does for the settings row.
/// </summary>
public class FundingUniqueViolationTests
{
    private static PostgresException Violation(string sqlState = "23505") =>
        new("duplicate key value violates unique constraint \"IX_FundingPlans_TenantId_ParticipantId_PlanStart\"", "ERROR", "ERROR", sqlState,
            constraintName: "IX_FundingPlans_TenantId_ParticipantId_PlanStart");

    /// <summary>
    /// Fails the next save that adds (or changes) a plan with a DbUpdateException wrapping a PostgresException, the way the database does, and, when given one, has just written
    /// another request's plan from a separate context. Inert until armed, so a test can set a plan up through the same context first.
    /// </summary>
    private sealed class IndexRefuses : SaveChangesInterceptor
    {
        private readonly string _database;
        private PostgresException? _error;
        private EntityState _when;
        private (Guid ParticipantId, DateOnly Start, DateOnly End)? _winner;

        public IndexRefuses(string database) => _database = database;

        public bool Tripped { get; private set; }
        public Guid WinnerId { get; private set; }

        public void Arm(EntityState when, PostgresException error, (Guid ParticipantId, DateOnly Start, DateOnly End)? winner = null)
        {
            (_when, _error, _winner, Tripped) = (when, error, winner, false);
        }

        public void Disarm() => _error = null;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (_error is not null && !Tripped && eventData.Context!.ChangeTracker.Entries<FundingPlan>().Any(e => e.State == _when))
            {
                Tripped = true;
                if (_winner is { } winner)
                {
                    var tenant = new Mock<ICurrentTenant>();
                    tenant.Setup(t => t.TenantId).Returns(TenantA);
                    tenant.Setup(t => t.IsSuperAdmin).Returns(false);
                    await using var other = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(_database).Options, tenant.Object);
                    WinnerId = Guid.NewGuid();
                    other.FundingPlans.Add(new FundingPlan
                    {
                        Id = WinnerId, TenantId = TenantA, ParticipantId = winner.ParticipantId, PlanStart = winner.Start, PlanEnd = winner.End,
                        Evidence = BudgetEvidenceSource.PlanManager, Revision = 1, CreatedBy = "other", UpdatedBy = "other", CreatedAt = Now.UtcDateTime, UpdatedAt = Now.UtcDateTime,
                    });
                    await other.SaveChangesAsync(cancellationToken);
                }

                throw new DbUpdateException("An error occurred while saving the entity changes.", _error);
            }

            return await base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    private static (FundingTestKit Kit, IndexRefuses Race) SetUp()
    {
        var database = Guid.NewGuid().ToString();
        var race = new IndexRefuses(database);
        return (Create(database: database, interceptors: race), race);
    }

    // ── A replaced race: another request's plan is there when the index refuses ──

    [Fact]
    public async Task Create_WhenTheIndexRefusesTheSave_Is409NamingThePlanThatGotThereFirst_AndLeavesNothingOfItsOwn()
    {
        var (kit, race) = SetUp();
        using var _ = kit;
        var participant = kit.SeedParticipant();
        race.Arm(EntityState.Added, Violation(), winner: (participant.Id, D(2026, 7, 1), D(2026, 12, 31)));

        var result = await kit.Controller.CreatePlan(participant.Id, Plan(), CancellationToken.None);

        Assert.True(race.Tripped);
        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var response = Assert.IsType<ApiResponse<FundingPlanOverlapDto>>(conflict.Value);
        Assert.Equal(ParticipantFundingController.PlanOverlapCode, response.Code);
        Assert.Equal((race.WinnerId, D(2026, 7, 1), D(2026, 12, 31)), (response.Data!.ConflictingPlanId, response.Data.ConflictingPlanStart, response.Data.ConflictingPlanEnd));
        Assert.Contains("overlaps the plan that runs 1 Jul 2026 to 31 Dec 2026", Assert.Single(response.Errors!), StringComparison.Ordinal);

        // What this request tried to write was forgotten: only the winner's plan is there, with no pools or periods, and the failed save left no audit row.
        Assert.Equal(race.WinnerId, Assert.Single(await kit.Db.FundingPlans.ToListAsync()).Id);
        Assert.Empty(kit.Db.FundingPools);
        Assert.Empty(kit.Db.FundingPeriods);
        Assert.Empty(kit.Db.AuditLogs);
    }

    [Fact]
    public async Task Update_WhenTheIndexRefusesTheSave_Is409NamingThePlanThatGotThereFirst_AndTheOldPlanIsUntouched()
    {
        var (kit, race) = SetUp();
        using var _ = kit;
        var participant = kit.SeedParticipant();
        var existing = await kit.CreatePlanAsync(participant.Id);   // 1 Jul 2026 to 30 Jun 2027, revision 1
        kit.ClearAudit();
        race.Arm(EntityState.Modified, Violation(), winner: (participant.Id, D(2027, 1, 1), D(2027, 12, 31)));

        var result = await kit.Controller.UpdatePlan(participant.Id, existing.Id, Plan() with { Revision = 1, Notes = "edited" }, CancellationToken.None);

        Assert.True(race.Tripped);
        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var response = Assert.IsType<ApiResponse<FundingPlanOverlapDto>>(conflict.Value);
        Assert.Equal(ParticipantFundingController.PlanOverlapCode, response.Code);
        Assert.Equal(race.WinnerId, response.Data!.ConflictingPlanId);   // never the plan being replaced

        var stored = await kit.Db.FundingPlans.AsNoTracking().SingleAsync(p => p.Id == existing.Id);
        Assert.Equal((1, "From the plan Sophie's mother shared."), (stored.Revision, stored.Notes));   // the replace was forgotten
        Assert.Empty(kit.Db.AuditLogs);
    }

    // ── Not an overlap: thrown, never a 409 ─────────────────────────────────

    [Fact]
    public async Task AUniqueViolation_WithNoOverlappingPlanToName_IsThrown_NotSwallowedAsAnOverlap()
    {
        var (kit, race) = SetUp();
        using var _ = kit;
        var participant = kit.SeedParticipant();
        race.Arm(EntityState.Added, Violation());   // nobody else wrote a plan, so the index refused for some other reason

        var created = await Assert.ThrowsAsync<DbUpdateException>(() => kit.Controller.CreatePlan(participant.Id, Plan(), CancellationToken.None));
        Assert.Contains("no overlapping plan was found", created.Message, StringComparison.Ordinal);

        race.Disarm();   // a plan to replace, saved without the index refusing it
        var existing = await kit.CreatePlanAsync(participant.Id);
        race.Arm(EntityState.Modified, Violation());
        var updated = await Assert.ThrowsAsync<DbUpdateException>(() => kit.Controller.UpdatePlan(participant.Id, existing.Id, Plan() with { Revision = 1 }, CancellationToken.None));
        Assert.Contains("no overlapping plan was found", updated.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("23503")]   // foreign_key_violation
    [InlineData("40001")]   // serialization_failure
    [InlineData("23514")]   // check_violation
    public async Task AnyOtherDatabaseError_IsNeverTakenForAnOverlap_EvenWhenAnOverlappingPlanIsThere(string sqlState)
    {
        var (kit, race) = SetUp();
        using var _ = kit;
        var participant = kit.SeedParticipant();
        race.Arm(EntityState.Added, Violation(sqlState), winner: (participant.Id, D(2026, 7, 1), D(2026, 12, 31)));

        var thrown = await Assert.ThrowsAsync<DbUpdateException>(() => kit.Controller.CreatePlan(participant.Id, Plan(), CancellationToken.None));

        Assert.Equal(sqlState, Assert.IsType<PostgresException>(thrown.InnerException).SqlState);   // the database's own error, not "no overlapping plan was found"
    }

}
