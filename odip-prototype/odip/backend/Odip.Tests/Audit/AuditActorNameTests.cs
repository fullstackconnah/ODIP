using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Tests.Imports;
using Xunit;

namespace Odip.Tests.Audit;

/// <summary>Work no person did (the Employment Hero sync) names itself in AuditLog, even inside a request a person made (Sync now).</summary>
public class AuditActorNameTests
{
    private static readonly Guid TenantId = Guid.NewGuid(), AdminId = Guid.NewGuid();

    private static OdipDbContext Db()
    {
        var accessor = new HttpContextAccessor
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, AdminId.ToString()), new Claim("fullName", "Ada Admin")], "Test")),
            },
        };
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).AddInterceptors(new AuditInterceptor(accessor)).Options;
        return new OdipDbContext(options, ImportTestSupport.Tenant(TenantId));
    }

    private static User Person() => new() { Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Sam", LastName = "Lee", Username = "slee", Email = "sam@example.org", Role = UserRole.SupportWorker };

    [Fact]
    public async Task AuditActorName_names_the_row_even_when_a_person_made_the_request()
    {
        await using var db = Db();
        db.AuditActorName = "Employment Hero sync";
        db.Users.Add(Person());
        await db.SaveChangesAsync();

        var row = await db.AuditLogs.SingleAsync();
        Assert.Equal(("Employment Hero sync", (Guid?)null), (row.ChangedByName, row.ChangedById));
    }

    [Fact]
    public async Task Without_it_the_request_user_is_the_actor()
    {
        await using var db = Db();
        db.Users.Add(Person());
        await db.SaveChangesAsync();

        var row = await db.AuditLogs.SingleAsync();
        Assert.Equal(("Ada Admin", (Guid?)AdminId), (row.ChangedByName, row.ChangedById));
    }
}
