using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

public class TenantsGetAllTests
{
    [Fact]
    public async Task GetAll_ListsEveryOrganisation_ForASuperAdmin()
    {
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns((Guid?)null);
        current.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options;
        using var db = new OdipDbContext(options, current.Object);
        db.Tenants.AddRange(
            new Tenant { Id = Guid.NewGuid(), Name = "Bravo Care", EmailDomain = "bravo.example.com", IsActive = true, CreatedAt = DateTime.UtcNow },
            new Tenant { Id = Guid.NewGuid(), Name = "Alpha Support", EmailDomain = "alpha.example.com", IsActive = true, CreatedAt = DateTime.UtcNow });
        db.SaveChanges();

        var result = await new TenantsController(db, new Mock<IFirebaseUserService>().Object).GetAll();

        var body = Assert.IsType<ApiResponse<List<TenantSummaryDto>>>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal(new[] { "Alpha Support", "Bravo Care" }, body.Data!.Select(t => t.Name));
    }
}
