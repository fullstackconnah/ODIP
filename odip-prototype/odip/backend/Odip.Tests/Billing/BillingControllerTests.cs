using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Billing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// Controller-level coverage for the funding-source routes of BillingController. Uses the
/// same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as AdminUsersControllerTests.
/// </summary>
public class BillingControllerTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    // ── INTAKE-08: draft participants are excluded from claims/billing surfaces ────────

    [Fact]
    public async Task CreateFundingSource_DraftParticipant_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var draft = new Participant { Id = Guid.NewGuid(), FirstName = "Priya", IsDraft = true, IsActive = true };
        db.Participants.Add(draft);
        db.SaveChanges();
        var controller = new BillingController(db);

        var result = await controller.CreateFundingSource(
            new CreateFundingSourceDto { ParticipantId = draft.Id, RouteType = FundingRouteType.AgencyManaged },
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(await db.FundingSources.ToListAsync());
    }
}
