using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
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
}
