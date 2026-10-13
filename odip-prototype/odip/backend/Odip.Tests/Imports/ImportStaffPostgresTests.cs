using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

/// <summary>The staff email lookups (lower-casing, every organisation's users) against a real PostgreSQL.</summary>
public class ImportStaffPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public ImportStaffPostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact]
    public async Task An_email_held_in_another_organisation_in_any_case_is_refused_on_Postgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (setupA, a) = await _pg.NewTenantContextAsync();
        var (setupB, b) = await _pg.NewTenantContextAsync();
        await setupA.DisposeAsync();
        var token = Guid.NewGuid().ToString("N")[..8];
        setupB.Users.Add(new User { Id = Guid.NewGuid(), FirstName = "Sam", LastName = "Lee", Username = $"slee{token}", Email = $"Sam.{token}@Example.org", Role = UserRole.SupportWorker });
        await setupB.SaveChangesAsync();
        await setupB.DisposeAsync();

        await using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).Options, Tenant(a));
        var preview = await Service(db, a).PreviewAsync(ImportKind.Staff, Csv("First name,Last name,Email", $"Sam,Lee,sam.{token}@example.org"), "staff.csv", null, CancellationToken.None, Admin());

        Assert.Equal("This email belongs to another organisation.", preview.Rows.Single().Reasons.Single());
    }

    [SkippableFact]
    public async Task Staff_undo_deletes_on_Postgres_and_its_blocker_queries_translate()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await setup.DisposeAsync();
        var token = Guid.NewGuid().ToString("N")[..8];
        await using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).Options, Tenant(tenantId));
        var service = Service(db, tenantId);
        var result = await service.CommitAsync(ImportKind.Staff, Csv("First name,Last name,Email", $"Jo,Ng,jo.{token}@gmail.com"), "staff.csv", null, null, $"k-{token}", Admin(), CancellationToken.None);

        var outcome = await service.UndoAsync(result.BatchId, Admin(), CancellationToken.None);

        Assert.Empty(outcome.Blockers);
        Assert.False(await db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email == $"jo.{token}@gmail.com"));
    }

    [SkippableFact]
    public async Task A_reference_the_undo_rules_do_not_know_fails_the_undo_and_deletes_nothing_on_Postgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await setup.DisposeAsync();
        var token = Guid.NewGuid().ToString("N")[..8];
        await using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).Options, Tenant(tenantId));
        var service = Service(db, tenantId);
        var result = await service.CommitAsync(ImportKind.Staff, Csv("First name,Last name,Email", $"Jo,Ng,jo.{token}@gmail.com", $"Al,Wu,al.{token}@gmail.com"),
            "staff.csv", null, null, $"k-{token}", Admin(), CancellationToken.None);
        var jo = await db.Users.SingleAsync(u => u.Email == $"jo.{token}@gmail.com");
        // A Restrict foreign key to Users that StaffBlockersAsync does not list.
        db.NotificationPreferences.Add(new NotificationPreference { Id = Guid.NewGuid(), TenantId = tenantId, UserId = jo.Id });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var refusal = await Assert.ThrowsAsync<ImportException>(() => service.UndoAsync(result.BatchId, Admin(), CancellationToken.None));

        Assert.Equal((409, "Nothing was undone: one of its records is used elsewhere in ODIP."), (refusal.StatusCode, refusal.Message));
        db.ChangeTracker.Clear();
        Assert.Equal(2, await db.Users.CountAsync(u => u.Email.EndsWith($".{token}@gmail.com")));
        Assert.Null((await db.ImportBatches.SingleAsync(b => b.Id == result.BatchId)).UndoneAt);
    }
}
