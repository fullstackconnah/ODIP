using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>
/// Spec 5.8 #1 and the column facts InMemory cannot show: the counter takes each number once, under concurrent submits, inside the issuing transaction;
/// a long plan-manager address still submits. Needs a real PostgreSQL; skipped, never failed, without POSTGRES_CONNECTION_STRING.
/// </summary>
public class InvoiceNumberingPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public InvoiceNumberingPostgresTests(PostgresFixture pg) => _pg = pg;

    private static ICurrentTenant TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    private static ClaimsController Controller(OdipDbContext db, ICurrentTenant tenant) =>
        new(db, new ClaimGenerationService(db), new ShiftClaimGenerationService(db), new BprCsvService(db), new InvoiceService(db), new BudgetLedgerService(db, TimeProvider.System), tenant);

    /// <summary>An organisation with settings (first number <paramref name="start"/>) and one Draft self-managed shift claim per entry.</summary>
    private async Task<(Guid TenantId, List<Guid> Claims)> SeedAsync(int claims, int start = 1, string? planManagerAddress = null)
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        await using var _ = db;
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", db.Database.ProviderName);   // so an InMemory run can never satisfy this class
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Test Provider", Address = "1 Test St", State = "NSW", InvoiceStartNumber = start });
        var ids = new List<Guid>();
        for (var i = 0; i < claims; i++)
        {
            var manager = planManagerAddress is null ? null : new Contact { Id = Guid.NewGuid(), FirstName = "Pat", LastName = "Manager", Organisation = "Plan Co", Address = planManagerAddress };
            var person = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "P" + i, LastName = "Test", IsActive = true, PlanType = manager is null ? PlanType.SelfManaged : PlanType.PlanManaged, PlanManagerContact = manager };
            var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = person.Id, PeriodFrom = new DateOnly(2026, 10, 1), PeriodTo = new DateOnly(2026, 10, 14), Status = TripClaimStatus.Draft, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = 100m };
            db.AddRange(person, claim, new ClaimLineItem
            {
                Id = Guid.NewGuid(), TripClaimId = claim.Id, SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday, SupportsDeliveredFrom = new DateOnly(2026, 10, 2), SupportsDeliveredTo = new DateOnly(2026, 10, 2),
                Hours = 1m, UnitPrice = 100m, TotalAmount = 100m, GSTCode = GSTCode.P2,
            });
            ids.Add(claim.Id);
        }
        await db.SaveChangesAsync();
        return (tenantId, ids);
    }

    private async Task<IActionResult?> SubmitAsync(Guid tenantId, Guid claimId, params Microsoft.EntityFrameworkCore.Diagnostics.IInterceptor[] interceptors)
    {
        var tenant = TenantOf(tenantId);
        await using var own = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).AddInterceptors(interceptors).Options, tenant);
        return (await Controller(own, tenant).UpdateClaim(claimId, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, CancellationToken.None)).Result;
    }

    private async Task<List<int>> NumbersAsync(Guid tenantId)
    {
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString, TenantOf(tenantId));
        return await check.Invoices.Where(i => i.Kind == InvoiceKind.Invoice).Select(i => i.Number).OrderBy(n => n).ToListAsync();
    }

    [SkippableFact(DisplayName = "Postgres: claims submitted at once get consecutive, distinct numbers")]
    public async Task ClaimsSubmittedAtOnce_GetConsecutiveDistinctNumbers()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, claims) = await SeedAsync(4, start: 41);

        var results = await Task.WhenAll(claims.Select(id => SubmitAsync(tenantId, id)));

        Assert.All(results, r => Assert.IsType<OkObjectResult>(r));
        Assert.Equal(new[] { 41, 42, 43, 44 }, await NumbersAsync(tenantId));
    }

    [SkippableFact(DisplayName = "Postgres: a 600-character plan manager address still submits")]
    public async Task ASixHundredCharacterAddress_StillSubmits()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var address = new string('A', 600);
        var (tenantId, claims) = await SeedAsync(1, planManagerAddress: address);

        Assert.IsType<OkObjectResult>(await SubmitAsync(tenantId, claims[0]));

        await using var check = PostgresFixture.NewContext(_pg.ConnectionString, TenantOf(tenantId));
        Assert.Equal(address, (await check.Invoices.SingleAsync(i => i.TripClaimId == claims[0])).BillToAddress);
    }
}
