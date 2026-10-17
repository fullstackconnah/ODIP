using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

public class OnboardingImportPreviewTests
{
    private const string Header = "First name,Last name,Date of birth,NDIS number";

    private static (OdipDbContext Db, Guid TenantId) Organisation()
    {
        var tenantId = Guid.NewGuid();
        return (TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId), tenantId);
    }

    private static Task<ImportPreviewDto> Preview(OdipDbContext db, Guid tenantId, byte[] file) =>
        Service(db, tenantId).PreviewAsync(ImportKind.Participants, file, "people.csv", null, CancellationToken.None);

    [Fact]
    public async Task Preview_marks_each_row_and_writes_nothing()
    {
        var (db, tenantId) = Organisation();
        using var _ = db;
        db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Old", LastName = "Hand", NdisNumber = "430 000 009" });
        await db.SaveChangesAsync();

        var preview = await Preview(db, tenantId, Csv(Header, "Ava,Stone,03/04/1990,430000001", "Ben,,1990-01-01,", "Old,Hand,,430000009"));

        Assert.Equal((1, 1, 1), (preview.ReadyCount, preview.InvalidCount, preview.SkippedCount));
        Assert.Equal("Already in ODIP as Old Hand.", preview.Rows.Single(r => r.Status == ImportRowStatus.Skipped).SkipReason);
        Assert.Equal(new string?[] { "firstName", "lastName", "dateOfBirth", "ndisNumber" }, preview.Columns.Select(c => c.Field));
        Assert.False(db.ChangeTracker.HasChanges());
        Assert.Equal(1, await db.Participants.CountAsync());
        Assert.Equal(0, await db.ImportBatches.CountAsync());
    }

    [Fact]
    public async Task Preview_ignores_participants_an_undone_import_archived()
    {
        var (db, tenantId) = Organisation();
        using var _ = db;
        var archived = new Participant { Id = Guid.NewGuid(), FirstName = "Ava", LastName = "Stone", NdisNumber = "430000001", IsActive = false };
        var batch = new ImportBatch { Id = Guid.NewGuid(), FileName = "old.csv", FileSha256 = "x", IdempotencyKey = "k", CreatedByName = "A", UndoneAt = DateTime.UtcNow };
        batch.Items.Add(new ImportBatchItem { Id = Guid.NewGuid(), EntityType = "Participant", EntityId = archived.Id });
        db.AddRange(archived, batch);
        await db.SaveChangesAsync();

        var preview = await Preview(db, tenantId, Csv(Header, "Ava,Stone,,430000001"));

        Assert.Equal(ImportRowStatus.Ready, preview.Rows.Single().Status);
    }

    [Fact]
    public async Task Preview_does_not_match_a_placeholder_NDIS_number_to_anyone()
    {
        var (db, tenantId) = Organisation();
        using var _ = db;
        db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Old", LastName = "Hand", NdisNumber = "TBC" });
        await db.SaveChangesAsync();

        var preview = await Preview(db, tenantId, Csv(Header, "Ava,Stone,,TBC", "Ben,Stone,,TBC", "Cy,Stone,,N/A"));

        Assert.Equal(3, preview.ReadyCount);
        Assert.All(preview.Rows, r => Assert.Single(r.Warnings));
    }

    [Fact]
    public async Task Preview_flags_repeats_within_the_file()
    {
        var (db, tenantId) = Organisation();
        using var _ = db;
        var preview = await Preview(db, tenantId, Csv(Header, "Ava,Stone,,430000001", "Ava,Stone,,430 000 001"));
        Assert.Equal("The same NDIS number is on row 2.", preview.Rows[1].Reasons.Single());
    }

    [Fact]
    public async Task Preview_says_when_the_same_file_was_imported_before()
    {
        var (db, tenantId) = Organisation();
        using var _ = db;
        var file = Csv(Header, "Ava,Stone,,");
        db.ImportBatches.Add(new ImportBatch { Id = Guid.NewGuid(), FileName = "people.csv", FileSha256 = Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant(), IdempotencyKey = "k", CreatedByName = "A" });
        await db.SaveChangesAsync();

        Assert.NotNull((await Preview(db, tenantId, file)).PreviouslyImportedAt);
    }

    [Fact]
    public async Task Preview_shows_the_columns_even_when_a_required_one_is_unmatched()
    {
        var (db, tenantId) = Organisation();
        using var _ = db;
        var preview = await Preview(db, tenantId, Csv("Given name,Family", "Ava,Stone"));
        Assert.Equal(new string?[] { "firstName", null }, preview.Columns.Select(c => c.Field));
    }

    [Fact]
    public async Task Preview_refuses_a_SuperAdmin_who_is_not_viewing_an_organisation()
    {
        using var db = TestDb.Create();
        var superAdmin = new Mock<ICurrentTenant>();
        superAdmin.Setup(t => t.IsSuperAdmin).Returns(true);
        var ex = await Assert.ThrowsAsync<ImportException>(() =>
            Service(db, superAdmin.Object).PreviewAsync(ImportKind.Participants, Csv(Header, "Ava,Stone,,"), "people.csv", null, CancellationToken.None));
        Assert.Equal(OnboardingImportService.ChooseOrganisation, ex.Message);
    }
}
