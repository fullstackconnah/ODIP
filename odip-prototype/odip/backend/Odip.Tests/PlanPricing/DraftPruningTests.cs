using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Odip.Tests.Medications;
using Odip.Tests.Rostering;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// Saving a participant's agreement again replaces their older saves that never did anything: a revision nobody approved, rostered or signed is deleted (with its blocks and lines) in the
/// same transaction as the new one. A revision that did something is kept for good: its approval, its roster patterns and its signing evidence all point at it with restricting keys.
/// The version stays a unique, increasing counter, so it becomes gapped, and the check against a stale base version works as it did.
/// </summary>
public class DraftPruningTests
{
    private static readonly Guid TenantA = Guid.NewGuid(), TenantB = Guid.NewGuid();

    private sealed class Fixture : IAsyncDisposable
    {
        public required string DbName { get; init; }
        public required Guid TenantId { get; init; }
        public required OdipDbContext Db { get; init; }
        public required Participant Participant { get; init; }
        public ServiceAgreementDraftService Service => new(Db);
        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    private static OdipDbContext NewContext(string name, Guid? tenantId, bool superAdmin = false, params IInterceptor[] interceptors)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name);
        if (interceptors.Length > 0) options.AddInterceptors(interceptors);
        return new OdipDbContext(options.Options, tenant.Object);
    }

    private static Participant NewParticipant(Guid tenantId, string lastName) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Synthetic", LastName = lastName, NdisNumber = "43100001234", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true, IsDraft = true,
    };

    /// <summary>One in-memory database with the real catalogue, one participant of tenant A, and (for the isolation test) one more of tenant A and one of tenant B.</summary>
    private static async Task<Fixture> SetUpAsync()
    {
        var name = Guid.NewGuid().ToString();
        var db = NewContext(name, TenantA);
        await db.Database.EnsureCreatedAsync();
        await using (var importDb = NewContext(name, null, superAdmin: true))
            await CatalogueImportTestSupport.ImportAsync(importDb, CatalogueFixtures.File2026_27);   // the catalogue is global: imported as a SuperAdmin would
        var participant = db.Participants.Add(NewParticipant(TenantA, "Participant")).Entity;
        await db.SaveChangesAsync();
        return new Fixture { DbName = name, TenantId = TenantA, Db = db, Participant = participant };
    }

    private static PlanBlock MonWed(string id = "b1") =>
        Block(id, PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday } });

    private static PlanBlock SaturdayOuting() =>
        Block("sat", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 });

    private static CreateServiceAgreementDraftDto Request(params PlanBlock[] blocks) => new()
    {
        PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = Mon12Oct, AgreementEndDate = Sun18Oct, State = "NSW",
        Blocks = (blocks.Length == 0 ? new[] { MonWed() } : blocks).Select(b => new DraftBlockDto { Block = b, Requirements = new DraftBlockRequirementsDto() }).ToList(),
    };

    private static Task<DraftSaveResult> SaveAsync(Fixture f, CreateServiceAgreementDraftDto request) =>
        f.Service.SaveAsync(f.TenantId, f.Participant.Id, request, "actor", CancellationToken.None);

    /// <summary>A revision as saving it would have stored it, put straight in the database (so nothing is pruned on the way in).</summary>
    private static async Task<ServiceAgreementDraft> StoreAsync(OdipDbContext db, Guid tenantId, Guid participantId, int version)
    {
        var draft = ApprovalTestSupport.BuildRevision(tenantId, participantId, version, new[] { MonWed() });
        db.ServiceAgreementDrafts.Add(draft);
        await db.SaveChangesAsync();
        return draft;
    }

    private static Task ApproveAsync(OdipDbContext db, ServiceAgreementDraft draft)
    {
        db.ServiceAgreementDraftApprovals.Add(new ServiceAgreementDraftApproval
        {
            Id = Guid.NewGuid(), TenantId = draft.TenantId, DraftId = draft.Id, ParticipantId = draft.ParticipantId, DraftVersion = draft.Version,
            ApprovedAt = new DateTime(2026, 10, 5, 1, 0, 0, DateTimeKind.Utc), ApprovedByName = "Alex Admin",
        });
        return db.SaveChangesAsync();
    }

    private static Task RosterAsync(OdipDbContext db, ServiceAgreementDraft draft)
    {
        db.ShiftPatterns.Add(new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = draft.TenantId, ParticipantId = draft.ParticipantId, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
            EffectiveFrom = draft.AgreementStartDate, IsActive = true, SourceDraftId = draft.Id, SourceBlockKey = "b1", WorkerSlot = 1,
        });
        return db.SaveChangesAsync();
    }

    private static Task SignAsync(OdipDbContext db, ServiceAgreementDraft draft)
    {
        db.ElectronicSigningSnapshots.Add(new ElectronicSigningSnapshot
        {
            Id = Guid.NewGuid(), TenantId = draft.TenantId, ParticipantId = draft.ParticipantId, DraftId = draft.Id, DraftVersion = draft.Version,
            DocumentJson = "{}", DocumentHash = new string('a', 64),
        });
        return db.SaveChangesAsync();
    }

    private static async Task<List<int>> VersionsAsync(OdipDbContext db, Guid participantId) =>
        await db.ServiceAgreementDrafts.IgnoreQueryFilters().Where(d => d.ParticipantId == participantId).OrderBy(d => d.Version).Select(d => d.Version).ToListAsync();

    private static async Task<(int Blocks, int Lines)> ChildrenAsync(OdipDbContext db, Guid draftId) =>
        (await db.ServiceAgreementDraftBlocks.CountAsync(b => b.DraftId == draftId), await db.ServiceAgreementDraftLines.CountAsync(l => l.DraftId == draftId));

    // ── What goes ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Saving_again_deletes_the_older_unapproved_revision_with_its_blocks_and_lines()
    {
        await using var f = await SetUpAsync();
        var first = Assert.IsType<ServiceAgreementDraft>((await SaveAsync(f, Request(MonWed()))).Draft);
        Assert.Equal((1, 1), await ChildrenAsync(f.Db, first.Id));

        var second = Assert.IsType<ServiceAgreementDraft>((await SaveAsync(f, Request(MonWed(), SaturdayOuting()))).Draft);

        Assert.Equal(2, second.Version);
        Assert.Equal(new[] { 2 }, await VersionsAsync(f.Db, f.Participant.Id));
        Assert.Equal((0, 0), await ChildrenAsync(f.Db, first.Id));
        Assert.Equal((2, 2), await ChildrenAsync(f.Db, second.Id));
    }

    [Fact]
    public async Task Every_older_unapproved_revision_goes_and_only_the_revision_just_saved_remains()
    {
        await using var f = await SetUpAsync();
        foreach (var version in new[] { 1, 2, 3 }) await StoreAsync(f.Db, f.TenantId, f.Participant.Id, version);

        var saved = Assert.IsType<ServiceAgreementDraft>((await SaveAsync(f, Request())).Draft);

        Assert.Equal(4, saved.Version);
        Assert.Equal(new[] { 4 }, await VersionsAsync(f.Db, f.Participant.Id));
        Assert.Equal(0, await f.Db.ServiceAgreementDraftLines.CountAsync(l => l.DraftId != saved.Id));
        Assert.Equal(0, await f.Db.ServiceAgreementDraftBlocks.CountAsync(b => b.DraftId != saved.Id));
    }

    [Fact]
    public async Task The_first_save_has_nothing_to_prune_and_is_kept()
    {
        await using var f = await SetUpAsync();

        var saved = Assert.IsType<ServiceAgreementDraft>((await SaveAsync(f, Request())).Draft);

        Assert.Equal(1, saved.Version);
        Assert.Equal(new[] { 1 }, await VersionsAsync(f.Db, f.Participant.Id));
    }

    // ── What stays ────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("approved")]
    [InlineData("rostered")]
    [InlineData("signed")]
    public async Task A_revision_that_was_approved_rostered_or_signed_survives_the_next_save_and_a_plain_one_beside_it_does_not(string kind)
    {
        await using var f = await SetUpAsync();
        var kept = await StoreAsync(f.Db, f.TenantId, f.Participant.Id, 1);
        var plain = await StoreAsync(f.Db, f.TenantId, f.Participant.Id, 2);
        await (kind switch { "approved" => ApproveAsync(f.Db, kept), "rostered" => RosterAsync(f.Db, kept), _ => SignAsync(f.Db, kept) });
        var before = await ChildrenAsync(f.Db, kept.Id);
        Assert.NotEqual((0, 0), before);

        var saved = Assert.IsType<ServiceAgreementDraft>((await SaveAsync(f, Request())).Draft);

        Assert.Equal(3, saved.Version);
        Assert.Equal(new[] { 1, 3 }, await VersionsAsync(f.Db, f.Participant.Id));
        Assert.Equal(before, await ChildrenAsync(f.Db, kept.Id));            // the kept revision still has its blocks and lines
        Assert.Equal((0, 0), await ChildrenAsync(f.Db, plain.Id));
    }

    [Fact]
    public async Task Another_participants_and_another_tenants_revisions_are_never_touched()
    {
        await using var f = await SetUpAsync();
        var sameTenant = f.Db.Participants.Add(NewParticipant(TenantA, "Sibling")).Entity;
        await using var other = NewContext(f.DbName, TenantB);
        var otherTenant = other.Participants.Add(NewParticipant(TenantB, "Stranger")).Entity;
        await other.SaveChangesAsync();
        await f.Db.SaveChangesAsync();
        var siblings = await StoreAsync(f.Db, TenantA, sameTenant.Id, 1);
        var strangers = await StoreAsync(other, TenantB, otherTenant.Id, 1);
        await StoreAsync(f.Db, f.TenantId, f.Participant.Id, 1);

        await SaveAsync(f, Request());

        Assert.Equal(new[] { 2 }, await VersionsAsync(f.Db, f.Participant.Id));
        Assert.Equal(new[] { 1 }, await VersionsAsync(f.Db, sameTenant.Id));
        Assert.Equal(new[] { 1 }, await VersionsAsync(other, otherTenant.Id));
        Assert.NotEqual((0, 0), await ChildrenAsync(f.Db, siblings.Id));
        Assert.NotEqual((0, 0), await ChildrenAsync(other, strangers.Id));
    }

    // ── What a save that does not land leaves alone ───────────────────────────────

    [Fact]
    public async Task A_409_conflict_prunes_nothing()
    {
        await using var f = await SetUpAsync();
        var first = await StoreAsync(f.Db, f.TenantId, f.Participant.Id, 1);
        await StoreAsync(f.Db, f.TenantId, f.Participant.Id, 2);

        var stale = await SaveAsync(f, Request() with { BaseVersion = 1 });      // the page started from version 1, and version 2 exists

        Assert.Null(stale.Draft);
        Assert.Equal(2, stale.ConflictVersion);
        Assert.Equal(new[] { 1, 2 }, await VersionsAsync(f.Db, f.Participant.Id));
        Assert.NotEqual((0, 0), await ChildrenAsync(f.Db, first.Id));
    }

    [Fact]
    public async Task A_save_the_engine_refuses_prunes_nothing()
    {
        await using var f = await SetUpAsync();
        await StoreAsync(f.Db, f.TenantId, f.Participant.Id, 1);

        var refused = await SaveAsync(f, Request(MonWed() with { Days = Array.Empty<DayOfWeek>() }));

        Assert.Null(refused.Draft);
        Assert.Contains(refused.Errors, e => e.Contains("choose at least one day"));
        Assert.Equal(new[] { 1 }, await VersionsAsync(f.Db, f.Participant.Id));
    }

    /// <summary>Fails the first save its predicate matches, before anything of it is written (after <paramref name="meanwhile"/>, which is another request getting in first).</summary>
    private sealed class FailingSaveInterceptor(Func<ChangeTracker, bool> when, Func<Exception> failure, Func<Task>? meanwhile = null) : SaveChangesInterceptor
    {
        private bool _fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (_fired || !when(eventData.Context!.ChangeTracker)) return result;
            _fired = true;
            if (meanwhile is not null) await meanwhile();
            throw failure();
        }
    }

    private static bool Inserting(ChangeTracker tracker) => tracker.Entries<ServiceAgreementDraft>().Any(e => e.State == EntityState.Added);

    private static bool Deleting(ChangeTracker tracker) => tracker.Entries<ServiceAgreementDraft>().Any(e => e.State == EntityState.Deleted);

    [Fact]
    public async Task A_save_the_database_fails_prunes_nothing()
    {
        await using var f = await SetUpAsync();
        var stored = await StoreAsync(f.Db, f.TenantId, f.Participant.Id, 1);
        await using var failing = NewContext(f.DbName, f.TenantId, false, new FailingSaveInterceptor(Inserting, () => new DbUpdateException("the database went away")));

        await Assert.ThrowsAsync<DbUpdateException>(() => new ServiceAgreementDraftService(failing).SaveAsync(f.TenantId, f.Participant.Id, Request(), "actor", CancellationToken.None));

        await using var read = NewContext(f.DbName, f.TenantId);
        Assert.Equal(new[] { 1 }, await VersionsAsync(read, f.Participant.Id));
        Assert.NotEqual((0, 0), await ChildrenAsync(read, stored.Id));
    }

    [Fact]
    public async Task The_new_revision_and_the_pruning_are_one_save_so_a_prune_that_fails_stores_nothing_of_the_new_revision()
    {
        await using var f = await SetUpAsync();
        await StoreAsync(f.Db, f.TenantId, f.Participant.Id, 1);
        await using var failing = NewContext(f.DbName, f.TenantId, false, new FailingSaveInterceptor(Deleting, () => new DbUpdateException("the delete failed")));

        await Assert.ThrowsAsync<DbUpdateException>(() => new ServiceAgreementDraftService(failing).SaveAsync(f.TenantId, f.Participant.Id, Request(), "actor", CancellationToken.None));

        await using var read = NewContext(f.DbName, f.TenantId);
        Assert.Equal(new[] { 1 }, await VersionsAsync(read, f.Participant.Id));
    }

    [Fact]
    public async Task A_revision_another_save_deleted_first_is_a_conflict_with_the_newer_version_and_not_a_server_error()
    {
        await using var f = await SetUpAsync();
        await StoreAsync(f.Db, f.TenantId, f.Participant.Id, 1);
        // Two saves for one participant at once: the other lands (version 2, replacing version 1) before this one deletes version 1, so its delete finds nothing to delete and EF refuses it.
        var interceptor = new FailingSaveInterceptor(Deleting, () => new DbUpdateConcurrencyException("the row was already deleted"), async () =>
        {
            await using var other = NewContext(f.DbName, f.TenantId);
            Assert.NotNull((await new ServiceAgreementDraftService(other).SaveAsync(f.TenantId, f.Participant.Id, Request(), "someone-else", CancellationToken.None)).Draft);
        });
        await using var racing = NewContext(f.DbName, f.TenantId, false, interceptor);

        var loser = await new ServiceAgreementDraftService(racing).SaveAsync(f.TenantId, f.Participant.Id, Request(), "me", CancellationToken.None);

        Assert.Null(loser.Draft);
        Assert.Equal(2, loser.ConflictVersion);                        // the other save's version is the newest now
        await using var read = NewContext(f.DbName, f.TenantId);
        Assert.Equal(new[] { 2 }, await VersionsAsync(read, f.Participant.Id));
    }

    // ── The counter ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_version_stays_a_unique_increasing_counter_that_becomes_gapped_and_a_stale_base_version_is_still_a_conflict()
    {
        await using var f = await SetUpAsync();
        var approved = await StoreAsync(f.Db, f.TenantId, f.Participant.Id, 1);
        await ApproveAsync(f.Db, approved);

        var second = Assert.IsType<ServiceAgreementDraft>((await SaveAsync(f, Request() with { BaseVersion = 1 })).Draft);
        var third = Assert.IsType<ServiceAgreementDraft>((await SaveAsync(f, Request() with { BaseVersion = 2 })).Draft);      // version 2 is pruned by this save
        Assert.Equal(new[] { 1, 3 }, await VersionsAsync(f.Db, f.Participant.Id));

        var staleBase = await SaveAsync(f, Request() with { BaseVersion = 2 });                                                   // a page that still holds the pruned version 2
        var current = Assert.IsType<ServiceAgreementDraft>((await SaveAsync(f, Request() with { BaseVersion = 3 })).Draft);

        Assert.Equal((2, 3, 4), (second.Version, third.Version, current.Version));
        Assert.Null(staleBase.Draft);
        Assert.Equal(3, staleBase.ConflictVersion);
        Assert.Equal(new[] { 1, 4 }, await VersionsAsync(f.Db, f.Participant.Id));
    }

    // ── Onboarding's "service needs" step ─────────────────────────────────────────

    [Fact]
    public async Task Every_save_is_a_new_row_with_a_later_CreatedAt_so_a_confirmation_of_service_needs_still_goes_stale_on_the_next_save()
    {
        await using var f = await SetUpAsync();
        var clock = FakeClock.AtUtc(2026, 10, 5, 9, 0);
        var service = new ServiceAgreementDraftService(f.Db, clock: clock);
        f.Participant.IntakeCompletedAt = new DateTime(2026, 10, 1, 3, 0, 0, DateTimeKind.Utc);
        var onboarding = f.Db.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = f.TenantId, ParticipantId = f.Participant.Id }).Entity;
        await f.Db.SaveChangesAsync();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(f.TenantId);
        var controller = new ParticipantInquiriesController(f.Db, tenant.Object, clock);
        async Task<ParticipantOnboardingDto> OnboardingAsync() =>
            Assert.IsType<ApiResponse<ParticipantOnboardingDto>>(Assert.IsType<OkObjectResult>((await controller.GetOnboarding(f.Participant.Id, CancellationToken.None)).Result).Value).Data!;

        var first = Assert.IsType<ServiceAgreementDraft>((await service.SaveAsync(f.TenantId, f.Participant.Id, Request(), "actor", CancellationToken.None)).Draft);        // 09:00
        onboarding.RecordServiceNeedsConfirmation("coordinator", new DateTime(2026, 10, 5, 10, 0, 0, DateTimeKind.Utc));
        await f.Db.SaveChangesAsync();
        Assert.True((await OnboardingAsync()).ServiceTypeConfirmed);

        clock.Set(new DateTimeOffset(2026, 10, 5, 11, 0, 0, TimeSpan.Zero));
        var second = Assert.IsType<ServiceAgreementDraft>((await service.SaveAsync(f.TenantId, f.Participant.Id, Request(), "actor", CancellationToken.None)).Draft);       // 11:00, replacing the first

        Assert.Equal((new DateTime(2026, 10, 5, 9, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 5, 11, 0, 0, DateTimeKind.Utc)), (first.CreatedAt, second.CreatedAt));
        Assert.Equal(new[] { 2 }, await VersionsAsync(f.Db, f.Participant.Id));
        var stale = await OnboardingAsync();
        Assert.False(stale.ServiceTypeConfirmed);                                                                                          // confirmed at 10:00, before the 11:00 revision
        Assert.Contains(stale.Reasons, reason => reason.Contains("Service needs require server confirmation for the current draft revision."));

        onboarding.RecordServiceNeedsConfirmation("coordinator", new DateTime(2026, 10, 5, 12, 0, 0, DateTimeKind.Utc));
        await f.Db.SaveChangesAsync();
        Assert.True((await OnboardingAsync()).ServiceTypeConfirmed);
    }

    // ── A revision that gains a use while a save is replacing it ──────────────────

    [Fact]
    public async Task A_revision_approved_while_a_save_was_replacing_it_is_kept_and_the_save_still_lands()
    {
        await using var f = await SetUpAsync();
        var older = await StoreAsync(f.Db, f.TenantId, f.Participant.Id, 1);
        // Another request approves version 1 after this save read it as a plain revision and before it deleted it: the restricting key refuses the delete, and the whole save is rolled back.
        var interceptor = new FailingSaveInterceptor(Deleting,
            () => new DbUpdateException("update or delete violates foreign key constraint", new Npgsql.PostgresException(
                messageText: "update or delete on table \"ServiceAgreementDrafts\" violates foreign key constraint", severity: "ERROR", invariantSeverity: "ERROR",
                sqlState: Npgsql.PostgresErrorCodes.ForeignKeyViolation, tableName: "ServiceAgreementDrafts", constraintName: "FK_ServiceAgreementDraftApprovals_ServiceAgreementDrafts_DraftId")),
            async () =>
            {
                await using var approver = NewContext(f.DbName, f.TenantId);
                var row = await approver.ServiceAgreementDrafts.SingleAsync(d => d.Id == older.Id);
                await ApproveAsync(approver, row);
            });
        await using var racing = NewContext(f.DbName, f.TenantId, false, interceptor);

        var saved = await new ServiceAgreementDraftService(racing).SaveAsync(f.TenantId, f.Participant.Id, Request(), "actor", CancellationToken.None);

        Assert.Equal(2, Assert.IsType<ServiceAgreementDraft>(saved.Draft).Version);
        await using var read = NewContext(f.DbName, f.TenantId);
        Assert.Equal(new[] { 1, 2 }, await VersionsAsync(read, f.Participant.Id));
        Assert.True(await read.ServiceAgreementDraftApprovals.AnyAsync(a => a.DraftId == older.Id));
    }
}
