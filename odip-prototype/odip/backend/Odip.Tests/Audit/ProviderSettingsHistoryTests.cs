using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Audit;

/// <summary>Settings › Settings history reads the ProviderSettings audit rows: an Admin sees their own organisation's, nobody sees another's (a SuperAdmin's query filter is off, so the scoped query decides), and bank values never reach a row.</summary>
public class ProviderSettingsHistoryTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();
    private static readonly Guid IdA = Guid.NewGuid();
    private static readonly Guid IdB = Guid.NewGuid();

    private static (OdipDbContext db, AuditController audit, ProviderSettingsController settings) Create(Guid? tenantId, bool superAdmin)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        foreach (var (id, tenantOf) in new[] { (IdA, TenantA), (IdB, TenantB) })
        {
            db.ProviderSettings.Add(new ProviderSettings
            {
                Id = id, TenantId = tenantOf, RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = "NSW",
                BankAccountName = "Synthetic Org", BSB = "123-456", AccountNumber = "12345678",
            });
            db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = "ProviderSettings", EntityId = id, Action = AuditAction.Updated, ChangedAt = DateTimeOffset.UtcNow, Changes = """[{"Field":"State","Old":"VIC","New":"NSW"}]""" });
        }
        db.SaveChanges();
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, superAdmin ? "SuperAdmin" : "Admin")], "Test"));
        var context = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } };
        return (db, new AuditController(db, NullLogger<AuditController>.Instance) { ControllerContext = context }, new ProviderSettingsController(db, tenant.Object) { ControllerContext = context });
    }

    private static Task<ActionResult> History(AuditController audit, Guid id) => audit.GetAuditHistory("ProviderSettings", id, ct: CancellationToken.None);

    [Fact]
    public async Task An_admin_reads_their_own_organisations_history()
    {
        var (db, audit, _) = Create(TenantA, false);
        using var _ = db;

        var body = JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(await History(audit, IdA)).Value);

        Assert.Contains("State", body);
    }

    [Theory]
    [InlineData(false, true)]   // an Admin of A asking for B's row
    [InlineData(true, true)]    // a SuperAdmin viewing as A asking for B's row: the query filter is off for them, so only the scoped query keeps B out
    [InlineData(true, false)]   // a SuperAdmin with no organisation in scope
    public async Task Another_organisations_history_is_404(bool superAdmin, bool viewingAsA)
    {
        var (db, audit, _) = Create(viewingAsA ? TenantA : null, superAdmin);
        using var _ = db;

        Assert.IsType<NotFoundObjectResult>(await History(audit, viewingAsA ? IdB : IdA));
    }

    [Fact]
    public async Task A_changed_BSB_and_account_number_show_as_changed_and_their_digits_never_appear()
    {
        var (db, audit, settings) = Create(TenantA, false);
        using var _ = db;
        var dto = new UpsertProviderSettingsDto
        {
            RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = "NSW",
            BankAccountName = "Synthetic Org", BSB = "062-000", AccountNumber = "87654321",
        };
        Assert.IsNotType<BadRequestObjectResult>((await settings.Upsert(dto, CancellationToken.None)).Result);

        var body = JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(await History(audit, IdA)).Value);

        Assert.Contains("BSB", body);
        Assert.Contains("changed", body);
        foreach (var digits in new[] { "123-456", "062-000", "12345678", "87654321" }) Assert.DoesNotContain(digits, body);
    }
}
