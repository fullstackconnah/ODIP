using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Catalogue;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The storage the engine reads (phase B items 3 and 4): the provider's pricing settings with the owner-approved defaults, and the public holiday
/// override table seeded with the gaps NDIS-CODES 5.3 lists. One migration adds both, creating two tables and inserting the seed rows: no existing
/// table or row is touched, so it is safe on live data.
/// </summary>
public class PlanPricingStorageTests
{
    private static OdipDbContext CreateDb() => CatalogueImportTestSupport.CreateDb();

    // ── Settings: the owner-approved defaults ─────────────────────────────────────

    [Fact]
    public void A_new_settings_row_has_the_defaults_the_owner_approved()
    {
        var settings = new PlanPricingSettings();

        Assert.Equal(new[] { "0107", "0104", "0125", "0136", "0115", "0108" }, settings.RegistrationGroupsHeld.Split(','));
        Assert.False(settings.RegistrationGroupsConfirmed);
        Assert.Equal(CrossingPolicy.Split, settings.CrossingPolicy);
        Assert.True(settings.ClaimProviderTravel);
        Assert.Equal((0.99m, 2.76m, true), (settings.TravelKmRateStandard, settings.TravelKmRateAccessible, settings.TravelRatesProvisional));
        Assert.Equal(GroupOutingFamily.GroupActivities, settings.GroupOutings);
        Assert.True(settings.StaUsesHourlyAndAccommodation);
        Assert.Equal("Admin,Coordinator", settings.ApproverRoles);
    }

    [Fact]
    public void No_stored_settings_is_the_default_policy_and_the_defaults_are_the_same_either_way()
    {
        var fromNothing = PlanPricingPolicy.From(null);
        var fromRow = PlanPricingPolicy.From(new PlanPricingSettings());

        Assert.Equal(Json(PlanPricingPolicy.Default), Json(fromNothing));
        Assert.Equal(Json(PlanPricingPolicy.Default), Json(fromRow));
        Assert.False(fromNothing.RegistrationGroupsConfirmed);
    }

    [Fact]
    public void The_policy_reads_every_stored_setting()
    {
        var settings = new PlanPricingSettings
        {
            RegistrationGroupsHeld = "0107, 0125,0125,9999,", RegistrationGroupsConfirmed = true, CrossingPolicy = CrossingPolicy.HigherOf,
            ClaimProviderTravel = false, TravelKmRateStandard = 1.05m, TravelKmRateAccessible = 3.10m, TravelRatesProvisional = false,
            GroupOutings = GroupOutingFamily.CommunityAccess, StaUsesHourlyAndAccommodation = false, ApproverRoles = "Admin",
        };

        var policy = PlanPricingPolicy.From(settings);

        Assert.Equal(new[] { "0107", "0125" }, policy.RegistrationGroupsHeld);        // an unknown code is dropped, a repeat is one
        Assert.Equal((true, CrossingPolicy.HigherOf, false), (policy.RegistrationGroupsConfirmed, policy.Crossing, policy.ClaimProviderTravel));
        Assert.Equal((1.05m, 3.10m, false), (policy.KmRateStandard, policy.KmRateAccessible, policy.TravelRatesProvisional));
        Assert.Equal((GroupOutingFamily.CommunityAccess, false), (policy.GroupOutings, policy.StaUsesHourlyAndAccommodation));
        Assert.Equal(new[] { "Admin" }, policy.ApproverRoles);
    }

    [Fact]
    public void An_empty_registration_group_list_holds_nothing_it_does_not_mean_all()
    {
        var policy = PlanPricingPolicy.From(new PlanPricingSettings { RegistrationGroupsHeld = "" });

        Assert.Empty(policy.RegistrationGroupsHeld);
        Assert.False(policy.Holds("0125"));
    }

