using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Complaints;

/// <summary>A complaint is audited, so an Admin can read its history: for their own organisation only, and never a Coordinator.</summary>
public class ComplaintAuditHistoryTests
{
    private static readonly Guid TenantA = Guid.NewGuid();

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AuditHistory_Complaint_ReadableForOwnOrganisationOnly(bool foreign)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantA);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var complaint = new Complaint { Id = Guid.NewGuid(), TenantId = foreign ? Guid.NewGuid() : TenantA, Summary = "Late pick-up" };
        db.Add(complaint);
        db.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = "Complaint", EntityId = complaint.Id, Action = AuditAction.Created, ChangedAt = DateTimeOffset.UtcNow });
        db.SaveChanges();

        var result = await new AuditController(db, NullLogger<AuditController>.Instance).GetAuditHistory("Complaint", complaint.Id, ct: CancellationToken.None);

        if (foreign) Assert.IsType<NotFoundObjectResult>(result);
        else Assert.Contains("Created", System.Text.Json.JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(result).Value));
    }

    [Fact]
    public void AuditHistory_IsNotForCoordinators()
    {
        var roles = typeof(AuditController).GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Single().Roles!.Split(',');
        Assert.DoesNotContain("Coordinator", roles);
    }
}
