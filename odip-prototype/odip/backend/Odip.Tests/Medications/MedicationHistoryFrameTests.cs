using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Medications;

// Regression coverage for provider-local history boundaries.
public class MedicationHistoryFrameTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public MedicationHistoryFrameTests(PostgresFixture pg) => _pg = pg;

    private static readonly CancellationToken Ct = CancellationToken.None;

    private static async Task<(OdipDbContext Db, MedicationsController C, ParticipantMedication Med)> SetupAsync(string? state = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)Guid.Empty);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        if (state != null) db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = Guid.Empty, State = state });
        var p = new Participant { Id = Guid.NewGuid(), TenantId = Guid.Empty, FirstName = "A", LastName = "B", IsActive = true };
        var med = new ParticipantMedication { Id = Guid.NewGuid(), TenantId = Guid.Empty, ParticipantId = p.Id, Name = "Lev", DoseDescription = "1", Type = MedicationType.Regular, TimesOfDay = "08:00,20:00", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active };
        db.Participants.Add(p); db.ParticipantMedications.Add(med);
        await db.SaveChangesAsync(Ct);
        return (db, new MedicationsController(db, tenant.Object), med);
    }

    // A refused dose: no AdministeredAt (RecordAdministrationModal sends none when not administered), ScheduledAt is the provider wall clock.
    private static MedicationAdministration Refused(ParticipantMedication med, DateTime scheduledLocal, DateTime createdUtc) => new()
    {
        Id = Guid.NewGuid(), TenantId = med.TenantId, ParticipantMedicationId = med.Id, ParticipantId = med.ParticipantId,
        Status = MedicationAdministrationStatus.Refused, Reason = "Refused", ScheduledAt = scheduledLocal, AdministeredAt = null,
        RecordedByName = "T", CreatedAt = createdUtc, UpdatedAt = createdUtc,
    };

    private static MedicationAdministration Given(ParticipantMedication med, DateTime utc) => new()
    {
        Id = Guid.NewGuid(), TenantId = med.TenantId, ParticipantMedicationId = med.Id, ParticipantId = med.ParticipantId,
        Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.SpecifyKind(utc, DateTimeKind.Utc),
        RecordedByName = "T", CreatedAt = utc, UpdatedAt = utc,
    };

    private static async Task<List<Guid>> ReportAsync(MedicationsController c, DateTime from, DateTime to)
    {
        var r = await c.GetAdministrationReport(null, from, to, 1, 200, Ct);
        return Assert.IsType<ApiResponse<PagedResult<AdministrationDto>>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!.Items.Select(a => a.Id).ToList();
    }

    [Fact]
    public async Task RefusedEveningDose_IsInItsOwnDay_NotTheDayBefore()
    {
        var (db, c, med) = await SetupAsync();
        var day = new DateTime(2026, 10, 14);
        var tonight = Refused(med, new DateTime(2026, 10, 14, 20, 0, 0), new DateTime(2026, 10, 14, 9, 5, 0, DateTimeKind.Utc));
        var lastNight = Refused(med, new DateTime(2026, 10, 13, 20, 0, 0), new DateTime(2026, 10, 13, 9, 5, 0, DateTimeKind.Utc));
        db.MedicationAdministrations.AddRange(tonight, lastNight);
        await db.SaveChangesAsync(Ct);
        Assert.Equal(new[] { tonight.Id }, await ReportAsync(c, day, day));
        var list = await c.GetParticipantAdministrations(med.ParticipantId, day, day, Ct);
        Assert.Equal(new[] { tonight.Id }, Assert.IsType<ApiResponse<List<AdministrationDto>>>(Assert.IsType<OkObjectResult>(list.Result).Value).Data!.Select(a => a.Id));
    }

    [Theory]
    // Sydney DST start 2026-10-04 (02:00 -> 03:00, 23h day): 00:30 local = 03 Oct 14:30Z in; 23:30 local = 04 Oct 12:30Z in; 00:10 05 Oct = 04 Oct 13:10Z out; 23:50 03 Oct = 03 Oct 13:50Z out.
    [InlineData(null, 2026, 10, 4, "2026-10-03T14:30:00", "2026-10-04T12:30:00", "2026-10-04T13:10:00", "2026-10-03T13:50:00")]
    // Sydney DST end 2026-04-05 (03:00 -> 02:00, 25h day): 00:30 local (AEDT) = 04 Apr 13:30Z; 23:30 local (AEST) = 05 Apr 13:30Z; 00:10 06 Apr = 05 Apr 14:10Z out; 23:50 04 Apr = 04 Apr 12:50Z out.
    [InlineData(null, 2026, 4, 5, "2026-04-04T13:30:00", "2026-04-05T13:30:00", "2026-04-05T14:10:00", "2026-04-04T12:50:00")]
    // Perth (WA, +08, no DST) 2026-10-14: 00:30 = 13 Oct 16:30Z; 23:30 = 14 Oct 15:30Z; 00:10 15 Oct = 14 Oct 16:10Z out; 23:50 13 Oct = 13 Oct 15:50Z out.
    [InlineData("WA", 2026, 10, 14, "2026-10-13T16:30:00", "2026-10-14T15:30:00", "2026-10-14T16:10:00", "2026-10-13T15:50:00")]
    // Adelaide (SA, +10:30 in October) 2026-10-14: 00:30 = 13 Oct 14:00Z; 23:30 = 14 Oct 13:00Z; 00:10 15 Oct = 14 Oct 13:40Z out; 23:50 13 Oct = 13 Oct 13:20Z out.
    [InlineData("SA", 2026, 10, 14, "2026-10-13T14:00:00", "2026-10-14T13:00:00", "2026-10-14T13:40:00", "2026-10-13T13:20:00")]
    public async Task DayBounds_AcrossDstAndZones(string? state, int y, int m, int d, string inEarly, string inLate, string outAfter, string outBefore)
    {
        var (db, c, med) = await SetupAsync(state);
        var a = Given(med, DateTime.Parse(inEarly)); var b = Given(med, DateTime.Parse(inLate));
        db.MedicationAdministrations.AddRange(a, b, Given(med, DateTime.Parse(outAfter)), Given(med, DateTime.Parse(outBefore)));
        await db.SaveChangesAsync(Ct);
        var day = new DateTime(y, m, d);
        Assert.Equal(new[] { a.Id, b.Id }.OrderBy(x => x), (await ReportAsync(c, day, day)).OrderBy(x => x));
    }

    [SkippableFact]
    public async Task RefusedEveningDose_OnPostgres()
    {
        Skip.IfNot(_pg.Available, "no pg");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var tenant = new Mock<ICurrentTenant>(); tenant.Setup(t => t.TenantId).Returns(tenantId); tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var p = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "A", LastName = "B", IsActive = true };
        var med = new ParticipantMedication { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, Name = "Lev", DoseDescription = "1", Type = MedicationType.Regular, TimesOfDay = "08:00,20:00", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active };
        db.Participants.Add(p); db.ParticipantMedications.Add(med);
        var tonight = Refused(med, new DateTime(2026, 10, 14, 20, 0, 0), new DateTime(2026, 10, 14, 9, 5, 0, DateTimeKind.Utc));
        var lastNight = Refused(med, new DateTime(2026, 10, 13, 20, 0, 0), new DateTime(2026, 10, 13, 9, 5, 0, DateTimeKind.Utc));
        var given = Given(med, new DateTime(2026, 10, 14, 10, 0, 0));
        db.MedicationAdministrations.AddRange(tonight, lastNight, given);
        await db.SaveChangesAsync(Ct);
        var c = new MedicationsController(db, tenant.Object);
        var day = new DateTime(2026, 10, 14);
        Assert.Equal(new[] { tonight.Id, given.Id }.OrderBy(x => x), (await ReportAsync(c, day, day)).OrderBy(x => x));
        var list = await c.GetParticipantAdministrations(p.Id, day, day, Ct);
        Assert.Equal(new[] { tonight.Id, given.Id }.OrderBy(x => x), Assert.IsType<ApiResponse<List<AdministrationDto>>>(Assert.IsType<OkObjectResult>(list.Result).Value).Data!.Select(a => a.Id).OrderBy(x => x));
    }

    // An unscoped SuperAdmin's report over two organisations: the per-organisation ranges are UNION ALLed inside an IN, which Npgsql must translate.
    [SkippableFact]
    public async Task Report_TwoOrganisationsInOneRange_OnPostgres()
    {
        Skip.IfNot(_pg.Available, "no pg");
        var (perthDb, perth) = await _pg.NewTenantContextAsync();
        var (sydneyDb, sydney) = await _pg.NewTenantContextAsync();
        await perthDb.DisposeAsync(); await sydneyDb.DisposeAsync();
        var tenant = new Mock<ICurrentTenant>(); tenant.Setup(t => t.TenantId).Returns((Guid?)null); tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString, tenant.Object);
        db.ProviderSettings.AddRange(new ProviderSettings { Id = Guid.NewGuid(), TenantId = perth, State = "WA" }, new ProviderSettings { Id = Guid.NewGuid(), TenantId = sydney, State = "NSW" });
        // The same instant, 15:00 UTC on the 13th: 23:00 on the 13th in Perth, 01:00 on the 14th in Sydney.
        var doses = new List<MedicationAdministration>();
        foreach (var t in new[] { perth, sydney })
        {
            var p = new Participant { Id = Guid.NewGuid(), TenantId = t, FirstName = "A", LastName = "B", IsActive = true };
            var med = new ParticipantMedication { Id = Guid.NewGuid(), TenantId = t, ParticipantId = p.Id, Name = "Lev", DoseDescription = "1", Type = MedicationType.Regular, TimesOfDay = "09:00", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active };
            db.Participants.Add(p); db.ParticipantMedications.Add(med);
            doses.Add(Given(med, new DateTime(2026, 7, 13, 15, 0, 0)));
        }
        db.MedicationAdministrations.AddRange(doses);
        await db.SaveChangesAsync(Ct);
        var c = new MedicationsController(db, tenant.Object);

        Assert.Equal(new[] { doses[1].Id }, await ReportAsync(c, new DateTime(2026, 7, 14), new DateTime(2026, 7, 14)));
        Assert.Equal(new[] { doses[0].Id }, await ReportAsync(c, new DateTime(2026, 7, 13), new DateTime(2026, 7, 13)));
        var paged = Assert.IsType<ApiResponse<PagedResult<AdministrationDto>>>(Assert.IsType<OkObjectResult>((await c.GetAdministrationReport(null, new DateTime(2026, 7, 13), new DateTime(2026, 7, 14), 1, 1, Ct)).Result).Value).Data!;
        Assert.Equal(2, paged.TotalCount);
        Assert.Single(paged.Items);
    }
}

