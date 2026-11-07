using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Audit;

/// <summary>An amendment's reason and note are in its own audit entry, even when a second amendment repeats the same values; other updates never carry them.</summary>
public class MedicationAmendmentAuditTests
{
    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim("fullName", "Cora Coordinator")], "Test");
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).AddInterceptors(new AuditInterceptor(accessor.Object)).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static async Task<(OdipDbContext Db, MedicationAdministration Admin)> SeedAsync()
    {
        var db = CreateDb();
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng" };
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "2 tablets",
            Type = MedicationType.Prn, Status = MedicationStatus.Active, StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
        };
        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, RecordedByName = "Test",
        };
        db.AddRange(participant, med, admin);
        await db.SaveChangesAsync();
        return (db, admin);
    }

    private static void Amend(MedicationAdministration a, DateTime at)
    {
        a.AmendmentReason = MedicationAmendmentReason.WrongTime;
        a.AmendmentNote = "Gave at 9";
        a.AmendedAt = at;
    }

    private static List<AuditLog> Updates(OdipDbContext db, Guid id) =>
        db.AuditLogs.Where(a => a.EntityType == nameof(MedicationAdministration) && a.EntityId == id && a.Action == AuditAction.Updated).OrderBy(a => a.ChangedAt).ToList();

    [Fact]
    public async Task FirstAmendment_AuditShowsNullToCode()
    {
        var (db, admin) = await SeedAsync();
        Amend(admin, DateTime.UtcNow);
        await db.SaveChangesAsync();

        var changes = Updates(db, admin.Id).Single().Changes;
        Assert.Contains("\"AmendmentReason\"", changes);
        Assert.Contains("WrongTime", changes);
        Assert.Contains("Gave at 9", changes);
    }

    [Fact]
    public async Task RepeatedAmendment_EachAuditEntryCarriesReasonAndNote()
    {
        var (db, admin) = await SeedAsync();
        Amend(admin, DateTime.UtcNow);
        await db.SaveChangesAsync();
        Amend(admin, DateTime.UtcNow.AddMinutes(5));
        await db.SaveChangesAsync();

        var entries = Updates(db, admin.Id);
        Assert.Equal(2, entries.Count);
        Assert.All(entries, e =>
        {
            Assert.Contains("\"AmendmentReason\"", e.Changes);
            Assert.Contains("\"AmendmentNote\"", e.Changes);
        });
    }

    [Fact]
    public async Task SecondAmendmentWithAnotherReason_AuditKeepsTheFirstReasonAsOld()
    {
        var (db, admin) = await SeedAsync();
        Amend(admin, DateTime.UtcNow);
        await db.SaveChangesAsync();
        admin.AmendmentReason = MedicationAmendmentReason.WrongDose;
        admin.AmendmentNote = "Gave 1 tablet";
        admin.AmendedAt = DateTime.UtcNow.AddMinutes(5);
        await db.SaveChangesAsync();

        var second = Updates(db, admin.Id).Last().Changes;
        Assert.Contains("{\"Field\":\"AmendmentReason\",\"Old\":\"WrongTime\",\"New\":\"WrongDose\"}", second);
        Assert.Contains("\"Old\":\"Gave at 9\"", second);
    }

    [Fact]
    public async Task NonAmendUpdate_WritesNoAmendmentFields()
    {
        var (db, admin) = await SeedAsync();
        Amend(admin, DateTime.UtcNow);
        await db.SaveChangesAsync();
        admin.PrnOutcome = "Settled";
        admin.PrnOutcomeAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var last = Updates(db, admin.Id).Last().Changes;
        Assert.Contains("PrnOutcome", last);
        Assert.DoesNotContain("AmendmentReason", last);
        Assert.DoesNotContain("AmendmentNote", last);
    }

    [Fact]
    public async Task OtherEntityUpdate_AuditEntryIsUnchanged()
    {
        var (db, admin) = await SeedAsync();
        var participant = await db.Participants.SingleAsync();
        participant.FirstName = "Amelia";
        await db.SaveChangesAsync();

        var entry = db.AuditLogs.Single(a => a.EntityType == nameof(Participant) && a.Action == AuditAction.Updated);
        Assert.Equal("[{\"Field\":\"FirstName\",\"Old\":\"Amy\",\"New\":\"Amelia\"}]", entry.Changes);
    }
}
