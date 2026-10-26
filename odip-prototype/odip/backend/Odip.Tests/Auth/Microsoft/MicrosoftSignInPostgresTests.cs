using Odip.Domain.Notifications;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Api.Services.Microsoft;
using Odip.Application.Common;
using Odip.Application.Interfaces;
using Odip.Infrastructure.Notifications;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Auth.Microsoft;

/// <summary>The Microsoft sign-in indexes and the callback against a real PostgreSQL (EF InMemory cannot see unique or filtered indexes).</summary>
public class MicrosoftSignInPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public MicrosoftSignInPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static User NewUser(Guid tenantId, Guid? tid = null, Guid? oid = null)
    {
        var n = Guid.NewGuid().ToString("N");
        return new User { Id = Guid.NewGuid(), TenantId = tenantId, Username = n, Email = n + "@example.test", FirstName = "A", LastName = "B", Role = UserRole.ReadOnly, MicrosoftTenantId = tid, MicrosoftObjectId = oid };
    }

    private async Task<Guid> NewTenantAsync()
    {
        var (db, id) = await _pg.NewTenantContextAsync();
        await db.DisposeAsync();
        return id;
    }

    [SkippableFact]
    public async Task UserIdentityIndex_UniqueWhenSet_ManyNullsAllowed()
    {
        RequirePostgres();
        var org = await NewTenantAsync();
        var (tid, oid) = (Guid.NewGuid(), Guid.NewGuid());
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);
        db.Users.AddRange(NewUser(org), NewUser(org), NewUser(org, tid, oid));
        await db.SaveChangesAsync();

        db.Users.Add(NewUser(org, tid, oid));
        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        var pg = Assert.IsType<PostgresException>(ex.InnerException);
        Assert.Equal(PostgresErrorCodes.UniqueViolation, pg.SqlState);
        Assert.Equal(User.MicrosoftIdentityIndexName, pg.ConstraintName);
    }

    [SkippableFact]
    public async Task LinkTid_UniqueAcrossOrgs()
    {
        RequirePostgres();
        var (a, b) = (await NewTenantAsync(), await NewTenantAsync());
        var tid = Guid.NewGuid();
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);
        db.MicrosoftTenantLinks.Add(new MicrosoftTenantLink { Id = Guid.NewGuid(), TenantId = a, MicrosoftTenantId = tid, LinkedByUserId = Guid.NewGuid() });
        await db.SaveChangesAsync();

        db.MicrosoftTenantLinks.Add(new MicrosoftTenantLink { Id = Guid.NewGuid(), TenantId = b, MicrosoftTenantId = tid, LinkedByUserId = Guid.NewGuid() });
        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(MicrosoftTenantLink.MicrosoftTenantIdIndexName, Assert.IsType<PostgresException>(ex.InnerException).ConstraintName);
    }

    [SkippableFact]
    public async Task Link_OnePerOrg()
    {
        RequirePostgres();
        var a = await NewTenantAsync();
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);
        db.MicrosoftTenantLinks.Add(new MicrosoftTenantLink { Id = Guid.NewGuid(), TenantId = a, MicrosoftTenantId = Guid.NewGuid(), LinkedByUserId = Guid.NewGuid() });
        await db.SaveChangesAsync();

        db.MicrosoftTenantLinks.Add(new MicrosoftTenantLink { Id = Guid.NewGuid(), TenantId = a, MicrosoftTenantId = Guid.NewGuid(), LinkedByUserId = Guid.NewGuid() });
        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(MicrosoftTenantLink.OrganisationIndexName, Assert.IsType<PostgresException>(ex.InnerException).ConstraintName);
    }
}

