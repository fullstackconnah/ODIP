using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

public class ParticipantIntakeSnapshotServiceTests
{
    private static OdipDbContext Db(string name, Guid? tenantId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(x => x.TenantId).Returns(tenantId);
        tenant.Setup(x => x.IsSuperAdmin).Returns(!tenantId.HasValue);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
    }

    [Fact]
    public async Task Capture_IsDatedPdfHasHashAndIsIdempotentPerRequest()
    {
        using var db = Db(Guid.NewGuid().ToString());
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), FirstName = "Synthetic", LastName = "Participant",
            PrimaryDiagnosis = "Synthetic diagnosis", MobilityNotes = "Synthetic mobility", NdisNumber = "profile-only"
        };
        db.Participants.Add(p); await db.SaveChangesAsync();
        var service = new ParticipantIntakeSnapshotService(db);
        var first = await service.CaptureAsync(p, "actor-1", "request-1", default);
        p.FirstName = "Changed later"; await db.SaveChangesAsync();
        var retry = await service.CaptureAsync(p, "actor-1", "request-1", default);
        var next = await service.CaptureAsync(p, "actor-1", "request-2", default);
        Assert.Equal(first.Id, retry.Id);
        Assert.Equal(2, await db.ParticipantIntakeSnapshots.CountAsync());
        Assert.Equal(1, first.Revision); Assert.Equal(2, next.Revision);
        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(first.PdfContent, 0, 5));
        Assert.Equal(64, first.ContentHash.Length);
        Assert.Equal(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(first.SnapshotJson))).ToLowerInvariant(), first.ContentHash);
        Assert.Equal(DateTimeKind.Utc, first.CompletedAtUtc.Kind);
        Assert.Contains("Synthetic", first.SnapshotJson);
        Assert.Contains("Synthetic diagnosis", first.SnapshotJson);
        Assert.Contains("Synthetic mobility", first.SnapshotJson);
        Assert.DoesNotContain("profile-only", first.SnapshotJson);
        Assert.DoesNotContain("Changed later", first.SnapshotJson);
    }

    [Fact]
    public async Task PrepareCapture_DoesNotPersistUntilTheCallersSaveChanges()
    {
        using var db = Db(Guid.NewGuid().ToString());
        var p = new Participant { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), FirstName = "Synthetic", LastName = "Participant" };
        db.Participants.Add(p); await db.SaveChangesAsync();

        var snapshot = await new ParticipantIntakeSnapshotService(db).PrepareCaptureAsync(p, "actor", "request", default);

        Assert.Equal(EntityState.Added, db.Entry(snapshot).State);
        Assert.Empty(await db.ParticipantIntakeSnapshots.AsNoTracking().ToListAsync());

        await db.SaveChangesAsync();
        Assert.Single(await db.ParticipantIntakeSnapshots.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task Find_IsTenantScoped()
    {
        var tenantA = Guid.NewGuid(); var tenantB = Guid.NewGuid(); var database = Guid.NewGuid().ToString();
        Guid participantId;
        using (var ownerDb = Db(database, tenantB))
        {
            var p = new Participant { Id = Guid.NewGuid(), TenantId = tenantB, FirstName = "Tenant", LastName = "B" };
            participantId = p.Id;
            ownerDb.Participants.Add(p); await ownerDb.SaveChangesAsync();
            await new ParticipantIntakeSnapshotService(ownerDb).CaptureAsync(p, "actor", "request", default);
        }
        using var readerDb = Db(database, tenantA);
        Assert.Empty(await readerDb.ParticipantIntakeSnapshots.ToListAsync());

        var controller = new ParticipantsController(readerDb, new StaffCompatibilityLinkService(readerDb), new ParticipantDocumentService(readerDb), new SafetyNoteSyncService(readerDb));
        var result = await controller.DownloadIntakeSnapshotPdf(participantId, 1, default);
        Assert.IsType<NotFoundObjectResult>(result);
    }
}
