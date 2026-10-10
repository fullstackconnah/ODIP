using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Catalogue;

/// <summary>
/// Catalogue rows carry what the 2026-27 file holds (phase A item 1). The enum values are persisted integers, so they must never
/// be renumbered; the migration must be purely additive so it applies over the live rows.
/// </summary>
public class CatalogueItemModelTests
{
    private const string MigrationTypeName = "Odip.Infrastructure.Migrations.AddCatalogueItemClassificationAndZonePrices";

    private static OdipDbContext CreateDb() => TestDb.Create();

    [Fact]
    public void ClaimDayType_keeps_its_persisted_values_and_appends_WeekdayNight()
    {
        Assert.Equal(0, (int)ClaimDayType.Weekday);
        Assert.Equal(1, (int)ClaimDayType.Saturday);
        Assert.Equal(2, (int)ClaimDayType.Sunday);
        Assert.Equal(3, (int)ClaimDayType.Weekend);
        Assert.Equal(4, (int)ClaimDayType.PublicHoliday);
        Assert.Equal(5, (int)ClaimDayType.ShortNotice);
        Assert.Equal(6, (int)ClaimDayType.WeekdayEvening);
        Assert.Equal(7, (int)ClaimDayType.WeekdayNight);
    }

    [Fact]
    public async Task A_catalogue_item_round_trips_every_field_the_2026_27_file_holds()
    {
        await using var db = CreateDb();
        var group = new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "GRP_X", DisplayName = "X", SupportCategory = 1 };
        db.SupportActivityGroups.Add(group);
        db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = group.Id, ItemNumber = "01_002_0107_1_1", Description = "Weekday Night", Unit = "H",
            DayType = ClaimDayType.WeekdayNight, CatalogueVersion = "2026-27", EffectiveFrom = new DateOnly(2026, 7, 1), EffectiveTo = new DateOnly(2027, 6, 30),
            RegistrationGroup = "0107", SupportCategoryNumber = 1, PaceSupportCategoryNumber = 1, OutcomeDomain = 1, SupportPurpose = 1,
            CatalogueType = CatalogueItemType.Priced,
            NonFaceToFace = CatalogueClaimFlag.Yes, ProviderTravel = CatalogueClaimFlag.Yes, ShortNoticeCancellation = CatalogueClaimFlag.Yes,
            NdiaRequestedReports = CatalogueClaimFlag.No, IrregularSil = CatalogueClaimFlag.NotApplicable,
            IsLegacy = true, PriceNational = 82.57m, PriceRemote = 115.60m, PriceVeryRemote = null, SourceDocument = "support-catalogue-8038.xlsx",
        });
        await db.SaveChangesAsync();

        var item = await db.SupportCatalogueItems.AsNoTracking().SingleAsync();
        Assert.Equal(ClaimDayType.WeekdayNight, item.DayType);
        Assert.Equal(("0107", 1, 1, 1, 1), (item.RegistrationGroup, item.SupportCategoryNumber, item.PaceSupportCategoryNumber, item.OutcomeDomain, item.SupportPurpose));
        Assert.Equal(CatalogueItemType.Priced, item.CatalogueType);
        Assert.Equal(
            new[] { CatalogueClaimFlag.Yes, CatalogueClaimFlag.Yes, CatalogueClaimFlag.Yes, CatalogueClaimFlag.No, CatalogueClaimFlag.NotApplicable },
            new[] { item.NonFaceToFace, item.ProviderTravel, item.ShortNoticeCancellation, item.NdiaRequestedReports, item.IrregularSil }.Select(f => f!.Value));
        Assert.True(item.IsLegacy);
        Assert.Equal((82.57m, 115.60m, (decimal?)null), (item.PriceNational, item.PriceRemote, item.PriceVeryRemote));
        Assert.Equal(new DateOnly(2027, 6, 30), item.EffectiveTo);
        Assert.Equal("support-catalogue-8038.xlsx", item.SourceDocument);
    }

    [Fact]
    public void A_row_that_predates_the_new_columns_reads_back_as_unknown_not_as_a_value()
    {
        var item = new SupportCatalogueItem();
        Assert.Null(item.RegistrationGroup);
        Assert.Null(item.CatalogueType);
        Assert.Null(item.NonFaceToFace);
        Assert.Null(item.PriceNational);
        Assert.Null(item.PriceRemote);
        Assert.Null(item.PriceVeryRemote);
        Assert.False(item.IsLegacy);
    }

    [Fact]
    public void The_migration_only_adds_columns_and_each_is_nullable_or_defaulted()
    {
        var type = typeof(OdipDbContext).Assembly.GetType(MigrationTypeName);
        Assert.NotNull(type);
        var migration = (Migration)Activator.CreateInstance(type!)!;

        Assert.All(migration.UpOperations, op => Assert.IsType<AddColumnOperation>(op));
        var added = migration.UpOperations.Cast<AddColumnOperation>().ToList();
        Assert.All(added, c => Assert.Equal("SupportCatalogueItems", c.Table));
        Assert.All(added, c => Assert.True(c.IsNullable || c.DefaultValue is not null, $"{c.Name} would fail on existing rows"));

        var names = added.Select(c => c.Name).ToHashSet();
        foreach (var expected in new[]
        {
            "RegistrationGroup", "SupportCategoryNumber", "PaceSupportCategoryNumber", "OutcomeDomain", "SupportPurpose", "CatalogueType",
            "NonFaceToFace", "ProviderTravel", "ShortNoticeCancellation", "NdiaRequestedReports", "IrregularSil",
            "IsLegacy", "PriceNational", "PriceRemote", "PriceVeryRemote", "SourceDocument",
        })
            Assert.Contains(expected, names);

        // The down migration removes exactly what the up migration added.
        Assert.All(migration.DownOperations, op => Assert.IsType<DropColumnOperation>(op));
        Assert.Equal(names, migration.DownOperations.Cast<DropColumnOperation>().Select(c => c.Name).ToHashSet());
    }

    [Fact]
    public void The_zone_prices_keep_two_decimals_and_the_text_columns_are_bounded()
    {
        using var db = CreateDb();
        var entity = db.Model.FindEntityType(typeof(SupportCatalogueItem))!;
        foreach (var name in new[] { "PriceNational", "PriceRemote", "PriceVeryRemote" })
        {
            IProperty property = entity.FindProperty(name)!;
            Assert.True(property.IsNullable);
            Assert.Equal(2, property.GetScale());
            Assert.Equal(18, property.GetPrecision());
        }
        Assert.Equal(4, entity.FindProperty("RegistrationGroup")!.GetMaxLength());
        Assert.Equal(200, entity.FindProperty("SourceDocument")!.GetMaxLength());
    }
}