/// <summary>The callback and management endpoints driven through the rig on a real PostgreSQL.</summary>
public class MicrosoftSignInPostgresCallbackTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public MicrosoftSignInPostgresCallbackTests(PostgresFixture pg) => _pg = pg;

    private static readonly Guid Tid = MicrosoftTestTokens.OrgTid;

    /// <summary>Runs just before the first notification is raised, i.e. after the loser has read "no such user" and before it saves.</summary>
    private sealed class RacingRaiser(INotificationRaiser inner, Func<Task> rival) : INotificationRaiser
    {
        private bool _fired;
        public async Task RaiseAsync(NotificationEventType type, string entityType, Guid entityId, IEnumerable<Guid> recipientUserIds, object payload, CancellationToken ct = default, bool dedupe = true)
        {
            if (!_fired) { _fired = true; await rival(); }
            await inner.RaiseAsync(type, entityType, entityId, recipientUserIds, payload, ct, dedupe);
        }
    }

    private async Task<(MicrosoftAuthRig Rig, Guid Org, Guid Admin, string Cs)> SetupAsync()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync(); // own database: the tid, email and oid are unique across the whole table
        await using (var schema = PostgresFixture.NewContext(cs)) await schema.Database.EnsureCreatedAsync();
        var (tenantDb, org) = await _pg.NewTenantContextAsync(cs);
        await tenantDb.DisposeAsync();
        var rig = new MicrosoftAuthRig(() => PostgresFixture.NewContext(cs));
        var admin = rig.Person(org, "admin@acme.test", UserRole.Admin);
        rig.Link(org, role: UserRole.SupportWorker, by: admin.Id);
        return (rig, org, admin.Id, cs);
    }

    private static async Task<List<User>> UsersAsync(string cs)
    {
        await using var db = PostgresFixture.NewContext(cs);
        return await db.Users.ToListAsync();
    }

    private static async Task AddRivalAsync(string cs, Guid org, string email, Guid? tid, Guid? oid)
    {
        await using var db = PostgresFixture.NewContext(cs);
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(), TenantId = org, FirstName = "Rival", LastName = "Row", Username = Guid.NewGuid().ToString("N"), Email = email,
            Role = UserRole.SupportWorker, IsActive = true, MicrosoftTenantId = tid, MicrosoftObjectId = oid,
        });
        await db.SaveChangesAsync();
    }

    [SkippableFact]
    public async Task P6_FirstSignIn_OnPostgres_SavesUserAndNotification()
    {
        var (rig, org, admin, cs) = await SetupAsync();
        var o = await rig.RunAsync(MicrosoftAuthRig.Token());

        Assert.Equal(MicrosoftSignInPaths.SignInSuccess, o.Location);
        var created = Assert.Single(await UsersAsync(cs), u => u.MicrosoftObjectId == MicrosoftAuthRig.PersonOid);
        Assert.Equal((org, Tid, UserRole.SupportWorker), (created.TenantId, created.MicrosoftTenantId, created.Role));
        await using var db = PostgresFixture.NewContext(cs);
        Assert.Contains(await db.InAppNotifications.ToListAsync(), n => n.RecipientUserId == admin);
    }

    [SkippableFact]
    public async Task P4_FirstSignInRace_LoserSignsInWinnersRow_NothingRaisedByLoser()
    {
        var (rig, org, admin, cs) = await SetupAsync();
        rig.Raiser = new RacingRaiser(new NotificationRaiser(rig.Db), () => AddRivalAsync(cs, org, "pat@contoso.example", Tid, MicrosoftAuthRig.PersonOid));

        var o = await rig.RunAsync(MicrosoftAuthRig.Token());

        Assert.Equal(MicrosoftSignInPaths.SignInSuccess, o.Location);
        var winner = Assert.Single(await UsersAsync(cs), u => u.MicrosoftObjectId == MicrosoftAuthRig.PersonOid);
        Assert.Equal(winner.Id.ToString(), MicrosoftAuthRig.Jwt(o).Claims.First(c => c.Type.EndsWith("nameidentifier")).Value);
        await using var db = PostgresFixture.NewContext(cs);
        Assert.DoesNotContain(await db.InAppNotifications.ToListAsync(), n => n.RecipientUserId == admin);
    }

    [SkippableFact]
    public async Task P5_Race_SameEmailDifferentOid_MicrosoftLinkFromAccount()
    {
        var (rig, org, _, cs) = await SetupAsync();
        rig.Raiser = new RacingRaiser(new NotificationRaiser(rig.Db), () => AddRivalAsync(cs, org, "pat@contoso.example", null, null));

        var o = await rig.RunAsync(MicrosoftAuthRig.Token());

        Assert.Equal(MicrosoftRefusal.MicrosoftLinkFromAccount, o.Code);
        Assert.Null(o.Cookie("odip_jwt"));
        Assert.DoesNotContain(await UsersAsync(cs), u => u.MicrosoftObjectId == MicrosoftAuthRig.PersonOid);
    }

    [SkippableFact]
    public async Task P7_PutLink_UpdatedAtFromGet_SurvivesPostgresRoundTrip()
    {
        var (rig, org, admin, _) = await SetupAsync();
        rig.AmbientTenant = org;
        var asAdmin = rig.Controller(rig.Http(MicrosoftAuthRig.Signed(admin, org, UserRole.Admin)));
        var get = (ApiResponse<MicrosoftTenantLinkDto?>)((ObjectResult)await asAdmin.GetLink(default)).Value!;

        var put = await asAdmin.PutLink(new UpdateMicrosoftLinkDto("Coordinator", get.Data!.UpdatedAt), default);

        Assert.Equal(200, ((ObjectResult)put).StatusCode ?? 200);
    }
}
