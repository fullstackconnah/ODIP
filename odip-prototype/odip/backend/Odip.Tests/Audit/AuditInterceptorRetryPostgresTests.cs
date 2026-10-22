using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Audit;

/// <summary>
/// A save that loses a race and is retried on the same context (the intake save does this when a booking wrote the enquiry) must audit each
/// change once. EF InMemory cannot show it: it has no transaction, so the failed attempt's rows stay in the store.
/// </summary>
public class AuditInterceptorRetryPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public AuditInterceptorRetryPostgresTests(PostgresFixture pg) => _pg = pg;

    private static OdipDbContext Open(string connectionString)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseNpgsql(connectionString)
            .AddInterceptors(new AuditInterceptor(new HttpContextAccessor()))
            .Options;
        return new OdipDbContext(options, tenant.Object);
    }

    /// <summary>Edits a stored participant and enquiry, loses a race on the enquiry's concurrency token, takes the stored token and saves again.</summary>
    private async Task<(OdipDbContext Db, Guid ParticipantId)> EditLoseRaceAndRetryAsync(Action<OdipDbContext>? alsoAdd = null)
    {
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync();
        var (setup, tenantId) = await _pg.NewTenantContextAsync(cs);
        var participantId = Guid.NewGuid();
        var inquiryId = Guid.NewGuid();
        await using (setup)
        {
            setup.Participants.Add(new Participant { Id = participantId, FirstName = "Amy", LastName = "Ng", NdisNumber = "43100001234", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true });
            setup.ParticipantInquiries.Add(new ParticipantInquiry { Id = inquiryId, TenantId = tenantId, FirstName = "Amy" });
            await setup.SaveChangesAsync();
        }

        var db = Open(cs);
        var participant = await db.Participants.SingleAsync(p => p.Id == participantId);
        var inquiry = await db.ParticipantInquiries.SingleAsync(i => i.Id == inquiryId);
        await using (var other = Open(cs))
        {
            (await other.ParticipantInquiries.SingleAsync(i => i.Id == inquiryId)).IntakeIcsSequence += 1;
            await other.SaveChangesAsync();
        }

        participant.FirstName = "Amélie";
        inquiry.FirstName = "Amélie";
        alsoAdd?.Invoke(db);
        var conflict = await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => db.SaveChangesAsync());
        conflict.Entries.Single().Property(nameof(ParticipantInquiry.IntakeIcsSequence)).OriginalValue = 1;
        await db.SaveChangesAsync();
        return (db, participantId);
    }

    [SkippableFact]
    public async Task ARetriedSave_WritesOneAuditRowPerChangedEntity()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

        var (db, participantId) = await EditLoseRaceAndRetryAsync();
        await using var _ = db;

        await using var read = Open(db.Database.GetConnectionString()!);
        var rows = await read.AuditLogs.Where(a => a.EntityId == participantId && a.Action == AuditAction.Updated).ToListAsync();
        Assert.True(rows.Count == 1, string.Join(" | ", rows.Select(r => $"{r.Id} {r.EntityType} {r.Changes}")));
    }

    [SkippableFact]
    public async Task ARetriedSave_KeepsAnAuditRowTheCallerAddedOnce()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var settingId = Guid.NewGuid();

        var (db, _) = await EditLoseRaceAndRetryAsync(d => d.AuditLogs.Add(
            new AuditLog { Id = Guid.NewGuid(), EntityType = "Setting", EntityId = settingId, Action = AuditAction.Updated, ChangedAt = DateTimeOffset.UtcNow }));
        await using var _ = db;

        await using var read = Open(db.Database.GetConnectionString()!);
        Assert.Single(await read.AuditLogs.Where(a => a.EntityId == settingId).ToListAsync());
    }
}
