using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The blocks of a service agreement draft revision against a real PostgreSQL (see <see cref="PostgresFixture"/>: skipped, never failed, when POSTGRES_CONNECTION_STRING is unset, so these
/// run in CI and not on a machine without a server). <see cref="DraftBlocksTests"/> runs on EF InMemory, which cannot show what Npgsql does with a <c>jsonb</c> column (it rewrites the
/// text, and refuses a NUL), whether the unique indexes hold, whether the list's split query translates, or what two saves at once do.
/// </summary>
public class DraftBlocksPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public DraftBlocksPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static readonly DateOnly Monday = new(2026, 10, 12), Sunday = new(2026, 10, 18);

    private static ICurrentTenant TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    private static PlanBlock MonWed(string id = "b1") =>
        Block(id, PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday } });

    private static PlanBlock SaturdayOuting(string id = "sat") =>
        Block(id, PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 });

    private static DraftBlockDto Entry(PlanBlock block) => new() { Block = block, Requirements = new DraftBlockRequirementsDto { WorkerGender = "Female", Driver = true, Skills = ["FirstAid"] } };

    private static CreateServiceAgreementDraftDto Request(params DraftBlockDto[] blocks) => new()
    {
        PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = Monday, AgreementEndDate = Sunday, State = "NSW",
        Representative = "A. Representative", Blocks = blocks.ToList(),
    };

    /// <summary>A migrated scratch database holding the real 2026-27 catalogue, one tenant and one participant of it.</summary>
    private async Task<(string ConnectionString, Guid TenantId, Guid ParticipantId)> SetUpAsync()
    {
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();
        await using (var admin = PostgresFixture.NewContext(connectionString)) await CatalogueImportTestSupport.ImportAsync(admin, CatalogueFixtures.File2026_27);
        var (setup, tenantId) = await _pg.NewTenantContextAsync(connectionString);
        await using (setup)
        {
            var participant = setup.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Synthetic", LastName = "Participant", NdisNumber = "43100001234", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true, IsDraft = true }).Entity;
            await setup.SaveChangesAsync();
            return (connectionString, tenantId, participant.Id);
        }
    }

    private static OdipDbContext Open(string connectionString, Guid tenantId) => PostgresFixture.NewContext(connectionString, TenantOf(tenantId));

    private static async Task<List<ServiceAgreementDraftDto>> ListAsync(OdipDbContext db, Guid tenantId, Guid participantId)
    {
        var controller = new ServiceAgreementDraftsController(db, TenantOf(tenantId), new ServiceAgreementDraftService(db));
        var ok = Assert.IsType<OkObjectResult>((await controller.List(participantId, CancellationToken.None)).Result);
        return Assert.IsType<ApiResponse<List<ServiceAgreementDraftDto>>>(ok.Value).Data!;
    }

    [SkippableFact]
    public async Task ASavedRevision_ReadsBackThroughTheList_WithItsBlocksItsAnswerAndItsLines_AsTheServiceStoredThem()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var blocks = new[] { Entry(MonWed()), Entry(SaturdayOuting()) };
        await using (var save = Open(cs, tenantId))
        {
            var result = await new ServiceAgreementDraftService(save).SaveAsync(tenantId, participantId, Request(blocks), "actor", CancellationToken.None);
            Assert.NotNull(result.Draft);
        }

        // A fresh context (nothing cached) and the controller's own list: two collections loaded beside each draft, as split queries.
        await using var read = Open(cs, tenantId);
        var listed = Assert.Single(await ListAsync(read, tenantId, participantId));

        // jsonb rewrites its text (key order, spacing), so the blocks are compared as what they mean, not as the bytes that were written.
        Assert.Equal(blocks.Select(b => DraftJson.Write(b.Block)), listed.Blocks.Select(b => DraftJson.Write(b.Block)));
        Assert.Equal(new[] { "Female" }, listed.Blocks.Select(b => b.Requirements.WorkerGender).Distinct());
        Assert.Equal(new[] { "b1", "sat" }, listed.Blocks.Select(b => b.Block.Id));
        Assert.NotNull(listed.Pricing);
        Assert.Equal(listed.Lines.Sum(l => l.Total), listed.Pricing!.Totals.Amount);
        Assert.Equal(new[] { ("b1", "04_104_0125_6_1", 8m, 73.58m, 588.64m, 2), ("sat", "04_104_0136_6_1", 6m, 34.51m, 207.06m, 1) },
            listed.Lines.Select(l => (l.BlockId!, l.ItemCode, l.Hours, l.UnitPrice, l.Total, l.Occurrences)));
    }

    [SkippableFact]
    public async Task ReQuotingTheStoredBlocks_GivesTheStoredLines()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        await using (var save = Open(cs, tenantId))
            Assert.NotNull((await new ServiceAgreementDraftService(save).SaveAsync(tenantId, participantId, Request(Entry(MonWed()), Entry(SaturdayOuting())), "actor", CancellationToken.None)).Draft);

        await using var read = Open(cs, tenantId);
        var draft = await read.ServiceAgreementDrafts.AsNoTracking().Include(d => d.Blocks).Include(d => d.Lines).SingleAsync();
        var stored = draft.Blocks.OrderBy(b => b.Position).Select(b => DraftJson.ReadBlock(b.BlockJson)).ToList();
        Assert.All(stored, b => Assert.NotEmpty(b.Id));                      // read back from jsonb, not an empty block

        var quote = await new PlanPricingService(read).QuoteAsync(tenantId, stored, draft.AgreementStartDate, draft.AgreementEndDate);

        // By value, not by JSON text: the stored columns are numeric(12,2) and numeric(14,2), so 8 hours reads back as 8.00, the same number as the 8 a fresh quote has (see AssertSameLinesByValue).
        AssertSameLinesByValue(draft.Lines.OrderBy(l => l.Position).ToList(), ServiceAgreementDraftService.GroupLines(quote, stored).ToList());
    }

    [SkippableFact]
    public async Task TheUniqueIndexes_RefuseASecondDraftOfAVersion_ASecondBlockInAPosition_AndASecondBlockOfAKey()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        await using (var save = Open(cs, tenantId))
            Assert.NotNull((await new ServiceAgreementDraftService(save).SaveAsync(tenantId, participantId, Request(Entry(MonWed())), "actor", CancellationToken.None)).Draft);

        static async Task AssertRefusedBy(Func<Task> write, string constraint)
        {
            var failure = await Assert.ThrowsAsync<DbUpdateException>(write);
            var pg = Assert.IsType<PostgresException>(failure.InnerException);
            Assert.Equal(PostgresErrorCodes.UniqueViolation, pg.SqlState);
            Assert.Equal(constraint, pg.ConstraintName);
        }

        await using var db = Open(cs, tenantId);
        var draft = await db.ServiceAgreementDrafts.AsNoTracking().SingleAsync();

        // A second draft of version 1 for the participant.
        await AssertRefusedBy(async () =>
        {
            db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, Version = draft.Version, State = "NSW", ServiceTypesJson = "[]",
                ParticipantNameSnapshot = "Synthetic Participant", CreatedBy = "test", PlanStartDate = draft.PlanStartDate, PlanEndDate = draft.PlanEndDate,
                AgreementStartDate = draft.AgreementStartDate, AgreementEndDate = draft.AgreementEndDate,
            });
            await db.SaveChangesAsync();
        }, "IX_ServiceAgreementDrafts_TenantId_ParticipantId_Version");
        db.ChangeTracker.Clear();

        // A second block in position 0, and a second block with the key "b1".
        await AssertRefusedBy(async () =>
        {
            db.ServiceAgreementDraftBlocks.Add(new ServiceAgreementDraftBlock { Id = Guid.NewGuid(), DraftId = draft.Id, Position = 0, BlockKey = "other", BlockJson = "{}", RequirementsJson = "{}" });
            await db.SaveChangesAsync();
        }, "IX_ServiceAgreementDraftBlocks_DraftId_Position");
        db.ChangeTracker.Clear();
        await AssertRefusedBy(async () =>
        {
            db.ServiceAgreementDraftBlocks.Add(new ServiceAgreementDraftBlock { Id = Guid.NewGuid(), DraftId = draft.Id, Position = 5, BlockKey = "b1", BlockJson = "{}", RequirementsJson = "{}" });
            await db.SaveChangesAsync();
        }, "IX_ServiceAgreementDraftBlocks_DraftId_BlockKey");
    }

    [SkippableFact]
    public async Task ABlockIdWithANul_IsARefusalTheScreenCanShow_AndTheDatabaseWouldHaveRefusedItAnyway()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        await using var db = Open(cs, tenantId);

        var result = await new ServiceAgreementDraftService(db).SaveAsync(tenantId, participantId, Request(Entry(MonWed("a\0b"))), "actor", CancellationToken.None);

        Assert.Null(result.Draft);
        Assert.Contains(result.Errors, e => e.Contains("control character"));
        Assert.Empty(await db.ServiceAgreementDrafts.AsNoTracking().ToListAsync());

        // What the validation is for. On a real draft, with the validation out of the way, PostgreSQL refuses a NUL in the key (a varchar) or in the jsonb: a 500 where EF InMemory says nothing.
        Assert.NotNull((await new ServiceAgreementDraftService(db).SaveAsync(tenantId, participantId, Request(Entry(MonWed())), "actor", CancellationToken.None)).Draft);
        var draft = await db.ServiceAgreementDrafts.AsNoTracking().SingleAsync();
        db.ServiceAgreementDraftBlocks.Add(new ServiceAgreementDraftBlock { Id = Guid.NewGuid(), DraftId = draft.Id, Position = 9, BlockKey = "a\0b", BlockJson = "{}", RequirementsJson = "{}" });
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.NotNull(failure.InnerException);   // the database's own refusal, which a save of such an id would have surfaced as a 500
    }

    [SkippableFact]
    public async Task TwoSavesAtOnce_FromTheSameVersion_GiveOneRevisionAndOneConflict()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        await using var first = Open(cs, tenantId);
        await using var second = Open(cs, tenantId);
        var plan = Request(Entry(MonWed()), Entry(SaturdayOuting())) with { BaseVersion = 0 };

        var results = await Task.WhenAll(
            new ServiceAgreementDraftService(first).SaveAsync(tenantId, participantId, plan, "one", CancellationToken.None),
            new ServiceAgreementDraftService(second).SaveAsync(tenantId, participantId, plan, "two", CancellationToken.None));

        // Whether the loser was stopped by the check on the base version or by the unique index, it is told which version is newest and nothing of its plan is kept.
        Assert.Single(results, r => r.Draft is not null);
        var loser = Assert.Single(results, r => r.Draft is null);
        Assert.Equal(1, loser.ConflictVersion);
        await using var read = Open(cs, tenantId);
        var only = Assert.Single(await read.ServiceAgreementDrafts.AsNoTracking().Include(d => d.Blocks).ToListAsync());
        Assert.Equal(1, only.Version);
        Assert.Equal(2, only.Blocks.Count);
    }

    [SkippableFact]
    public async Task ALegacyLine_InsertedWithoutTheNewColumns_ReadsAsItAlwaysDid()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var draftId = Guid.NewGuid();
        await using (var db = Open(cs, tenantId))
        {
            db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft
            {
                Id = draftId, TenantId = tenantId, ParticipantId = participantId, Version = 1, State = "NSW", ServiceTypesJson = "[\"Community access\"]",
                ParticipantNameSnapshot = "Synthetic Participant", CreatedBy = "legacy", PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30),
                AgreementStartDate = new DateOnly(2026, 7, 1), AgreementEndDate = new DateOnly(2027, 6, 30),
            });
            await db.SaveChangesAsync();
        }

        // The columns the table had before the builder: nothing for the block, the band, the unit, the total, the shifts, the flags or the position.
        await using (var conn = new NpgsqlConnection(cs))
        {
            await conn.OpenAsync();
            await using var insert = new NpgsqlCommand(
                "INSERT INTO \"ServiceAgreementDraftLines\" (\"Id\",\"DraftId\",\"ServiceType\",\"Hours\",\"ItemCode\",\"CatalogueVersion\",\"CatalogueEffectiveFrom\",\"UnitPrice\") " +
                "VALUES (@id,@draft,'Community access',2.5,'04_104_0125_6_1','2026-27',@from,20.55)", conn);
            insert.Parameters.AddWithValue("id", Guid.NewGuid());
            insert.Parameters.AddWithValue("draft", draftId);
            insert.Parameters.AddWithValue("from", new DateOnly(2026, 7, 1));
            await insert.ExecuteNonQueryAsync();
        }

        await using var read = Open(cs, tenantId);
        var listed = Assert.Single(await ListAsync(read, tenantId, participantId));

        Assert.Empty(listed.Blocks);
        Assert.Null(listed.Pricing);
        var line = Assert.Single(listed.Lines);
        Assert.Equal((2.5m, 20.55m, 51.37m, "H", 0, (string?)null), (line.Hours, line.UnitPrice, line.Total, line.Unit, line.Occurrences, line.BlockId));   // floor(2.5 x 20.55 = 51.375)
    }
}
