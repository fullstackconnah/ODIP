using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Imports;
using Odip.Tests.Medications;

namespace Odip.Tests.Integrations;

/// <summary>One connected organisation and a fake EH, for the sync, background and controller tests.</summary>
internal static class EhFixture
{
    public const string ApiKey = "eh-api-key-5f2a9c";
    public const string Business = "777";
    public static readonly IntegrationKeyProtector Keys = IntegrationKeyProtectorTests.Protector(IntegrationKeyProtectorTests.NewMasterKey());

    // 01:00 UTC on Wednesday 14 October 2026 is 12:00 that day in Sydney (AEDT), so the organisation's today is 14 October.
    public static FakeClock Clock() => FakeClock.AtUtc(2026, 10, 14, 1, 0);

    /// <summary>A context scoped to the organisation on the named InMemory database, with the audit interceptor and no HttpContext, as in a background run.</summary>
    public static OdipDbContext Db(string name, Guid tenantId, params IInterceptor[] extra) =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).AddInterceptors(new AuditInterceptor(new HttpContextAccessor())).AddInterceptors(extra).Options,
            ImportTestSupport.Tenant(tenantId));

    public static User Staff(Guid tenantId, string first, string last, string email, string? payrollId = null, UserRole role = UserRole.SupportWorker, DateTime? lastLogin = null) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = first, LastName = last, Email = email, Username = $"{first}.{last}.{Guid.NewGuid():N}".ToLowerInvariant(),
        Role = role, IsActive = true, ExternalPayrollId = payrollId, LastLoginAt = lastLogin,
    };

    /// <summary>
    /// Sets up the organisation:
    /// - New South Wales, with the domain acme.org.au;
    /// - its one active Admin, Ada, linked to EH employee 1;
    /// - its connection to business 777, with the key encrypted.
    /// </summary>
    public static async Task<EmploymentHeroConnection> ConnectAsync(OdipDbContext db, Guid tenantId, IntegrationKeyProtector? keys = null)
    {
        db.Tenants.Add(new Tenant { Id = tenantId, Name = "Acme Care", EmailDomain = "acme.org.au" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, State = "NSW", OrganisationName = "Acme Care" });
        db.Users.Add(Staff(tenantId, "Ada", "Admin", "ada@acme.org.au", "1", UserRole.Admin));
        var (cipher, nonce) = (keys ?? Keys).Protect(ApiKey, tenantId);
        var conn = new EmploymentHeroConnection
        {
            Id = Guid.NewGuid(), TenantId = tenantId, BusinessId = Business, BusinessName = "Acme Care", ApiKeyCiphertext = cipher, ApiKeyNonce = nonce,
            ConnectedAt = new DateTime(2026, 10, 13, 0, 0, 0, DateTimeKind.Utc), ConnectedByName = "Ada Admin",
        };
        db.EmploymentHeroConnections.Add(conn);
        await db.SaveChangesAsync();
        return conn;
    }

    /// <summary>EH's one page of employees for business 777: Ada (id 1) plus these.</summary>
    public static StubHttpHandler Eh(params object[] employees) =>
        new StubHttpHandler().On(StubHttpHandler.EmployeesPage(Business), HttpStatusCode.OK, employees.Prepend(StubHttpHandler.Employee(1, "Ada", "Admin", "ada@acme.org.au")).ToArray());

    public static EmploymentHeroStaffSync Sync(StubHttpHandler eh, IntegrationKeyProtector? keys = null, ILogger<EmploymentHeroStaffSync>? logger = null) =>
        new(StubHttpHandler.Client(eh), keys ?? Keys, Clock(), logger ?? NullLogger<EmploymentHeroStaffSync>.Instance);
}
