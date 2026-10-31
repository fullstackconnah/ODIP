using System.Linq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Alerts;

/// <summary>The three behaviour support plan alert rules (RP PR 1). The clock is fixed at 2026-10-31 02:00 UTC, which is 13:00 in Sydney, so today is 2026-10-31.</summary>
public class BspAlertsTests
{
    private static Participant SeedParticipant(OdipDbContext db, Guid? tenantId = null)
    {
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        if (tenantId != null) p.TenantId = tenantId.Value;
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static void SeedEntry(OdipDbContext db, Participant p, DateOnly? firstUsed, Action<RestrictivePractice>? tweak = null)
    {
        var rp = new RestrictivePractice
        {
            Id = Guid.NewGuid(), TenantId = p.TenantId, ParticipantId = p.Id, Type = RestrictivePracticeType.PhysicalRestraint,
            Description = "d", IsActive = true, FirstUsedOn = firstUsed,
        };
        tweak?.Invoke(rp);
        db.RestrictivePractices.Add(rp);
        db.SaveChanges();
    }

    private static async Task<List<Odip.Application.DTOs.ParticipantAlertDto>> Alerts(OdipDbContext db, Guid participantId) =>
        (await new ParticipantAlertsService(db, FakeClock.AtUtc(2026, 10, 31, 2, 0)).GetAlertsAsync(participantId)).SelectMany(a => a.Alerts).ToList();

    [Fact]
    public async Task InterimBspDueWithin7Days_Warning()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        SeedEntry(db, p, new DateOnly(2026, 10, 7));

        var alert = Assert.Single(await Alerts(db, p.Id));

        Assert.Equal("rp-interim-bsp-due", alert.Type);
        Assert.Equal(AlertSeverity.Warning, alert.Severity);
        Assert.Equal("Interim behaviour support plan for physical restraint is due 07/11/2026", alert.Message);
        Assert.Equal("restrictive-practices", alert.DeepLinkTab);
    }

    [Fact]
    public async Task InterimBspOverdue_Critical()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        SeedEntry(db, p, new DateOnly(2026, 9, 1));

        var alert = Assert.Single(await Alerts(db, p.Id));

        Assert.Equal("rp-interim-bsp-overdue", alert.Type);
        Assert.Equal(AlertSeverity.Critical, alert.Severity);
        Assert.Equal("Interim behaviour support plan for physical restraint was due 01/10/2026 and is overdue", alert.Message);
        Assert.Equal("restrictive-practices", alert.DeepLinkTab);
    }

    [Fact]
    public async Task ComprehensiveBspOverdue_Critical()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        SeedEntry(db, p, new DateOnly(2026, 3, 1), r => r.InterimBspDate = new DateOnly(2026, 3, 20));

        var alert = Assert.Single(await Alerts(db, p.Id));

        Assert.Equal("rp-comprehensive-bsp-overdue", alert.Type);
        Assert.Equal(AlertSeverity.Critical, alert.Severity);
        Assert.Equal("Comprehensive behaviour support plan for physical restraint was due 01/09/2026 and is overdue", alert.Message);
    }

    [Fact]
    public async Task NoBspAlert_WithoutFirstUse()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        SeedEntry(db, p, null);

        Assert.Empty(await Alerts(db, p.Id));
    }

    [Fact]
    public async Task NoBspAlert_OnceComprehensiveRecorded_OrForAnInactiveEntry()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        SeedEntry(db, p, new DateOnly(2026, 3, 1), r => r.ComprehensiveBspDate = new DateOnly(2026, 4, 1));
        SeedEntry(db, p, new DateOnly(2026, 3, 1), r => r.IsActive = false);

        Assert.Empty(await Alerts(db, p.Id));
    }

    [Fact]
    public async Task NoInterimAlert_OnceInterimRecorded()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        SeedEntry(db, p, new DateOnly(2026, 9, 1), r => r.InterimBspDate = new DateOnly(2026, 9, 10));

        Assert.Empty(await Alerts(db, p.Id));
    }

    [Fact]
    public async Task Alerts_BspRule_IgnoresOtherTenantsEntries()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        Guid participantId;
        using (var seed = TestDb.Create(dbName))
        {
            var p = SeedParticipant(seed, tenantA);
            participantId = p.Id;
            SeedEntry(seed, p, new DateOnly(2026, 9, 1), r => r.TenantId = tenantB);
        }
        using var scoped = TestDb.ForTenant(dbName, tenantA);

        Assert.Empty(await Alerts(scoped, participantId));
    }
}
