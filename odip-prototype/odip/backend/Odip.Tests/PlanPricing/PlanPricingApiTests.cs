using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The internal quote endpoint and the settings routes (phase B item 6): POST api/v1/plan-pricing/quote, GET and PUT api/v1/plan-pricing/settings.
/// Internal: phase C's builder is their only caller. The settings are the caller's own tenant's, whatever other tenants store, and the holidays are
/// the synced rows and the override rows together.
/// </summary>
public class PlanPricingApiTests
{
    private static readonly Guid TenantA = Guid.NewGuid(), TenantB = Guid.NewGuid();

    /// <summary>A database as a tenant's Admin sees it (query filters on), with the real 2026-27 catalogue imported and the seeded overrides in place.</summary>
    private static async Task<(OdipDbContext Db, PlanPricingController Controller)> SetUpAsync(Guid? tenantId = null, bool superAdmin = false, string? dbName = null)
    {
        var name = dbName ?? Guid.NewGuid().ToString();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
        await db.Database.EnsureCreatedAsync();
        if (!await db.SupportCatalogueItems.AnyAsync())
        {
            // The catalogue is global: import it as a SuperAdmin would, into the same database.
            var admin = new Mock<ICurrentTenant>();
            admin.Setup(t => t.IsSuperAdmin).Returns(true);
            await using var importDb = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, admin.Object);
            await CatalogueImportTestSupport.ImportAsync(importDb, CatalogueFixtures.File2026_27);
        }

