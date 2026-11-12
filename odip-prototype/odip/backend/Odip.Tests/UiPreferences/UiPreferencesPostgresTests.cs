using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
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

namespace Odip.Tests.UiPreferences;

/// <summary>What EF InMemory cannot show about the saved itinerary view: the migration's unique index, the stored row, the first-save race and the cascade. Server only.</summary>
public class UiPreferencesPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public UiPreferencesPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    /// <summary>Runs one action on the first save only (the other save's connection is a different context).</summary>
    private sealed class OnFirstSave : SaveChangesInterceptor
    {
        private readonly Func<Task> _action;
        private bool _done;
        public OnFirstSave(Func<Task> action) => _action = action;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (_done) return result;
            _done = true;
            await _action();
            return result;
        }
    }

    private async Task<string> FreshDatabaseAsync()
    {
        var cs = await _pg.CreateDatabaseAsync();
        await using var migrate = PostgresFixture.NewContext(cs);
        await migrate.Database.MigrateAsync();
        return cs;
    }

    private static async Task<Guid> AddUserAsync(string cs)
    {
        var tenantId = Guid.NewGuid();
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Turner", Username = Guid.NewGuid().ToString(),
            Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, IsActive = true,
        };
        await using var db = PostgresFixture.NewContext(cs);
        db.Tenants.Add(new Tenant { Id = tenantId, Name = "Test Provider", EmailDomain = $"{tenantId:N}.example.com" });
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private static UiPreferencesController For(OdipDbContext db, Guid userId) => new(db)
    {
        ControllerContext = new()
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Role, "SupportWorker") }, "Test")),
            },
        },
    };

    private static string? View(ActionResult<ApiResponse<UiPreferencesDto>> r) =>
        Assert.IsType<ApiResponse<UiPreferencesDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!.ItineraryView;

    [SkippableFact]
    public async Task P1_ASavedChoice_IsStoredAndRead_AndTheUserIdIsUnique()
    {
        RequirePostgres();
        var cs = await FreshDatabaseAsync();
        var userId = await AddUserAsync(cs);
        await using (var db = PostgresFixture.NewContext(cs))
            Assert.Equal("list", View(await For(db, userId).Put(new UiPreferencesDto { ItineraryView = "list" }, CancellationToken.None)));
        await using (var db = PostgresFixture.NewContext(cs))
            Assert.Equal("list", View(await For(db, userId).Get(CancellationToken.None)));

        await using var dup = PostgresFixture.NewContext(cs);
        dup.UserUiPreferences.Add(new UserUiPreference { Id = Guid.NewGuid(), UserId = userId, ItineraryView = "days", UpdatedAt = DateTime.UtcNow });
        await Assert.ThrowsAsync<DbUpdateException>(() => dup.SaveChangesAsync());
    }

    [SkippableFact]
    public async Task P2_TwoFirstSaves_LeaveOneRow_AndTheLoserWins()
    {
        RequirePostgres();
        var cs = await FreshDatabaseAsync();
        var userId = await AddUserAsync(cs);
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var racer = new OnFirstSave(async () =>
        {
            await using var other = PostgresFixture.NewContext(cs);
            Assert.Equal("days", View(await For(other, userId).Put(new UiPreferencesDto { ItineraryView = "days" }, CancellationToken.None)));
        });
        await using (var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(cs).AddInterceptors(racer).Options, tenant.Object))
            Assert.Equal("list", View(await For(db, userId).Put(new UiPreferencesDto { ItineraryView = "list" }, CancellationToken.None)));

        await using var check = PostgresFixture.NewContext(cs);
        Assert.Equal("list", (await check.UserUiPreferences.SingleAsync(p => p.UserId == userId)).ItineraryView);
    }

    [SkippableFact]
    public async Task P3_DeletingAUser_RemovesItsChoices()
    {
        RequirePostgres();
        var cs = await FreshDatabaseAsync();
        var userId = await AddUserAsync(cs);
        await using (var db = PostgresFixture.NewContext(cs))
            await For(db, userId).Put(new UiPreferencesDto { ItineraryView = "list" }, CancellationToken.None);
        await using (var db = PostgresFixture.NewContext(cs))
        {
            db.Users.Remove(await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == userId));
            await db.SaveChangesAsync();
        }
        await using var check = PostgresFixture.NewContext(cs);
        Assert.False(await check.UserUiPreferences.AnyAsync(p => p.UserId == userId));
    }
}
