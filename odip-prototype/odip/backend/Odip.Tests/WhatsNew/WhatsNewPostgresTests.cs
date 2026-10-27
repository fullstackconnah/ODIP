using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.WhatsNew;

/// <summary>What EF InMemory cannot show about What's new: the migration's indexes, the seeder's unique-key race, the first-mark race, the bitwise role filter and the cascade. Server only.</summary>
public class WhatsNewPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public WhatsNewPostgresTests(PostgresFixture pg) => _pg = pg;

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

    private static OdipDbContext WithInterceptor(string cs, SaveChangesInterceptor interceptor)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(cs).AddInterceptors(interceptor).Options, tenant.Object);
    }

    private static WhatsNewFeedDto Feed(ActionResult<ApiResponse<WhatsNewFeedDto>> r) =>
        Assert.IsType<ApiResponse<WhatsNewFeedDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;

    private static async Task<Guid> AddUserAsync(string cs, UserRole role = UserRole.SupportWorker)
    {
        var tenantId = Guid.NewGuid();
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Turner", Username = Guid.NewGuid().ToString(),
            Email = $"{Guid.NewGuid()}@example.com", Role = role, IsActive = true,
        };
        await using var db = PostgresFixture.NewContext(cs);
        db.Tenants.Add(new Tenant { Id = tenantId, Name = "Test Provider", EmailDomain = $"{tenantId:N}.example.com" });
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private static T WithCaller<T>(T controller, Guid userId, string role) where T : ControllerBase
    {
        var identity = new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Role, role) }, "Test");
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } };
        return controller;
    }

    [SkippableFact]
    public async Task P1_TheMigration_MakesBothTables_WithTheUniqueIndexes()
    {
        RequirePostgres();
        var cs = await FreshDatabaseAsync();
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        foreach (var (table, index) in new[] { ("WhatsNewEntries", "IX_WhatsNewEntries_Key"), ("WhatsNewUserStates", "IX_WhatsNewUserStates_UserId") })
        {
            await using var cmd = new NpgsqlCommand("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = @t AND indexname = @i", conn);
            cmd.Parameters.AddWithValue("t", table);
            cmd.Parameters.AddWithValue("i", index);
            Assert.Contains("UNIQUE", (string?)await cmd.ExecuteScalarAsync());
        }
    }

    [SkippableFact]
    public async Task P2_SeedingTwice_GivesOneRowPerKey()
    {
        RequirePostgres();
        var cs = await FreshDatabaseAsync();
        for (var i = 0; i < 2; i++)
        {
            await using var db = PostgresFixture.NewContext(cs);
            await WhatsNewSeed.SeedWhatsNewAsync(db, DateTime.UtcNow);
        }
        await using var check = PostgresFixture.NewContext(cs);
        Assert.Equal(WhatsNewSeed.All.Count, await check.WhatsNewEntries.CountAsync());
    }

    [SkippableFact]
    public async Task P2b_ALostKeyRace_IsSkipped_AndTheOtherKeysAreInserted()
    {
        RequirePostgres();
        var cs = await FreshDatabaseAsync();
        var first = WhatsNewSeed.All[0];
        var rival = new OnFirstSave(async () =>
        {
            await using var other = PostgresFixture.NewContext(cs);
            other.WhatsNewEntries.Add(new WhatsNewEntry { Id = Guid.NewGuid(), Key = first.Key, Title = "Rival", Body = "Rival", Roles = WhatsNewAudience.All, PublishedAtUtc = DateTime.UtcNow, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
            await other.SaveChangesAsync();
        });
        await using (var db = WithInterceptor(cs, rival)) await WhatsNewSeed.SeedWhatsNewAsync(db, DateTime.UtcNow);

        await using var check = PostgresFixture.NewContext(cs);
        Assert.Equal(WhatsNewSeed.All.Count, await check.WhatsNewEntries.CountAsync());
        Assert.Equal("Rival", (await check.WhatsNewEntries.SingleAsync(e => e.Key == first.Key)).Title);
    }

    [SkippableFact]
    public async Task P3_TheSeederNeverOverwritesAnEdit()
    {
        RequirePostgres();
        var cs = await FreshDatabaseAsync();
        await using (var db = PostgresFixture.NewContext(cs)) await WhatsNewSeed.SeedWhatsNewAsync(db, DateTime.UtcNow);
        await using (var edit = PostgresFixture.NewContext(cs))
        {
            var rows = await edit.WhatsNewEntries.OrderBy(e => e.Key).ToListAsync();
            rows[0].Title = "Edited by an admin";
            rows[1].ArchivedAtUtc = DateTime.UtcNow;
            await edit.SaveChangesAsync();
        }
        await using (var db = PostgresFixture.NewContext(cs)) await WhatsNewSeed.SeedWhatsNewAsync(db, DateTime.UtcNow);

        await using var check = PostgresFixture.NewContext(cs);
        var after = await check.WhatsNewEntries.OrderBy(e => e.Key).ToListAsync();
        Assert.Equal("Edited by an admin", after[0].Title);
        Assert.NotNull(after[1].ArchivedAtUtc);
    }

    [SkippableFact]
    public async Task P4_AfterOneSeed_TheFeedIsNewestFirst_InTheReverseOfAll_AndP6_TheRoleFilterTranslates()
    {
        RequirePostgres();
        var cs = await FreshDatabaseAsync();
        await using (var db = PostgresFixture.NewContext(cs)) await WhatsNewSeed.SeedWhatsNewAsync(db, DateTime.UtcNow);
        var userId = await AddUserAsync(cs, UserRole.Admin);

        await using var read = PostgresFixture.NewContext(cs);
        var feed = Feed(await WithCaller(new WhatsNewController(read), userId, "Admin").GetFeed(CancellationToken.None));
        Assert.Equal(WhatsNewSeed.All.Where(i => (i.Roles & WhatsNewAudience.Admin) != 0).Select(i => i.Title).Reverse(), feed.Entries.Select(e => e.Title)); // the Admin sees every entry whose audience includes Admin; a SupportWorker-only entry is not theirs

        // A role none of the Admin/Coordinator-only entries targets still gets the entries for everyone, via a bitwise filter; derived from the seed so new All entries do not break it.
        var audience = WhatsNewAudience.SupportWorker;
        var sql = read.WhatsNewEntries.Where(e => (e.Roles & audience) != 0).ToQueryString();
        Assert.Contains("&", sql);
        var support = Feed(await WithCaller(new WhatsNewController(read), userId, "SupportWorker").GetFeed(CancellationToken.None));
        var expected = WhatsNewSeed.All.Where(i => (i.Roles & audience) != 0).Select(i => i.Title).Reverse().ToList();
        Assert.NotEmpty(expected);
        Assert.True(expected.Count < WhatsNewSeed.All.Count, "the role filter must exclude the Admin-only entries");
        Assert.Equal(expected, support.Entries.Select(e => e.Title));
    }

    [SkippableFact]
    public async Task P5_AFirstMarkRace_EndsInOneStateRow_WithTheCallersWrite()
    {
        RequirePostgres();
        var cs = await FreshDatabaseAsync();
        var userId = await AddUserAsync(cs);
        var rival = new OnFirstSave(async () =>
        {
            await using var other = PostgresFixture.NewContext(cs);
            other.WhatsNewUserStates.Add(new WhatsNewUserState { Id = Guid.NewGuid(), UserId = userId, PopupSeenThroughUtc = DateTime.UtcNow.AddDays(-1) });
            await other.SaveChangesAsync();
        });

        await using (var db = WithInterceptor(cs, rival))
        {
            var result = await WithCaller(new WhatsNewController(db), userId, "SupportWorker").Seen(CancellationToken.None);
            Assert.IsType<OkObjectResult>(result.Result);
        }

        await using var check = PostgresFixture.NewContext(cs);
        var state = await check.WhatsNewUserStates.SingleAsync(s => s.UserId == userId);
        Assert.NotNull(state.LastSeenAtUtc);
        Assert.NotNull(state.PopupSeenThroughUtc);
    }

    [SkippableFact]
    public async Task P7_DeletingAUser_RemovesItsState()
    {
        RequirePostgres();
        var cs = await FreshDatabaseAsync();
        var userId = await AddUserAsync(cs);
        await using (var db = PostgresFixture.NewContext(cs))
        {
            db.WhatsNewUserStates.Add(new WhatsNewUserState { Id = Guid.NewGuid(), UserId = userId, LastSeenAtUtc = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }
        await using (var db = PostgresFixture.NewContext(cs))
        {
            db.Users.Remove(await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == userId));
            await db.SaveChangesAsync();
        }
        await using var check = PostgresFixture.NewContext(cs);
        Assert.False(await check.WhatsNewUserStates.AnyAsync(s => s.UserId == userId));
    }
}