        return (db, new PlanPricingController(db, tenant.Object, new PlanPricingService(db)));
    }

    private static PlanQuoteRequestDto Request(IEnumerable<PlanBlock> blocks, DateOnly from, DateOnly to, bool includeLines = true) =>
        new() { Blocks = blocks.ToList(), PeriodFrom = from, PeriodTo = to, IncludeLines = includeLines };

    private static PlanBlock Community(string id = "c") => Block(id, PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13));

    private static T Ok<T>(ActionResult<ApiResponse<T>> result) =>
        Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static string BadRequest<T>(ActionResult<ApiResponse<T>> result) =>
        Assert.Single(Assert.IsType<ApiResponse<T>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors!);

    // ── Access ────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_routes_are_for_an_Admin_or_a_Coordinator_and_only_an_Admin_may_change_the_settings()
    {
        var type = typeof(PlanPricingController);

        Assert.Equal("SuperAdmin,Admin,Coordinator", type.GetCustomAttribute<AuthorizeAttribute>()?.Roles);
        Assert.Equal("api/v1/plan-pricing", type.GetCustomAttribute<RouteAttribute>()?.Template);
        Assert.Equal("quote", type.GetMethod(nameof(PlanPricingController.Quote))!.GetCustomAttribute<HttpPostAttribute>()?.Template);
        Assert.Equal("settings", type.GetMethod(nameof(PlanPricingController.GetSettings))!.GetCustomAttribute<HttpGetAttribute>()?.Template);
        Assert.Equal("settings", type.GetMethod(nameof(PlanPricingController.PutSettings))!.GetCustomAttribute<HttpPutAttribute>()?.Template);
        Assert.Equal("SuperAdmin,Admin", type.GetMethod(nameof(PlanPricingController.PutSettings))!.GetCustomAttribute<AuthorizeAttribute>()?.Roles);
        Assert.Null(type.GetMethod(nameof(PlanPricingController.Quote))!.GetCustomAttribute<AuthorizeAttribute>());
    }

    [Fact]
    public async Task A_SuperAdmin_with_no_organisation_in_view_is_asked_to_pick_one()
    {
        var (db, controller) = await SetUpAsync(tenantId: null, superAdmin: true);
        await using var _ = db;

        Assert.Contains("organisation", BadRequest(await controller.Quote(Request(new[] { Community() }, Mon12Oct, Mon12Oct), CancellationToken.None)));
        Assert.Contains("organisation", BadRequest(await controller.GetSettings(CancellationToken.None)));
        Assert.Contains("organisation", BadRequest(await controller.PutSettings(new UpdatePlanPricingSettingsDto { CrossingPolicy = CrossingPolicy.HigherOf }, CancellationToken.None)));
    }

    // ── The quote ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_quote_prices_the_brief_example_from_the_stored_catalogue()
    {
        var (db, controller) = await SetUpAsync(TenantA);
        await using var _ = db;
        var weekdays = new PlanBlock { Id = "mon-wed", SupportType = PlanSupportType.CommunityAccess, Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday }, Start = T(9), End = T(13), Location = new PlanLocation { State = "NSW" } };
        var saturday = new PlanBlock { Id = "sat", SupportType = PlanSupportType.GroupActivity, Days = new[] { DayOfWeek.Saturday }, Start = T(9), End = T(15), ParticipantsPresent = 3, Location = new PlanLocation { State = "NSW" } };

        var quote = Ok(await controller.Quote(Request(new[] { weekdays, saturday }, Mon12Oct, Sun18Oct), CancellationToken.None));

        Assert.Equal(new[] { ("04_104_0125_6_1", 294.32m), ("04_104_0125_6_1", 294.32m), ("04_104_0136_6_1", 207.06m) }, quote.Lines.Select(l => (l.ItemCode!, l.Total)));
        Assert.Equal(795.70m, quote.Totals.Amount);
        Assert.Contains(quote.Notices, n => n.Code == "registration-groups-not-confirmed");   // nothing stored yet: the defaults, unconfirmed
    }

    [Fact]
    public async Task The_quote_uses_the_callers_own_tenants_settings_and_never_another_tenants()
    {
        var name = Guid.NewGuid().ToString();
        var (dbA, controllerA) = await SetUpAsync(TenantA, dbName: name);
        var (dbB, controllerB) = await SetUpAsync(TenantB, dbName: name);
        await using var _a = dbA;
        await using var _b = dbB;
        // Tenant B does not hold community access (0125) and has said so; tenant A has stored nothing.
        dbB.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantB, RegistrationGroupsHeld = "0107,0104", RegistrationGroupsConfirmed = true });
        await dbB.SaveChangesAsync();
        var request = Request(new[] { Community() }, Mon12Oct, Mon12Oct);

        var forA = Ok(await controllerA.Quote(request, CancellationToken.None));
        var forB = Ok(await controllerB.Quote(request, CancellationToken.None));

        Assert.Equal(294.32m, forA.Totals.Amount);
        Assert.Empty(forB.Lines);
        Assert.Equal(PlanFailureReason.RegistrationGroupNotHeld, Assert.Single(forB.Issues).Reason);
        Assert.Empty(forB.Notices);   // confirmed
    }

    [Fact]
    public async Task The_crossing_policy_and_the_travel_rates_of_the_tenants_settings_are_applied()
    {
        var (db, controller) = await SetUpAsync(TenantA);
        await using var _ = db;
        db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, CrossingPolicy = CrossingPolicy.HigherOf, TravelKmRateStandard = 1.10m, TravelRatesProvisional = false });
        await db.SaveChangesAsync();
        var block = Block("p", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(18), T(22), b => b with { Travel = new PlanProviderTravel { Claim = true, KmEachWay = 10m } });

        var quote = Ok(await controller.Quote(Request(new[] { block }, Mon12Oct, Mon12Oct), CancellationToken.None));

        Assert.Equal(("01_015_0107_1_1", 4m, 324.28m), (quote.Lines[0].ItemCode!, quote.Lines[0].Qty, quote.Lines[0].Total));   // policy B
        var km = quote.Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelCosts);
        Assert.Equal((11.00m, false), (km.Total, km.Provisional));   // 10 km one way at 1.10, rates no longer provisional
    }

    [Fact]
    public async Task Holidays_come_from_the_synced_rows_and_the_override_rows_together()
    {
        var (db, controller) = await SetUpAsync(TenantA);
        await using var _ = db;
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = Mon5Oct, Name = "Labour Day", State = "NSW" });
        await db.SaveChangesAsync();
        var monday = Community("monday");
        var boxingDay = Block("boxing", PlanSupportType.CommunityAccess, DayOfWeek.Saturday, T(9), T(13), b => b with { OnPublicHoliday = HolidayDecision.Charge });

        var quote = Ok(await controller.Quote(Request(new[] { monday, boxingDay }, Mon5Oct, new DateOnly(2026, 12, 27)), CancellationToken.None));

        Assert.Equal("Labour Day", Assert.Single(quote.HolidayOccurrences, h => h.BlockId == "monday" && h.Date == Mon5Oct).HolidayName);      // the feed
        Assert.Equal("Boxing Day", Assert.Single(quote.HolidayOccurrences, h => h.BlockId == "boxing").HolidayName);                          // the seeded override, Saturday 26 December 2026
        Assert.Equal(163.46m * 4, quote.Lines.Single(l => l.BlockId == "boxing" && l.ServiceDate == new DateOnly(2026, 12, 26)).Total);
    }

    [Fact]
    public async Task A_part_day_override_is_read_with_its_hours()
    {
        var (db, controller) = await SetUpAsync(TenantA);
        await using var _ = db;
        var block = Block("sa", PlanSupportType.CommunityAccess, DayOfWeek.Thursday, T(18), T(22), b => b with { Location = new PlanLocation { State = "SA" }, OnPublicHoliday = HolidayDecision.Charge });

        var quote = Ok(await controller.Quote(Request(new[] { block }, new DateOnly(2026, 12, 24), new DateOnly(2026, 12, 24)), CancellationToken.None));

        // SA: Christmas Eve is the public holiday rate from 19:00 (the seeded part-day row).
        Assert.Equal(new[] { ("04_104_0125_6_1", 1m), ("04_102_0125_6_1", 3m) }, quote.Lines.Select(l => (l.ItemCode!, l.Qty)));
    }

    [Fact]
    public async Task The_quote_can_leave_the_lines_out_and_keep_the_totals_issues_and_holidays()
    {
        var (db, controller) = await SetUpAsync(TenantA);
        await using var _ = db;

        var quote = Ok(await controller.Quote(Request(new[] { Community() }, Mon12Oct, Mon12Oct.AddDays(14), includeLines: false), CancellationToken.None));

        Assert.Empty(quote.Lines);
        Assert.Equal(3 * 294.32m, quote.Totals.Amount);
        Assert.Equal(3, quote.Totals.LineCount);
    }

    [Fact]
    public async Task A_request_the_endpoint_cannot_price_is_refused_with_the_reason()
    {
        var (db, controller) = await SetUpAsync(TenantA);
        await using var _ = db;
        var blocks = new[] { Community() };

        Assert.Contains("blocks", BadRequest(await controller.Quote(new PlanQuoteRequestDto { Blocks = null, PeriodFrom = Mon12Oct, PeriodTo = Mon12Oct }, CancellationToken.None)));
        Assert.Contains("ends before", BadRequest(await controller.Quote(Request(blocks, Mon12Oct, Mon12Oct.AddDays(-1)), CancellationToken.None)));
        Assert.Contains("longer than", BadRequest(await controller.Quote(Request(blocks, Mon12Oct, Mon12Oct.AddDays(PlanPricingEngine.MaxPeriodDays)), CancellationToken.None)));
        Assert.Contains("at most", BadRequest(await controller.Quote(Request(Enumerable.Range(0, PlanPricingEngine.MaxBlocks + 1).Select(i => Community($"b{i}")), Mon12Oct, Mon12Oct), CancellationToken.None)));
    }

    [Fact]
    public async Task A_block_with_a_mistake_is_reported_in_the_quote_not_as_a_server_error()
    {
        var (db, controller) = await SetUpAsync(TenantA);
        await using var _ = db;
        var bad = Community("bad") with { Workers = 0 };

        var quote = Ok(await controller.Quote(Request(new[] { Community(), bad }, Mon12Oct, Mon12Oct), CancellationToken.None));

        Assert.Equal(new[] { "c" }, quote.Lines.Select(l => l.BlockId));
        Assert.Equal(PlanFailureReason.InvalidInput, Assert.Single(quote.Issues).Reason);
    }

    [Fact]
    public async Task The_quote_travels_as_the_JSON_the_API_sends_names_for_enums_and_whole_dates()
    {
        var (db, controller) = await SetUpAsync(TenantA);
        await using var _ = db;
        var quote = Ok(await controller.Quote(Request(new[] { Community() }, Mon5Oct, Mon5Oct), CancellationToken.None));
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);

        var json = JsonSerializer.Serialize(quote, options);
        using var document = JsonDocument.Parse(json);
        var line = document.RootElement.GetProperty("lines")[0];

        Assert.Equal("Support", line.GetProperty("kind").GetString());
        Assert.Equal("2026-10-05", line.GetProperty("serviceDate").GetString());
        Assert.Equal("09:00:00", line.GetProperty("startTime").GetString());
        Assert.Equal("04_104_0125_6_1", line.GetProperty("itemCode").GetString());
        Assert.Equal("Weekday Daytime", line.GetProperty("band").GetString());
        Assert.Contains("catalogue 2026-27", line.GetProperty("trace").GetProperty("why").GetString());
        Assert.False(document.RootElement.GetProperty("needsReview").GetBoolean());
    }

    // ── The settings ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Settings_before_anything_is_stored_are_the_owner_approved_defaults_and_say_so()
    {
        var (db, controller) = await SetUpAsync(TenantA);
        await using var _ = db;

        var settings = Ok(await controller.GetSettings(CancellationToken.None));

        Assert.True(settings.IsDefault);
        Assert.Equal(new[] { "0107", "0104", "0125", "0136", "0115", "0108" }, settings.RegistrationGroupsHeld);
        Assert.Equal((false, CrossingPolicy.Split, true, 0.99m, 2.76m, true), (settings.RegistrationGroupsConfirmed, settings.CrossingPolicy, settings.ClaimProviderTravel, settings.TravelKmRateStandard, settings.TravelKmRateAccessible, settings.TravelRatesProvisional));
        Assert.Equal((GroupOutingFamily.GroupActivities, true), (settings.GroupOutings, settings.StaUsesHourlyAndAccommodation));
        Assert.Equal(new[] { "Admin", "Coordinator" }, settings.ApproverRoles);
    }

    [Fact]
    public async Task A_put_changes_only_what_it_carries_and_setting_the_registration_groups_confirms_them()
    {
        var (db, controller) = await SetUpAsync(TenantA);
        await using var _ = db;

        var first = Ok(await controller.PutSettings(new UpdatePlanPricingSettingsDto { RegistrationGroupsHeld = new List<string> { "0107", "0125" } }, CancellationToken.None));
        var second = Ok(await controller.PutSettings(new UpdatePlanPricingSettingsDto { CrossingPolicy = CrossingPolicy.HigherOf, TravelKmRateStandard = 1.05m }, CancellationToken.None));

        Assert.Equal(new[] { "0107", "0125" }, first.RegistrationGroupsHeld);
        Assert.Equal((true, false), (first.RegistrationGroupsConfirmed, first.IsDefault));
        Assert.Equal(new[] { "0107", "0125" }, second.RegistrationGroupsHeld);                                   // untouched by the second put
        Assert.Equal((CrossingPolicy.HigherOf, 1.05m, true), (second.CrossingPolicy, second.TravelKmRateStandard, second.RegistrationGroupsConfirmed));
        Assert.Equal(1, await db.PlanPricingSettings.CountAsync());
        Assert.Equal(TenantA, (await db.PlanPricingSettings.SingleAsync()).TenantId);
    }

    [Fact]
    public async Task The_registration_groups_can_be_confirmed_as_they_are_and_unconfirmed_again()
    {
        var (db, controller) = await SetUpAsync(TenantA);
        await using var _ = db;

        var confirmed = Ok(await controller.PutSettings(new UpdatePlanPricingSettingsDto { RegistrationGroupsConfirmed = true }, CancellationToken.None));
        var explicitFalse = Ok(await controller.PutSettings(new UpdatePlanPricingSettingsDto { RegistrationGroupsHeld = new List<string> { "0125" }, RegistrationGroupsConfirmed = false }, CancellationToken.None));

        Assert.Equal((true, 6), (confirmed.RegistrationGroupsConfirmed, confirmed.RegistrationGroupsHeld.Count));
        Assert.Equal((false, 1), (explicitFalse.RegistrationGroupsConfirmed, explicitFalse.RegistrationGroupsHeld.Count));
    }

    [Theory]
    [InlineData("groups", "registration group")]
    [InlineData("noroles", "approver")]
    [InlineData("badrole", "approver")]
    [InlineData("negativerate", "rate")]
    [InlineData("hugerate", "rate")]
    [InlineData("crossing", "crossing")]
    [InlineData("outings", "group outing")]
    public async Task A_put_that_breaks_a_rule_is_refused_before_anything_is_written(string which, string expected)
    {
        var (db, controller) = await SetUpAsync(TenantA);
        await using var _ = db;
        var dto = which switch
        {
            "groups" => new UpdatePlanPricingSettingsDto { RegistrationGroupsHeld = new List<string> { "0107", "9999" } },
            "noroles" => new UpdatePlanPricingSettingsDto { ApproverRoles = new List<string>() },
            "badrole" => new UpdatePlanPricingSettingsDto { ApproverRoles = new List<string> { "Admin", "Staff" } },
            "negativerate" => new UpdatePlanPricingSettingsDto { TravelKmRateStandard = -0.01m },
            "hugerate" => new UpdatePlanPricingSettingsDto { TravelKmRateAccessible = 51m },
            "crossing" => new UpdatePlanPricingSettingsDto { CrossingPolicy = (CrossingPolicy)7 },
            _ => new UpdatePlanPricingSettingsDto { GroupOutings = (GroupOutingFamily)7 },
        };

        var message = BadRequest(await controller.PutSettings(dto, CancellationToken.None));

        Assert.Contains(expected, message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, await db.PlanPricingSettings.CountAsync());
    }

    [Fact]
    public async Task One_tenants_settings_are_never_read_or_changed_by_another()
    {
        var name = Guid.NewGuid().ToString();
        var (dbA, controllerA) = await SetUpAsync(TenantA, dbName: name);
        var (dbB, controllerB) = await SetUpAsync(TenantB, dbName: name);
        await using var _a = dbA;
        await using var _b = dbB;
        await controllerB.PutSettings(new UpdatePlanPricingSettingsDto { CrossingPolicy = CrossingPolicy.HigherOf, RegistrationGroupsHeld = new List<string> { "0107" } }, CancellationToken.None);

        var seenByA = Ok(await controllerA.GetSettings(CancellationToken.None));
        await controllerA.PutSettings(new UpdatePlanPricingSettingsDto { TravelKmRateStandard = 1.20m }, CancellationToken.None);
        var seenByB = Ok(await controllerB.GetSettings(CancellationToken.None));

        Assert.True(seenByA.IsDefault);
        Assert.Equal(CrossingPolicy.Split, seenByA.CrossingPolicy);
        Assert.Equal((CrossingPolicy.HigherOf, 0.99m), (seenByB.CrossingPolicy, seenByB.TravelKmRateStandard));
        Assert.Equal(2, await dbB.PlanPricingSettings.IgnoreQueryFilters().CountAsync());
    }
}
