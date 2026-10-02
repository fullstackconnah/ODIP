using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;

namespace Odip.Tests.Catalogue;

/// <summary>Shared set-up for the catalogue importer tests: an InMemory database, a fixed clock and one-call preview-then-confirm.</summary>
internal static class CatalogueImportTestSupport
{
    public static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    /// <summary>02:00 UTC on the given date, which is midday in Sydney (the provider's zone when there is no settings row): the provider's date is the same day all year.</summary>
    public static TimeProvider ClockOn(int year, int month, int day) => FakeClock.AtUtc(year, month, day, 2, 0);

    /// <summary>The date the importer tests treat as today: after the 2026-27 catalogue started, and after its first legacy items ended (30 Sep 2026).</summary>
    public static TimeProvider Today => ClockOn(2026, 10, 2);

    public static CatalogueImportService NewImporter(OdipDbContext db, TimeProvider? clock = null) => new(db, clock ?? Today);

    public static Task<CatalogueImportPreviewDto> PreviewAsync(OdipDbContext db, string fixture, TimeProvider? clock = null)
    {
        using var stream = CatalogueFixtures.Open(fixture);
        return NewImporter(db, clock).PreviewImportAsync(stream, fixture);
    }

    /// <summary>What an admin does: upload the file, read the preview, confirm it with the proposed version unless one is given.</summary>
    public static async Task<CatalogueImportResultDto> ImportAsync(OdipDbContext db, string fixture, string? version = null, TimeProvider? clock = null)
    {
        var preview = await PreviewAsync(db, fixture, clock);
        return await NewImporter(db, clock).CommitImportAsync(new ConfirmCatalogueImportDto
        {
            CatalogueVersion = version ?? preview.DetectedVersion,
            Rows = preview.Rows,
        });
    }

    /// <summary>The group the demo seed has always created (so an import runs against a database as deployed).</summary>
    public static async Task<SupportActivityGroup> SeedCommunityAccessGroupAsync(OdipDbContext db)
    {
        var group = new SupportActivityGroup { Id = Guid.Parse("c0000000-0000-0000-0000-000000000001"), GroupCode = "GRP_COMMUNITY_ACCESS", DisplayName = "Group Community Access", SupportCategory = 4 };
        db.SupportActivityGroups.Add(group);
        await db.SaveChangesAsync();
        return group;
    }

    /// <summary>A row as the previous importer or the demo seed wrote it: no source document, none of the new columns, a start date that is the day it ran.</summary>
    public static SupportCatalogueItem LegacyRow(Guid groupId, string code, ClaimDayType dayType, decimal price, DateOnly from, bool active = true, DateOnly? to = null, string version = "2025-26") => new()
    {
        Id = Guid.NewGuid(), ActivityGroupId = groupId, ItemNumber = code, Description = "Legacy " + code, Unit = "H", DayType = dayType,
        PriceLimit_ACT = price, PriceLimit_NSW = price, PriceLimit_NT = price, PriceLimit_QLD = price, PriceLimit_SA = price, PriceLimit_TAS = price,
        PriceLimit_VIC = price, PriceLimit_WA = price, PriceLimit_Remote = price * 1.4m, PriceLimit_VeryRemote = price * 1.5m,
        CatalogueVersion = version, EffectiveFrom = from, EffectiveTo = to, IsActive = active,
    };

    public static Task<List<SupportCatalogueItem>> RowsAsync(OdipDbContext db) =>
        db.SupportCatalogueItems.AsNoTracking().Include(i => i.ActivityGroup).OrderBy(i => i.ItemNumber).ThenBy(i => i.EffectiveFrom).ToListAsync();

    /// <summary>Every stored column of every row, in a stable order, as text: two snapshots are equal only if nothing in the table changed.</summary>
    public static async Task<List<string>> SnapshotAsync(OdipDbContext db)
    {
        var rows = await db.SupportCatalogueItems.AsNoTracking().OrderBy(i => i.ItemNumber).ThenBy(i => i.EffectiveFrom).ToListAsync();
        return rows.Select(r => string.Join("|", r.GetType().GetProperties()
            .Where(p => p.PropertyType != typeof(SupportActivityGroup))
            .Select(p => $"{p.Name}={p.GetValue(r)}"))).ToList();
    }
}
