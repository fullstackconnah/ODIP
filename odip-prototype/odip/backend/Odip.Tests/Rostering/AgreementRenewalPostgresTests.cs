using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Odip.Tests.Medications;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Agreement PR 2 on PostgreSQL: the ending query (an EXISTS in its projection, ANY over the participants) and the renewal (Task 4), which EF InMemory cannot vouch for.</summary>
public class AgreementRenewalPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public AgreementRenewalPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static OdipDbContext Open(string connectionString, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return PostgresFixture.NewContext(connectionString, tenant.Object);
    }

    /// <summary>A migrated scratch database with one organisation (a Sydney provider) and one participant of it.</summary>
    private async Task<(string ConnectionString, Guid TenantId, Guid ParticipantId)> SetUpAsync()
    {
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();
        var (setup, tenantId) = await _pg.NewTenantContextAsync(connectionString);
        await using (setup)
        {
            var participant = setup.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", NdisNumber = "43100001234", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true }).Entity;
            setup.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, OrganisationName = "Provider", State = "NSW", BSB = "062000", AccountNumber = "12345678" });
            await setup.SaveChangesAsync();
            return (connectionString, tenantId, participant.Id);
        }
    }

    /// <summary>A revision stored as a save stores it, with an approval row when it is approved.</summary>
    private static async Task<ServiceAgreementDraft> StoreAsync(string connectionString, Guid tenantId, Guid participantId, int version, DateOnly start, DateOnly end, bool approved)
    {
        await using var db = Open(connectionString, tenantId);
        var draft = BuildRevision(tenantId, participantId, version, new[] { WeekdayBlock() }, start, end);
        db.ServiceAgreementDrafts.Add(draft);
        await db.SaveChangesAsync();
        if (approved) await MarkApprovedAsync(db, draft);
        return draft;
    }

    [SkippableFact]
    public async Task TheEndingQuery_ReadsTheApprovalsAndTheWaitingRenewal_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        await StoreAsync(cs, tenantId, participantId, 1, new DateOnly(2026, 9, 7), new DateOnly(2026, 10, 5), approved: true);
        await StoreAsync(cs, tenantId, participantId, 2, new DateOnly(2026, 10, 6), new DateOnly(2027, 3, 31), approved: false);

        await using var db = Open(cs, tenantId);
        var row = Assert.Single(await AgreementEnding.FindAsync(db, new[] { participantId }, new DateOnly(2026, 10, 10), CancellationToken.None));

        Assert.Equal((1, -5, (int?)2), (row.Version, row.DaysLeft, row.RenewalVersion));
    }

    [SkippableFact]
    public async Task TheEndingList_NamesTheParticipantAndReadsTheProvidersDay_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        await StoreAsync(cs, tenantId, participantId, 1, new DateOnly(2026, 10, 3), new DateOnly(2026, 10, 30), approved: true);

        await using var db = Open(cs, tenantId);
        var response = await new ServiceAgreementsController(db, Mock.Of<ICurrentTenant>(t => t.TenantId == tenantId), FakeClock.AtUtc(2026, 10, 10, 2, 0)).Ending(CancellationToken.None);

        var row = Assert.Single(Assert.IsType<ApiResponse<List<AgreementEndingDto>>>(Assert.IsType<OkObjectResult>(response.Result).Value).Data!);
        Assert.Equal((participantId, "Amy Ng", 20, "Agreement ends in 20 days"), (row.ParticipantId, row.ParticipantName, row.DaysLeft, row.Status));
    }

    [SkippableFact]
    public async Task TheRenewal_ReadsTheTermAndThePlanAndSaves_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        await using (var admin = PostgresFixture.NewContext(cs)) await CatalogueImportTestSupport.ImportAsync(admin, CatalogueFixtures.File2026_27);
        await StoreAsync(cs, tenantId, participantId, 1, new DateOnly(2026, 10, 12), new DateOnly(2026, 11, 22), approved: true);
        var change = await StoreAsync(cs, tenantId, participantId, 2, new DateOnly(2026, 11, 2), new DateOnly(2026, 11, 22), approved: true);
        await using (var setup = Open(cs, tenantId))
        {
            setup.FundingPlans.Add(new FundingPlan
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, PlanStart = new DateOnly(2026, 7, 1), PlanEnd = new DateOnly(2027, 6, 30),
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            await setup.SaveChangesAsync();
        }

        await using var db = Open(cs, tenantId);
        var outcome = await new AgreementRenewalService(db).RenewAsync(tenantId, participantId, change.Id, Admin, "admin", CancellationToken.None);

        Assert.Empty(outcome.Errors);
        var v3 = outcome.Draft!;
        Assert.Equal((3, new DateOnly(2026, 11, 23), new DateOnly(2027, 1, 3), new DateOnly(2026, 7, 1)), (v3.Version, v3.AgreementStartDate, v3.AgreementEndDate, v3.PlanStartDate));
        Assert.NotEmpty(v3.Lines);
    }

    /// <summary>Follow-ups (REVIEW-006 N-3): two coordinators renew the same agreement at the same moment. Both pass the reads; the version number lets only one commit, and the other is the conflict the
    /// controller answers 409 draft-version-conflict, naming the newest version. Never two drafts.</summary>
    [SkippableFact]
    public async Task TwoRenewalsAtOnce_GiveOneDraftAndOneConflict_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        await using (var admin = PostgresFixture.NewContext(cs)) await CatalogueImportTestSupport.ImportAsync(admin, CatalogueFixtures.File2026_27);
        var source = await StoreAsync(cs, tenantId, participantId, 1, new DateOnly(2026, 10, 12), new DateOnly(2026, 11, 22), approved: true);
        await using (var setup = Open(cs, tenantId))
        {
            setup.FundingPlans.Add(new FundingPlan
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, PlanStart = new DateOnly(2026, 7, 1), PlanEnd = new DateOnly(2027, 6, 30),
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            await setup.SaveChangesAsync();
        }
        await using var first = Open(cs, tenantId);
        await using var second = Open(cs, tenantId);

        var outcomes = await Task.WhenAll(
            new AgreementRenewalService(first).RenewAsync(tenantId, participantId, source.Id, Admin, "one", CancellationToken.None),
            new AgreementRenewalService(second).RenewAsync(tenantId, participantId, source.Id, Admin, "two", CancellationToken.None));

        Assert.Equal(2, Assert.Single(outcomes, o => o.Draft is not null).Draft!.Version);
        Assert.Equal((int?)2, Assert.Single(outcomes, o => o.Draft is null).ConflictVersion);
        await using var read = Open(cs, tenantId);
        Assert.Equal(new[] { 1, 2 }, await read.ServiceAgreementDrafts.AsNoTracking().OrderBy(d => d.Version).Select(d => d.Version).ToListAsync());
    }

    /// <summary>One participant with Sam as the regular of a Monday pattern, and Sam's shift on it.</summary>
    private async Task<(string ConnectionString, Guid TenantId, Guid ParticipantId, Guid SamId, Guid AlexId, Guid PatternId, Guid ShiftId)> SeedRegularAsync()
    {
        var (cs, tenantId, participantId) = await SetUpAsync();
        Guid samId = Guid.NewGuid(), alexId = Guid.NewGuid(), patternId = Guid.NewGuid(), shiftId = Guid.NewGuid();
        var monday = new DateOnly(2026, 10, 19);
        await using (var setup = Open(cs, tenantId))
        {
            foreach (var (id, name) in new[] { (samId, "Sam"), (alexId, "Alex") })
                setup.Users.Add(new User { Id = id, TenantId = tenantId, FirstName = name, LastName = "Lee", Username = name, Email = $"{name}@example.com", Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true });
            setup.ShiftPatterns.Add(new ShiftPattern
            {
                Id = patternId, TenantId = tenantId, ParticipantId = participantId, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = SupportRatio.OneToOne,
                NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 10, 1), IsActive = true, DefaultUserId = samId,
            });
            setup.Shifts.Add(new Shift
            {
                Id = shiftId, TenantId = tenantId, ParticipantId = participantId, UserId = samId, ServiceDate = monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft, ShiftPatternId = patternId,
            });
            await setup.SaveChangesAsync();
        }
        return (cs, tenantId, participantId, samId, alexId, patternId, shiftId);
    }

    [SkippableFact]   // REV281B #2: two coordinators on one pattern; the pre-check alone cannot stop the second, the concurrency token at the UPDATE does
    public async Task SetRegular_TwoEditors_TheSecondSaveIsRefusedAtTheUpdate()
    {
        RequirePostgres();
        var (cs, tenantId, _, samId, alexId, patternId, shiftId) = await SeedRegularAsync();

        await using var editorB = Open(cs, tenantId);
        var loadedByB = await editorB.ShiftPatterns.SingleAsync(p => p.Id == patternId);          // B has Sam in hand
        await using (var editorA = Open(cs, tenantId))
        {
            (await editorA.ShiftPatterns.SingleAsync(p => p.Id == patternId)).DefaultUserId = alexId;
            await editorA.SaveChangesAsync();                                                       // A saves Alex first
        }

        loadedByB.DefaultUserId = null;                                                              // B's Stop, from its stale load
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => editorB.SaveChangesAsync());

        await using var late = Open(cs, tenantId);                                                   // the same Stop arriving afterwards is the 409 of the pre-check
        var tenant = Mock.Of<ICurrentTenant>(t => t.TenantId == tenantId);
        var refused = await RosterStartWeekTests.Controller(late, tenant).SetRegular(patternId, new SetRegularDto { ShiftId = shiftId, StaffId = null, ExpectedRegularId = samId }, default);
        Assert.IsType<ConflictObjectResult>(refused.Result);
        await using var check = Open(cs, tenantId);
        Assert.Equal(alexId, (await check.ShiftPatterns.AsNoTracking().SingleAsync(p => p.Id == patternId)).DefaultUserId);
    }

    /// <summary>REV281B deep Must 1: a generation (Start rostering, Generate, an approval) holds the participant lock from its load to its save. A regular change that does not wait for it commits in
    /// between, and the token then refuses the generation's own save (a 500). The change has to queue behind the lock instead.</summary>
    private async Task AWriterQueuesBehindAGenerationAsync(Func<RosteringController, Guid, Guid, Guid, Task<ActionResult<ApiResponse<ShiftPatternDto>>>> write)
    {
        RequirePostgres();
        var (cs, tenantId, participantId, samId, _, patternId, shiftId) = await SeedRegularAsync();
        await using var generation = Open(cs, tenantId);
        await using var held = await RosterGenerationLock.AcquireAsync(generation, participantId, default, TimeSpan.FromSeconds(10));
        Assert.True(held.Held);
        var loaded = await generation.ShiftPatterns.SingleAsync(p => p.Id == patternId);   // the generator loads its patterns tracked, under the lock

        await using var writer = Open(cs, tenantId);
        var writing = write(RosterStartWeekTests.Controller(writer, Mock.Of<ICurrentTenant>(t => t.TenantId == tenantId)), patternId, shiftId, participantId);
        await Task.Delay(750);
        Assert.False(writing.IsCompleted);                                                  // waiting for the lock, not committed in between

        loaded.GeneratedThrough = new DateOnly(2026, 11, 1);
        await generation.SaveChangesAsync();                                                // not refused by the token
        await held.CommitAsync(default);

        Assert.IsType<OkObjectResult>((await writing).Result);
        await using var check = Open(cs, tenantId);
        var stored = await check.ShiftPatterns.AsNoTracking().SingleAsync(p => p.Id == patternId);
        Assert.Null(stored.DefaultUserId);
        Assert.Equal(new DateOnly(2026, 11, 1), stored.GeneratedThrough);
    }

    [SkippableFact]
    public Task SetRegular_RacingAGeneration_QueuesBehindItsLock_AndNeitherSaveIsRefused() =>
        AWriterQueuesBehindAGenerationAsync((c, patternId, shiftId, _) => c.SetRegular(patternId, new SetRegularDto { ShiftId = shiftId, StaffId = null }, default));

    [SkippableFact]
    public Task UpdatePattern_RacingAGeneration_QueuesBehindItsLock_AndNeitherSaveIsRefused() =>
        AWriterQueuesBehindAGenerationAsync((c, patternId, _, participantId) => c.UpdatePattern(patternId, new UpdateShiftPatternDto
        {
            ParticipantId = participantId, DefaultStaffId = null, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 10, 1), IsActive = true,
        }, default));

    /// <summary>REV281B fix round 2: the opposite order. Generate reads the pattern, then waits for the participant lock; a SetRegular commits while it waits. The pattern Generate works on must be the committed
    /// one: a copy read before the lock and kept tracked would carry the old regular into the shifts and make the save a concurrency error (a 500).</summary>
    [SkippableFact]
    public async Task GeneratePattern_ARegularChangeCommitsWhileItWaitsForTheLock_UsesTheNewRegular()
    {
        RequirePostgres();
        var (cs, tenantId, participantId, _, alexId, patternId, _) = await SeedRegularAsync();
        await using (var setup = Open(cs, tenantId))                                        // the week Generate starts records who started it
        {
            setup.Users.Add(new User { Id = RosterStartWeekTests.CoordinatorId, TenantId = tenantId, FirstName = "Co", LastName = "Ordinator", Username = "co", Email = "co@example.com", Role = UserRole.Coordinator, Position = Position.SupportWorker, IsActive = true });
            await setup.SaveChangesAsync();
        }
        await using var other = Open(cs, tenantId);
        await using var held = await RosterGenerationLock.AcquireAsync(other, participantId, default, TimeSpan.FromSeconds(20));
        Assert.True(held.Held);

        await using var generating = Open(cs, tenantId);
        var generation = RosterStartWeekTests.Controller(generating, Mock.Of<ICurrentTenant>(t => t.TenantId == tenantId))
            .GeneratePattern(patternId, new DateOnly(2026, 10, 1), new DateOnly(2026, 11, 1), default);   // from the pattern's start, so it joins on and records GeneratedThrough (the save the token guards)
        await Task.Delay(750);
        Assert.False(generation.IsCompleted);                                               // past its preload, waiting for the lock

        await using (var change = Open(cs, tenantId))                                       // a SetRegular commits in between
        {
            (await change.ShiftPatterns.SingleAsync(p => p.Id == patternId)).DefaultUserId = alexId;
            await change.SaveChangesAsync();
        }
        await held.CommitAsync(default);

        Assert.IsType<OkObjectResult>((await generation).Result);
        await using var check = Open(cs, tenantId);
        Assert.Equal(alexId, Assert.Single(await check.Shifts.AsNoTracking().Where(s => s.ShiftPatternId == patternId && s.ServiceDate == new DateOnly(2026, 10, 26)).ToListAsync()).UserId);
    }
}
