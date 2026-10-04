using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using System.Security.Claims;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The organisation-wide half of the budget API: the NDIS support category list the screens read (they keep no copy) and the budget settings (the mode and the
/// "approaching" percentage), which mirror the plan pricing settings exactly: defaults when there is no row, each setting changes only when the request carries it,
/// everything is validated before anything is written, one audit row per change, a lost first-PUT race is retried on the row that won, and one organisation never
/// reads or changes another's.
/// </summary>
public class FundingControllerTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-00000000000b");
    private static readonly Guid AdminId = Guid.Parse("dddddddd-0000-0000-0000-0000000000ad");

    private static ClaimsPrincipal Admin() => new(new ClaimsIdentity(
        new[] { new Claim(ClaimTypes.NameIdentifier, AdminId.ToString()), new Claim("fullName", "Ada Admin"), new Claim(ClaimTypes.Role, "Admin") }, "Test"));

    private static (OdipDbContext Db, FundingController Controller) Create(Guid? tenantId, bool isSuperAdmin = false, string? database = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(isSuperAdmin);
        var principal = Admin();
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = principal });
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(database ?? Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;
        var db = new OdipDbContext(options, tenant.Object);
        return (db, new FundingController(db, tenant.Object) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } } });
    }

    private static T Ok<T>(ActionResult<ApiResponse<T>> result) =>
        Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static string BadRequest<T>(ActionResult<ApiResponse<T>> result) =>
        Assert.Single(Assert.IsType<ApiResponse<T>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors!);

    // ── The support categories ──────────────────────────────────────────────

    [Fact]
    public void PaceCategories_AreAll21InNumberOrder_WithTheirBudgetAndWhetherAStatedPoolMayBeOffered()
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;

        var categories = Ok(controller.PaceCategories());

        Assert.Equal(Enumerable.Range(1, 21), categories.Select(c => c.Number));
        Assert.Equal(new[] { 1, 2, 3, 4 }, categories.Where(c => !c.OfferedAsStatedPool && c.Budget == PaceBudget.Core && c.Number <= 4).Select(c => c.Number));
        Assert.False(categories.Single(c => c.Number == 18).OfferedAsStatedPool);   // listed, never offered: paid to the participant
        Assert.Equal(new[] { 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21 }, categories.Where(c => c.OfferedAsStatedPool).Select(c => c.Number));
        Assert.Equal(new[] { 1, 2, 3, 4, 16, 21 }, categories.Where(c => c.Budget == PaceBudget.Core).Select(c => c.Number));
        Assert.Equal(new[] { 7, 8, 9, 10, 11, 12, 13, 14, 15, 20 }, categories.Where(c => c.Budget == PaceBudget.CapacityBuilding).Select(c => c.Number));
        Assert.Equal(new[] { 5, 6, 17, 19 }, categories.Where(c => c.Budget == PaceBudget.Capital).Select(c => c.Number));
        Assert.Equal(new[] { 18 }, categories.Where(c => c.Budget == PaceBudget.Recurring).Select(c => c.Number));
        Assert.Equal("Assistance with Social, Economic and Community Participation", categories.Single(c => c.Number == 4).Name);
        Assert.Equal("Assistive Technology Maintenance, Repair and Rental", categories.Single(c => c.Number == 19).Name);
        Assert.Equal("Support Coordination and Psychosocial Recovery Coaches", categories.Single(c => c.Number == 7).Name);
        Assert.All(categories.Where(c => c.Number <= 4), c => Assert.True(c.Flexible));
        Assert.All(categories.Where(c => c.OfferedAsStatedPool), c => Assert.False(c.Flexible));
    }

    [Fact]
    public void PaceCategories_ServeBudgetsAsStrings_SoTheScreenNeverMapsANumber()
    {
        var json = JsonSerializer.Serialize(new PaceCategoryDto { Number = 15, Name = "Improved Daily Living Skills", Budget = PaceBudget.CapacityBuilding, OfferedAsStatedPool = true },
            WireOptions());

        Assert.Contains("\"budget\":\"CapacityBuilding\"", json);
        Assert.Contains("\"offeredAsStatedPool\":true", json);
    }

    private static JsonSerializerOptions WireOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        return options;
    }

    // ── The settings ────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_WithNoRow_IsTheDefaults_Warn_And80Percent_AndSaysSo()
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;

        var settings = Ok(await controller.GetSettings(CancellationToken.None));

        Assert.Equal((BudgetLimitMode.Warn, 80, true), (settings.Mode, settings.ApproachingPercent, settings.IsDefault));
        Assert.Empty(db.BudgetSettings);   // reading never writes
    }

    [Fact]
    public void TheDefaultsOfTheEntityAreTheDefaultsOfTheSettings_AndTheModeValuesAreFrozen()
    {
        var row = new BudgetSettings();

        Assert.Equal((BudgetLimitMode.Warn, 80), (row.Mode, row.ApproachingPercent));
        // Persisted integers: never renumber.
        Assert.Equal(0, (int)BudgetLimitMode.Warn);
        Assert.Equal(1, (int)BudgetLimitMode.HardLimit);
        Assert.Equal(new[] { 0, 1, 2, 3, 4 }, Enum.GetValues<BudgetEvidenceSource>().Select(v => (int)v));
        Assert.Equal(new[] { 0, 1 }, Enum.GetValues<FundingPoolKind>().Select(v => (int)v));
    }

    [Fact]
    public async Task Put_ChangesOnlyTheSettingsTheRequestCarries()
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;

        var first = Ok(await controller.PutSettings(new UpdateBudgetSettingsDto { Mode = BudgetLimitMode.HardLimit }, CancellationToken.None));
        Assert.Equal((BudgetLimitMode.HardLimit, 80, false), (first.Mode, first.ApproachingPercent, first.IsDefault));

        var second = Ok(await controller.PutSettings(new UpdateBudgetSettingsDto { ApproachingPercent = 65 }, CancellationToken.None));
        Assert.Equal((BudgetLimitMode.HardLimit, 65), (second.Mode, second.ApproachingPercent));   // the mode was not sent, so it was not touched

        var third = Ok(await controller.PutSettings(new UpdateBudgetSettingsDto(), CancellationToken.None));
        Assert.Equal((BudgetLimitMode.HardLimit, 65), (third.Mode, third.ApproachingPercent));

        Assert.Equal(1, await db.BudgetSettings.CountAsync());
    }

    [Theory]
    [InlineData(50)]
    [InlineData(55)]
    [InlineData(80)]
    [InlineData(95)]
    public async Task Put_AcceptsEveryPercentageFrom50To95InStepsOfFive(int percent)
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;

        Assert.Equal(percent, Ok(await controller.PutSettings(new UpdateBudgetSettingsDto { ApproachingPercent = percent }, CancellationToken.None)).ApproachingPercent);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(45)]
    [InlineData(49)]
    [InlineData(52)]
    [InlineData(96)]
    [InlineData(100)]
    [InlineData(-80)]
    public async Task Put_RefusesAPercentageOutsideTheRangeOrOffTheStep_AndWritesNothing(int percent)
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;

        var message = BadRequest(await controller.PutSettings(new UpdateBudgetSettingsDto { ApproachingPercent = percent, Mode = BudgetLimitMode.HardLimit }, CancellationToken.None));

        Assert.Contains("50 to 95", message, StringComparison.Ordinal);
        Assert.Contains("steps of 5", message, StringComparison.Ordinal);
        Assert.Empty(db.BudgetSettings);      // validation first: the valid mode in the same request was not applied
        Assert.Empty(db.AuditLogs);
    }

    [Fact]
    public async Task Put_RefusesAModeThatIsNotOneOfTheTwo()
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;

        var message = BadRequest(await controller.PutSettings(new UpdateBudgetSettingsDto { Mode = (BudgetLimitMode)7 }, CancellationToken.None));

        Assert.Contains("Warn or HardLimit", message, StringComparison.Ordinal);
        Assert.Empty(db.BudgetSettings);
    }

    [Fact]
    public async Task Put_WritesOneAuditRowForTheChange_NamingTheFieldsThatChanged_AndNoneWhenNothingChanges()
    {
        var (db, controller) = Create(TenantA);
        using var _ = db;
        await controller.PutSettings(new UpdateBudgetSettingsDto { Mode = BudgetLimitMode.HardLimit, ApproachingPercent = 90 }, CancellationToken.None);
        db.AuditLogs.RemoveRange(db.AuditLogs.ToList());
        await db.SaveChangesAsync();

        await controller.PutSettings(new UpdateBudgetSettingsDto { Mode = BudgetLimitMode.Warn }, CancellationToken.None);
        var one = Assert.Single(await db.AuditLogs.ToListAsync());
        Assert.Equal((nameof(BudgetSettings), AuditAction.Updated, AdminId), (one.EntityType, one.Action, one.ChangedById));
        Assert.Contains("Mode", one.Changes, StringComparison.Ordinal);
        Assert.DoesNotContain("ApproachingPercent", one.Changes, StringComparison.Ordinal);

        db.AuditLogs.RemoveRange(db.AuditLogs.ToList());
        await db.SaveChangesAsync();
        await controller.PutSettings(new UpdateBudgetSettingsDto { Mode = BudgetLimitMode.Warn, ApproachingPercent = 90 }, CancellationToken.None);   // the same values again
        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task OneOrganisationsSettings_AreNeverReadOrChangedByAnother()
    {
        var database = Guid.NewGuid().ToString();
        var (dbA, a) = Create(TenantA, database: database);
        var (dbB, b) = Create(TenantB, database: database);
        using var _a = dbA;
        using var _b = dbB;

        await a.PutSettings(new UpdateBudgetSettingsDto { Mode = BudgetLimitMode.HardLimit, ApproachingPercent = 95 }, CancellationToken.None);

        var theirs = Ok(await b.GetSettings(CancellationToken.None));
        Assert.Equal((BudgetLimitMode.Warn, 80, true), (theirs.Mode, theirs.ApproachingPercent, theirs.IsDefault));
        await b.PutSettings(new UpdateBudgetSettingsDto { ApproachingPercent = 60 }, CancellationToken.None);
        var mine = Ok(await a.GetSettings(CancellationToken.None));
        Assert.Equal((BudgetLimitMode.HardLimit, 95), (mine.Mode, mine.ApproachingPercent));
    }

    [Fact]
    public async Task ASuperAdminWhoHasNotChosenAnOrganisation_IsRefusedOnBothSettingsCalls()
    {
        var (db, controller) = Create(null, isSuperAdmin: true);
        using var _ = db;

        Assert.Contains("Choose an organisation", BadRequest(await controller.GetSettings(CancellationToken.None)), StringComparison.Ordinal);
        Assert.Contains("Choose an organisation", BadRequest(await controller.PutSettings(new UpdateBudgetSettingsDto { Mode = BudgetLimitMode.HardLimit }, CancellationToken.None)), StringComparison.Ordinal);
        Assert.Empty(db.BudgetSettings);
    }

    // ── Two first PUTs for one tenant at once ───────────────────────────────

    /// <summary>
    /// Stands in for the unique index on TenantId, which the in-memory provider does not enforce: the first time a save adds a settings row it fails the way Postgres
    /// fails it (a DbUpdateException), and, when asked to, another request's first PUT has just written its row from a separate context.
    /// </summary>
    private sealed class FirstPutRace : SaveChangesInterceptor
    {
        private readonly string _database;
        private readonly ICurrentTenant _tenant;
        private readonly BudgetSettings? _winner;

        public FirstPutRace(string database, ICurrentTenant tenant, BudgetSettings? winner)
        {
            _database = database;
            _tenant = tenant;
            _winner = winner;
        }

        public bool Tripped { get; private set; }

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!Tripped && eventData.Context!.ChangeTracker.Entries<BudgetSettings>().Any(e => e.State == EntityState.Added))
            {
                Tripped = true;
                if (_winner is not null)
                {
                    await using var other = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(_database).Options, _tenant);
                    other.BudgetSettings.Add(_winner);
                    await other.SaveChangesAsync(cancellationToken);
                }

                throw new DbUpdateException("duplicate key value violates unique constraint \"IX_BudgetSettings_TenantId\"");
            }

            return await base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    private static (OdipDbContext Db, FundingController Controller, FirstPutRace Race) SetUpRace(BudgetSettings? winner)
    {
        var database = Guid.NewGuid().ToString();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantA);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var race = new FirstPutRace(database, tenant.Object, winner);
        // The audit interceptor is registered first, as in the app, so the failed save has already added its audit row when the race interceptor throws.
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(database)
            .AddInterceptors(new AuditInterceptor(Mock.Of<IHttpContextAccessor>()), race)
            .Options;
        var db = new OdipDbContext(options, tenant.Object);
        return (db, new FundingController(db, tenant.Object), race);
    }

    [Fact]
    public async Task TwoFirstPuts_ForOneOrganisation_BothSucceed_AndTheSecondIsAppliedOnTopOfTheFirst()
    {
        var (db, controller, race) = SetUpRace(new BudgetSettings { Id = Guid.NewGuid(), TenantId = TenantA, Mode = BudgetLimitMode.HardLimit });
        using var _ = db;

        var saved = Ok(await controller.PutSettings(new UpdateBudgetSettingsDto { ApproachingPercent = 70 }, CancellationToken.None));

        Assert.True(race.Tripped);
        Assert.Equal((BudgetLimitMode.HardLimit, 70, false), (saved.Mode, saved.ApproachingPercent, saved.IsDefault));   // the winner's choice and this one
        Assert.Equal(1, await db.BudgetSettings.CountAsync());
        // The failed insert must not leave its audit row behind: the one audit row is the update that landed.
        Assert.Equal(AuditAction.Updated, Assert.Single(await db.AuditLogs.ToListAsync()).Action);
    }

    [Fact]
    public async Task AFailedFirstSave_ThatWasNotARace_IsNotSwallowed()
    {
        var (db, controller, _) = SetUpRace(winner: null);   // nobody else wrote a row, so the failure is something else
        using var _ = db;

        await Assert.ThrowsAsync<DbUpdateException>(() => controller.PutSettings(new UpdateBudgetSettingsDto { Mode = BudgetLimitMode.HardLimit }, CancellationToken.None));
    }
}