    [Fact]
    public async Task Settings_are_stored_one_row_per_tenant_and_read_back_unchanged()
    {
        await using var db = CreateDb();
        var tenantId = Guid.NewGuid();
        db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = tenantId, CrossingPolicy = CrossingPolicy.HigherOf, TravelKmRateStandard = 1.10m, RegistrationGroupsHeld = "0107,0125", RegistrationGroupsConfirmed = true });
        await db.SaveChangesAsync();

        var row = await db.PlanPricingSettings.AsNoTracking().SingleAsync();

        Assert.Equal((tenantId, CrossingPolicy.HigherOf, 1.10m, "0107,0125", true), (row.TenantId, row.CrossingPolicy, row.TravelKmRateStandard, row.RegistrationGroupsHeld, row.RegistrationGroupsConfirmed));
    }

    [Fact]
    public void The_model_keeps_the_rates_to_cents_the_text_bounded_and_one_settings_row_per_tenant()
    {
        using var db = CreateDb();
        var entity = db.Model.FindEntityType(typeof(PlanPricingSettings))!;

        foreach (var name in new[] { "TravelKmRateStandard", "TravelKmRateAccessible" })
        {
            IProperty property = entity.FindProperty(name)!;
            Assert.Equal((8, 2), (property.GetPrecision(), property.GetScale()));
        }
        Assert.Equal(40, entity.FindProperty("RegistrationGroupsHeld")!.GetMaxLength());
        Assert.Equal(100, entity.FindProperty("ApproverRoles")!.GetMaxLength());
        Assert.Contains(entity.GetIndexes(), i => i.IsUnique && i.Properties.Select(p => p.Name).SequenceEqual(new[] { "TenantId" }));
        Assert.NotNull(entity.GetQueryFilter());
        Assert.Null(db.Model.FindEntityType(typeof(PublicHolidayOverride))!.GetQueryFilter());   // like PublicHoliday, the override table is global
    }

    // ── The override table and its seed ───────────────────────────────────────────

    private static PublicHolidayOverride Seed(string state, int year, int month, int day) =>
        PublicHolidayOverrideSeed.All.Single(o => o.State == state && o.Date == new DateOnly(year, month, day));

    [Fact]
    public void The_seed_holds_the_gaps_NDIS_CODES_5_3_lists_with_a_source_and_a_stable_id()
    {
        var all = PublicHolidayOverrideSeed.All;

        Assert.Equal(15, all.Count);
        Assert.Equal(all.Count, all.Select(o => o.Id).Distinct().Count());
        Assert.All(all, o => { Assert.NotEqual(Guid.Empty, o.Id); Assert.False(string.IsNullOrWhiteSpace(o.Source)); Assert.InRange(o.Name.Length, 1, 100); });
        Assert.All(all, o => Assert.InRange(o.Date, new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30)));

        // Boxing Day, Saturday 26 December 2026, in every state the Nager feed left it out of (SA calls it Proclamation Day).
        foreach (var state in new[] { "ACT", "NSW", "NT", "QLD", "VIC", "WA" }) Assert.Equal("Boxing Day", Seed(state, 2026, 12, 26).Name);
        Assert.Equal("Proclamation Day holiday", Seed("SA", 2026, 12, 26).Name);
        // Anzac Day, Sunday 25 April 2027, in NSW and WA (ACT has an extra holiday that day).
        Assert.Equal("Anzac Day", Seed("NSW", 2027, 4, 25).Name);
        Assert.Equal("Anzac Day", Seed("WA", 2027, 4, 25).Name);
        Assert.Contains("Anzac", Seed("ACT", 2027, 4, 25).Name);
        // The whole-day rows have no hours.
        Assert.All(all.Where(o => o.Date.Month != 12 || o.Date.Day is 26), o => Assert.Null(o.StartTime));
    }

    [Fact]
    public void The_part_day_rows_are_the_ones_the_research_names_with_their_hours_and_run_to_midnight()
    {
        var part = PublicHolidayOverrideSeed.All.Where(o => o.StartTime is not null).ToList();

        Assert.Equal(5, part.Count);
        Assert.Equal(new TimeOnly(19, 0), Seed("NT", 2026, 12, 24).StartTime);
        Assert.Equal(new TimeOnly(19, 0), Seed("NT", 2026, 12, 31).StartTime);
        Assert.Equal(new TimeOnly(18, 0), Seed("QLD", 2026, 12, 24).StartTime);
        Assert.Equal(new TimeOnly(19, 0), Seed("SA", 2026, 12, 24).StartTime);
        Assert.Equal(new TimeOnly(19, 0), Seed("SA", 2026, 12, 31).StartTime);
        Assert.All(part, o => Assert.Null(o.EndTime));   // to midnight
        Assert.Equal(new[] { "Christmas Eve", "Christmas Eve", "Christmas Eve", "New Year's Eve", "New Year's Eve" }, part.Select(o => o.Name).OrderBy(n => n, StringComparer.Ordinal));
    }

    [Fact]
    public void Each_seed_row_keeps_the_literal_id_the_migration_inserted_it_with_whatever_rows_are_added_around_it()
    {
        // Review L11: ids built from the order the rows are added in would renumber every row after one inserted mid-list, and HasData would then rewrite rows the owner has
        // edited since. Each row is pinned to its id here, and the ids are the ones the migration's InsertData wrote.
        var expected = new (string Suffix, string Row)[]
        {
            ("01", "2026-12-26 ACT Boxing Day"), ("02", "2026-12-26 NSW Boxing Day"), ("03", "2026-12-26 NT Boxing Day"), ("04", "2026-12-26 QLD Boxing Day"),
            ("05", "2026-12-26 VIC Boxing Day"), ("06", "2026-12-26 WA Boxing Day"), ("07", "2026-12-26 SA Proclamation Day holiday"),
            ("08", "2027-04-25 ACT Extra public holiday for Anzac Day"), ("09", "2027-04-25 NSW Anzac Day"), ("10", "2027-04-25 WA Anzac Day"),
            ("11", "2026-12-24 NT Christmas Eve from 19:00"), ("12", "2026-12-31 NT New Year's Eve from 19:00"), ("13", "2026-12-24 QLD Christmas Eve from 18:00"),
            ("14", "2026-12-24 SA Christmas Eve from 19:00"), ("15", "2026-12-31 SA New Year's Eve from 19:00"),
        };

        var seeded = PublicHolidayOverrideSeed.All.ToDictionary(o => o.Id, o => string.Create(System.Globalization.CultureInfo.InvariantCulture,
            $"{o.Date:yyyy-MM-dd} {o.State} {o.Name}{(o.StartTime is { } from ? $" from {from:HH:mm}" : string.Empty)}"));

        // Rows may be added later (with their own new ids); none of these may move or change.
        Assert.True(seeded.Count >= expected.Length);
        foreach (var (suffix, row) in expected)
            Assert.Equal(row, seeded[new Guid($"5eed0000-0000-4000-8000-0000000000{suffix}")]);

        var insert = Assert.Single(TheMigration().UpOperations.OfType<InsertDataOperation>());
        var idColumn = Array.IndexOf(insert.Columns, "Id");
        var inserted = Enumerable.Range(0, insert.Values.GetLength(0)).Select(row => (Guid)insert.Values[row, idColumn]!).ToList();
        Assert.Equal(expected.Length, inserted.Count);
        Assert.All(inserted, id => Assert.Contains(id, seeded.Keys));
    }

    [Fact]
    public async Task A_new_database_holds_the_seed_rows_in_the_override_table()
    {
        await using var db = CreateDb();
        await db.Database.EnsureCreatedAsync();

        var rows = await db.PublicHolidayOverrides.AsNoTracking().ToListAsync();

        Assert.Equal(PublicHolidayOverrideSeed.All.Select(o => o.Id).OrderBy(i => i), rows.Select(r => r.Id).OrderBy(i => i));
    }

    // ── The migration ─────────────────────────────────────────────────────────────

    private static Migration TheMigration()
    {
        var type = typeof(OdipDbContext).Assembly.GetTypes().Single(t => t.Name == "AddPlanPricingSettingsAndHolidayOverrides" && typeof(Migration).IsAssignableFrom(t));
        return (Migration)Activator.CreateInstance(type)!;
    }

    [Fact]
    public void The_migration_only_creates_two_tables_their_indexes_and_the_seed_rows_and_touches_nothing_that_exists()
    {
        var migration = TheMigration();

        Assert.All(migration.UpOperations, op => Assert.True(op is CreateTableOperation or CreateIndexOperation or InsertDataOperation, $"{op.GetType().Name} could change existing data"));
        var created = migration.UpOperations.OfType<CreateTableOperation>().Select(o => o.Name).ToHashSet();
        Assert.Equal(new[] { "PlanPricingSettings", "PublicHolidayOverrides" }.ToHashSet(), created);
        Assert.All(migration.UpOperations.OfType<CreateIndexOperation>(), i => Assert.Contains(i.Table, created));
        Assert.All(migration.UpOperations.OfType<InsertDataOperation>(), i => Assert.Equal("PublicHolidayOverrides", i.Table));
        Assert.Equal(PublicHolidayOverrideSeed.All.Count, migration.UpOperations.OfType<InsertDataOperation>().Sum(i => i.Values.GetLength(0)));

        // The foreign key reaches an existing table but only to point at it.
        var settings = migration.UpOperations.OfType<CreateTableOperation>().Single(o => o.Name == "PlanPricingSettings");
        Assert.Equal("Tenants", Assert.Single(settings.ForeignKeys).PrincipalTable);

        // Down drops exactly the two tables.
        Assert.All(migration.DownOperations, op => Assert.IsType<DropTableOperation>(op));
        Assert.Equal(created, migration.DownOperations.Cast<DropTableOperation>().Select(o => o.Name).ToHashSet());
    }

    [Fact]
    public void The_new_columns_are_not_null_with_constant_defaults_so_a_row_inserted_by_an_older_build_reads_back_as_the_defaults()
    {
        var table = TheMigration().UpOperations.OfType<CreateTableOperation>().Single(o => o.Name == "PlanPricingSettings");

        foreach (var name in new[] { "RegistrationGroupsHeld", "RegistrationGroupsConfirmed", "CrossingPolicy", "ClaimProviderTravel", "TravelKmRateStandard", "TravelKmRateAccessible", "TravelRatesProvisional", "GroupOutings", "StaUsesHourlyAndAccommodation", "ApproverRoles" })
        {
            var column = table.Columns.Single(c => c.Name == name);
            Assert.False(column.IsNullable, name);
            Assert.NotNull(column.DefaultValue);
        }
    }
}
