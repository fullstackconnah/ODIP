using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

public class OnboardingImportCommitTests
{
    private const string Header = "First name,Last name,Date of birth,NDIS number,Contact 1 name,Contact 1 relationship";

    private static (OdipDbContext Db, Guid TenantId) Organisation()
    {
        var tenantId = Guid.NewGuid();
        return (TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId), tenantId);
    }

    private static Task<ImportResultDto> Commit(OdipDbContext db, Guid tenantId, byte[] file, ImportLanding? landing = ImportLanding.Active, string key = "key-1", IReadOnlyList<string?>? mapping = null) =>
        Service(db, tenantId).CommitAsync(ImportKind.Participants, file, "people.csv", mapping, landing, key, Admin(), CancellationToken.None);

    [Fact]
    public async Task Commit_creates_exactly_the_ready_rows_as_active_participants_in_the_organisation()
    {
        var (db, tenantId) = Organisation();
        using var _ = db;
        db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Old", LastName = "Hand", NdisNumber = "430000009" });
        await db.SaveChangesAsync();

        var result = await Commit(db, tenantId, Csv(Header, "Ava,Stone,03/04/1990,430000001,Ben Stone,Next of kin", "Bad,,,,,", "Old,Hand,,430000009,,"));

        Assert.Equal((1, 1, 1, false), (result.CreatedCount, result.SkippedCount, result.FailedCount, result.Replayed));
        var ava = await db.Participants.SingleAsync(p => p.LastName == "Stone");
        Assert.Equal((tenantId, true, false, (DateTime?)null), (ava.TenantId, ava.IsActive, ava.IsDraft, ava.IntakeCompletedAt));
        Assert.Equal(0, await db.ParticipantOnboardings.CountAsync());
        Assert.Equal("Ben", (await db.ParticipantContactRoles.Include(r => r.Person).SingleAsync()).Person!.FirstName);
        var batch = await db.ImportBatches.Include(b => b.Items).SingleAsync();
        Assert.Equal((result.BatchId, 3, "Ada Admin", AdminId), (batch.Id, batch.RowCount, batch.CreatedByName, batch.CreatedById!.Value));
        Assert.Equal(ava.Id, batch.Items.Single().EntityId);
    }

    [Fact]
    public async Task New_onboarding_completes_intake_through_the_manual_path()
    {
        var (db, tenantId) = Organisation();
        using var _ = db;
        await Commit(db, tenantId, Csv(Header, "Ava,Stone,,,,"), ImportLanding.Onboarding);

        var ava = await db.Participants.SingleAsync();
        Assert.True(ava.IsDraft);
        Assert.False(ava.IsActive);
        Assert.NotNull(ava.IntakeCompletedAt);
        Assert.Equal(ava.Id, (await db.ParticipantOnboardings.SingleAsync()).ParticipantId);
        Assert.Equal(AdminId.ToString(), (await db.ParticipantIntakeSnapshots.SingleAsync()).CompletedBy);
    }

    [Fact]
    public async Task Commit_without_a_landing_choice_or_a_required_column_is_refused()
    {
        var (db, tenantId) = Organisation();
        using var _ = db;
        var file = Csv(Header, "Ava,Stone,,,,");
        Assert.Equal(OnboardingImportService.ChooseLanding, (await Assert.ThrowsAsync<ImportException>(() => Commit(db, tenantId, file, landing: null))).Message);
        Assert.Equal("Match a column to Last name.", (await Assert.ThrowsAsync<ImportException>(() =>
            Commit(db, tenantId, file, mapping: ["firstName", null, null, null, null, null]))).Message);
        Assert.Equal(0, await db.Participants.CountAsync());
    }

    [Fact]
    public async Task A_double_submitted_import_returns_the_first_batch()
    {
        var (db, tenantId) = Organisation();
        using var _ = db;
        var file = Csv(Header, "Ava,Stone,,430000001,,");
        var first = await Commit(db, tenantId, file);
        var second = await Commit(db, tenantId, file);

        Assert.Equal((first.BatchId, 1, true), (second.BatchId, second.CreatedCount, second.Replayed));
        Assert.Equal(1, await db.Participants.CountAsync());
        Assert.Equal(1, await db.ImportBatches.CountAsync());
    }

    [Fact]
    public async Task A_row_that_became_a_duplicate_after_the_preview_is_skipped_at_commit()
    {
        var (db, tenantId) = Organisation();
        using var _ = db;
        var file = Csv(Header, "Ava,Stone,,430000001,,");
        Assert.Equal(1, (await Service(db, tenantId).PreviewAsync(ImportKind.Participants, file, "people.csv", null, CancellationToken.None)).ReadyCount);
        db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Ava", LastName = "Stone", NdisNumber = "430000001" });
        await db.SaveChangesAsync();

        var result = await Commit(db, tenantId, file);

        Assert.Equal((0, 1), (result.CreatedCount, result.SkippedCount));
        Assert.Equal(1, await db.Participants.CountAsync());
    }
}
